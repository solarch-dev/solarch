import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { NodesRepository } from "../nodes/nodes.repository";
import { EdgesRepository } from "../edges/edges.repository";
import { ProjectsRepository } from "../projects/projects.repository";
import { SurgicalFillRepository, type StoredFill } from "./surgical-fill.repository";
import { redactNodeSecrets } from "../nodes/secret-redaction";
import { buildCodeGraph, type CodeGraph, type CodeNode } from "./ir";
import { projectSimpleView, projectSimpleMermaid, projectSimpleSketchModel, type SystemMapDTO, type SimpleSketchModel } from "./simple-projection";
import { projectOpenApi } from "./openapi.emitter";
import type { OpenAPIObject } from "@nestjs/swagger";
import { getGenerationChat, isGenerationConfigured } from "../ai/providers/llm.factory";
import { z } from "zod";
import { SystemMessage, HumanMessage, AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { lintContracts } from "./contract-lint";
import { EMITTER_REGISTRY } from "./emitters/nestjs";
import { emitFeatureModule } from "./emitters/nestjs/module.emitter";
import { emitScaffoldProject } from "./emitters/nestjs/scaffold.emitter";
import { emitMigrationRunners } from "./emitters/nestjs/migration-runner.emitter";
import { emitServiceSpecs } from "./emitters/nestjs/service-spec.emitter";
import { emitSurgicalPlan } from "./emitters/nestjs/surgical-plan.emitter";
import { emitSyntheticEntity, tablesNeedingSyntheticEntity } from "./emitters/nestjs/entity-synthesis";
import { emitSyntheticException, undefinedThrownExceptions } from "./emitters/nestjs/exception-synthesis";
import { CODEGEN_VERSION } from "./codegen.version";
import type {
  CodegenTarget,
  EmitterContext,
  GeneratedFile,
  GeneratedProject,
  SkippedKinds,
} from "./types";

/* ────────────────────────────────────────────────────────────────────────
 * codegen.service.ts — orchestrator.
 *
 * Akis:
 *   1) Proje var mi? (yoksa 404 ERR_PROJECT_NOT_FOUND)
 *   2) Tum node + edge'leri tek projeye gore cek.
 *   3) buildCodeGraph -> cozumlenmis CodeGraph + EmitterContext.
 *   4) Her node icin REGISTRY'den emitter calistir:
 *        - kayitli + supported -> dosya(lar) uret.
 *        - kayitli + !supported -> stub uret + skippedKinds++.
 *        - kayitsiz -> emitter yok -> skippedKinds++ (sessizce dusmez).
 *   5) Scaffold dosyalarini ekle.
 *   6) Determinizm: dosyalari path'e gore sirala, cift path'leri (ilk-kazanir)
 *      tekillestir, summary doldur.
 * ──────────────────────────────────────────────────────────────────────── */

@Injectable()
export class CodegenService {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly nodes: NodesRepository,
    private readonly edges: EdgesRepository,
    private readonly surgicalFills: SurgicalFillRepository,
  ) {}

  private readonly logger = new Logger(CodegenService.name);

  /** Per-project Mermaid cache for the legacy Simple sketch (keyed by deterministic baseline).
   *  The structured model (the primary path) is persisted in the DB instead — see simpleSketchModel. */
  private readonly sketchCache = new Map<string, { key: string; mermaid: string; source: "ai" | "deterministic" }>();

  async generate(projectId: string, target: CodegenTarget = "nestjs"): Promise<GeneratedProject> {
    if (!(await this.projects.exists(projectId))) {
      throw new NotFoundException({
        code: "ERR_PROJECT_NOT_FOUND",
        message: `Project '${projectId}' not found.`,
      });
    }

    const [storedNodes, storedEdges, fills] = await Promise.all([
      this.nodes.list(projectId),
      this.edges.list(projectId),
      this.surgicalFills.getAllForProject(projectId),
    ]);

    // GUVENLIK (defense-in-depth): nodes.list (repository) redaksiyon YAPMAZ.
    // Secret'i IR'a hic sokmamak icin codegen sinirinda redakte et — boylece
    // koruma yapisaldir, her emitter'in IsSecret kontrolune bagli degildir.
    const redactedNodes = storedNodes.map((n) => ({
      ...n,
      properties: redactNodeSecrets(n.type, n.properties),
    }));

    const graph = buildCodeGraph(redactedNodes, storedEdges);
    const project = this.assemble(graph, target);
    // Sakli algoritma govdelerini (bolge-bazinda) iskeletteki NOT_IMPLEMENTED yerine
    // geri-enjekte et → re-open/regenerate dolu surumu gosterir, re-fill kaldigi yerden.
    if (fills.length > 0) project.files = applySurgicalFills(project.files, fills);
    return project;
  }

  /** Basit Gorunum (non-dev) projeksiyonu — teknik graf → feature haritasi +
   *  capability'ler. READ-ONLY, deterministik (Mermaid export'un kardesi); kod
   *  URETMEZ, AI yok → ucretsiz. Frontend src/features/simple bunu render eder. */
  async simpleView(projectId: string): Promise<SystemMapDTO> {
    if (!(await this.projects.exists(projectId))) {
      throw new NotFoundException({ code: "ERR_PROJECT_NOT_FOUND", message: `Project '${projectId}' not found.` });
    }
    const [storedNodes, storedEdges] = await Promise.all([this.nodes.list(projectId), this.edges.list(projectId)]);
    // Secret degerleri IR'a hic sokma (defense-in-depth; projeksiyon zaten yapi gosterir).
    const redactedNodes = storedNodes.map((n) => ({ ...n, properties: redactNodeSecrets(n.type, n.properties) }));
    return projectSimpleView(buildCodeGraph(redactedNodes, storedEdges));
  }

  /** Mermaid for the hand-drawn Simple sketch. Cached per project, keyed by the
   *  deterministic baseline, so the LLM runs ONLY when the graph actually changes.
   *  The AI refines a VALID deterministic baseline (so the output is always valid
   *  Mermaid and covers every part); falls back to that baseline if the LLM is off. */
  async simpleSketch(projectId: string): Promise<{ mermaid: string; source: "ai" | "deterministic" }> {
    if (!(await this.projects.exists(projectId))) {
      throw new NotFoundException({ code: "ERR_PROJECT_NOT_FOUND", message: `Project '${projectId}' not found.` });
    }
    const [storedNodes, storedEdges] = await Promise.all([this.nodes.list(projectId), this.edges.list(projectId)]);
    const redactedNodes = storedNodes.map((n) => ({ ...n, properties: redactNodeSecrets(n.type, n.properties) }));
    const baseline = projectSimpleMermaid(buildCodeGraph(redactedNodes, storedEdges));
    const key = hashStr(baseline);

    const cached = this.sketchCache.get(projectId);
    if (cached && cached.key === key) return { mermaid: cached.mermaid, source: cached.source };

    let mermaid = baseline;
    let source: "ai" | "deterministic" = "deterministic";
    if (isGenerationConfigured()) {
      try {
        // SURGICAL: if we already have an AI sketch, patch it minimally to match the new
        // baseline (keeps existing nodes/labels/order stable → stable layout). Else full refine.
        mermaid = cached && cached.source === "ai"
          ? await aiPatchMermaid(cached.mermaid, baseline)
          : await aiRefineMermaid(baseline);
        source = "ai";
      } catch (e) {
        this.logger.warn(`Simple sketch (Mermaid) AI refine failed for project ${projectId}: ${(e as Error)?.message ?? e}`);
        mermaid = baseline;
        source = "deterministic";
      }
    }
    this.sketchCache.set(projectId, { key, mermaid, source });
    return { mermaid, source };
  }

  /** Structured Simple-View model (Mermaid-free; ELK-laid-out + rough-rendered on the client).
   *  A tool-calling agent (DeepSeek v4-flash) refines the PRESENTATION of a deterministic
   *  baseline — friendly names + semantic colors — by calling rename/colorize tools that can
   *  only touch real ids (structure + kind stay graph-true). Cached per project (the agent runs
   *  only when the graph changes); falls back to the deterministic model when AI is off.
   *  `force` bypasses the cache and re-runs the AI refine (the "Regenerate" button) — useful when
   *  a previous run fell back to deterministic (AI hiccup) and the graph hasn't changed since. */
  async simpleSketchModel(
    projectId: string,
    stage?: "baseline" | "full",
    force = false,
  ): Promise<{ model: SimpleSketchModel; source: "ai" | "deterministic"; aiConfigured: boolean }> {
    if (!(await this.projects.exists(projectId))) {
      throw new NotFoundException({ code: "ERR_PROJECT_NOT_FOUND", message: `Project '${projectId}' not found.` });
    }
    const aiConfigured = isGenerationConfigured();
    const [storedNodes, storedEdges] = await Promise.all([this.nodes.list(projectId), this.edges.list(projectId)]);
    const redactedNodes = storedNodes.map((n) => ({ ...n, properties: redactNodeSecrets(n.type, n.properties) }));
    const baseline = projectSimpleSketchModel(buildCodeGraph(redactedNodes, storedEdges));
    // Two-phase reveal: the client fetches `baseline` first (instant, no AI) to draw the structure,
    // then the full (AI-enriched) model — same layout, names/colors settle in.
    if (stage === "baseline") return { model: baseline, source: "deterministic", aiConfigured };
    const key = hashStr(JSON.stringify(baseline));

    // Reuse the PERSISTED AI model while the graph is unchanged (survives restarts). Only AI results
    // are stored, so a stored hit is always an "ai" model. `force` (the Regenerate button) skips it.
    if (!force) {
      const stored = await this.projects.getSimpleSketchModel<SimpleSketchModel>(projectId);
      if (stored && stored.key === key) return { model: stored.model, source: "ai", aiConfigured };
    }

    if (aiConfigured && baseline.nodes.length > 0) {
      try {
        const model = await aiEnrichSketchModel(baseline);
        await this.projects.setSimpleSketchModel(projectId, key, model); // persist the AI result in the DB
        return { model, source: "ai", aiConfigured };
      } catch (e) {
        // Don't swallow it silently — surface WHY the diagram stayed deterministic (timeout, tool error…).
        this.logger.warn(`Simple sketch AI refine failed for project ${projectId}: ${(e as Error)?.message ?? e}`);
      }
    }
    // AI off, no nodes, or AI failed → the deterministic baseline (recomputed instantly; not persisted,
    // so the next view naturally retries the AI instead of getting stuck on a fallback).
    return { model: baseline, source: "deterministic", aiConfigured };
  }

  /** Interactive API documentation — a deterministic OpenAPI 3.1 doc from the graph, optionally
   *  enriched by "AI Documentize" (prose + examples only). Mirrors simpleSketchModel:
   *    - stage "baseline" → instant deterministic doc (no AI, no DB).
   *    - otherwise → the persisted AI-enriched doc while the graph is unchanged, else the AI runs and
   *      its result is cached on the Project node; falls back to the deterministic baseline if the AI
   *      is off or fails.
   *  The structure (paths/operations/schemas) is always graph-true; the AI only annotates EXISTING
   *  operations/schemas — it never invents paths. `force` (the "AI Documentize" button) skips the cache. */
  async apiDoc(
    projectId: string,
    stage?: "baseline" | "full",
    force = false,
  ): Promise<{ doc: OpenAPIObject; source: "ai" | "deterministic"; aiConfigured: boolean }> {
    if (!(await this.projects.exists(projectId))) {
      throw new NotFoundException({ code: "ERR_PROJECT_NOT_FOUND", message: `Project '${projectId}' not found.` });
    }
    const aiConfigured = isGenerationConfigured();
    const [storedNodes, storedEdges] = await Promise.all([this.nodes.list(projectId), this.edges.list(projectId)]);
    // Secret values never enter the IR (defense-in-depth; the doc only describes structure).
    const redacted = storedNodes.map((n) => ({ ...n, properties: redactNodeSecrets(n.type, n.properties) }));
    const baseline = projectOpenApi(buildCodeGraph(redacted, storedEdges));
    // Two-phase reveal: the client fetches `baseline` first (instant, no AI) to render the structure,
    // then the full (AI-enriched) doc — same paths, prose/examples settle in.
    if (stage === "baseline") return { doc: baseline, source: "deterministic", aiConfigured };
    const key = hashStr(JSON.stringify(baseline));

    // Reuse the PERSISTED AI doc while the graph is unchanged (survives restarts). Only AI results are
    // stored, so a stored hit is always an "ai" doc. `force` (the Documentize button) skips it.
    if (!force) {
      const stored = await this.projects.getOpenApiDoc<OpenAPIObject>(projectId);
      if (stored && stored.key === key) return { doc: stored.doc, source: "ai", aiConfigured };
    }

    if (aiConfigured) {
      try {
        const doc = await aiDocumentizeOpenApi(baseline);
        await this.projects.setOpenApiDoc(projectId, key, doc); // persist the AI result in the DB
        return { doc, source: "ai", aiConfigured };
      } catch (e) {
        // Don't swallow it silently — surface WHY the doc stayed deterministic (timeout, tool error…).
        this.logger.warn(`API documentize failed for project ${projectId}: ${(e as Error)?.message ?? e}`);
      }
    }
    // AI off or AI failed → the deterministic baseline (recomputed instantly; not persisted, so the
    // next request naturally retries the AI instead of getting stuck on a fallback).
    return { doc: baseline, source: "deterministic", aiConfigured };
  }

  /** Saf montaj — DB'siz test edilebilir (in-memory CodeGraph al, proje uret). */
  assemble(graph: CodeGraph, target: CodegenTarget = "nestjs"): GeneratedProject {
    const ctx: EmitterContext = { graph, target };
    const skippedKinds: SkippedKinds = {};
    const collected: GeneratedFile[] = [];

    // graph.nodes zaten isme gore sirali -> emit sirasi deterministik.
    // Node emitter'lar feature dosyalarini proje KOKUNE goreli uretir
    // (or. "auth/auth.service.ts"); montaj burada TypeScript feature
    // dosyalarina "src/" onekini ekler ki scaffold (src/main.ts, src/app.module.ts)
    // + tsconfig "include": ["src/**/*"] ile TEK agac altinda toplansin. SQL
    // migration'lari ("migrations/...") KOKTE kalir (derlenmez; siraya tabidir).
    for (const node of graph.nodes) {
      // Kapsam-disi (FrontendApp/UIComponent/View): bir backend'de frontend
      // bilesenin yeri yok -> DOSYA URETME, yalniz skippedKinds'e say.
      if (graph.isExcluded(node)) {
        bump(skippedKinds, node.kindOf());
        continue;
      }
      // Module node: per-node NOT, FEATURE basina sentezlenir (asagida).
      // Feature SEED'i olarak ir.ts'te kullanilir; ayri dosya uretmez.
      if (node.kindOf() === "Module") continue;

      const entry = EMITTER_REGISTRY[node.kindOf()];
      if (!entry) {
        bump(skippedKinds, node.kindOf());
        continue;
      }
      // FAULT-ISOLATION (M5): adi WITHOUT node bozuktur (name-property string degil
      // ya da bos — ir.toCodeNode "" verir). Gecerli/sema-dogrulanmis her node'un
      // adi zorunludur; bos ad = bozuk girdi. Gecerli bir sinif/dosya adi turetilemez
      // -> dosya URETME, skippedKinds'e say, siradakine gec (sessizce DUSME).
      if (node.name.trim().length === 0) {
        bump(skippedKinds, node.kindOf());
        continue;
      }
      if (!entry.supported) bump(skippedKinds, node.kindOf());
      // FAULT-ISOLATION (M5): tek bozuk node (or. emitter undefined alana patlar)
      // TUM codegen'i dusurmemeli. Bu node'un emit'ini izole et — patlarsa onu
      // skippedKinds'e say ve siradakine gec; geri kalan graph uretilmeye devam
      // eder. Hatayi yutmak NOT, tek node'u atlamak: deterministik + saf kalir
      // (girdi sabitse hangi node'un patladigi da sabittir).
      let emitted: GeneratedFile[];
      try {
        emitted = entry.emit(node, ctx);
      } catch (e) {
        if (process.env.SOLARCH_DEBUG_EMIT) console.error(`EMIT FAIL ${node.kindOf()} "${node.name}": ${(e as Error).message}\n${(e as Error).stack?.split("\n").slice(1, 4).join("\n")}`);
        // Bozuk node -> dosya uretme, skippedKinds'e say (sessizce dusmez).
        // supported=false zaten yukarida sayildi -> DOUBLE sayma. Yalniz
        // supported (gercek emitter) patlarsa burada say.
        if (entry.supported) bump(skippedKinds, node.kindOf());
        continue;
      }
      for (const f of emitted) {
        // node-emitter ciktisi -> dosyayi URETEN node.id ile etiketle (nodeFiles).
        const tagged = { ...f, nodeId: node.id };
        collected.push(tagged.language === "typescript" ? { ...tagged, path: `src/${tagged.path}` } : tagged);
      }
    }

    // ── ENTITY SENTEZI (Table-only graph BOOT garantisi) ────────────────────
    // Model'i WITHOUT ama bir Repository tarafindan referans edilen her Table
    // icin TypeORM @Entity sinifi sentezlenir. Boylece @InjectRepository(Entity),
    // Repository<Entity> ve TypeOrmModule.forFeature([Entity]) AYNI sinifa baglanir
    // -> NestJS DI bootta repository provider'ini cozebilir, uygulama ACILIR.
    for (const table of tablesNeedingSyntheticEntity(graph)) {
      for (const f of emitSyntheticEntity(table, ctx)) {
        collected.push({ ...f, path: `src/${f.path}` });
      }
    }

    // ── EXCEPTION SENTEZI (bildirilmis-ama-tanimsiz Throws DERLEME garantisi) ──
    // Bir Service metodu Throws=[X] bildirir ama X icin Exception node'u yoksa,
    // service.emitter X'i surgical marker'a yazar + sentetik dosyadan import eder;
    // fill kontrati (checkContract) X'i firlatmaya zorlar. X'in sinifi burada
    // uretilmezse `throw new X` import'suz/tanimsiz kalir → TS2304. Sentezle.
    for (const exName of undefinedThrownExceptions(graph)) {
      const f = emitSyntheticException(exName);
      collected.push({ ...f, path: `src/${f.path}` });
    }

    // ── FEATURE-MODULE SENTEZI (mimari-farkindalik) ─────────────────────────
    // Graph'ta Module node OLMASA bile her cikarilmis feature icin bir
    // <feature>.module.ts uretilir; app.module bunlari import eder -> DI tam,
    // repository'ler kayitli, uygulama BOOT BOOTS. features() zaten slug'a sirali.
    for (const feature of graph.features()) {
      for (const f of emitFeatureModule(feature, ctx)) {
        collected.push({ ...f, path: `src/${f.path}` });
      }
    }

    // ── COMMON-MODULE SENTEZI (feature-bagsiz altyapi) ──────────────────────
    // "common/"a dusen feature-bagsiz altyapi (MessageQueue/EventHandler/Cache/
    // ... ve paylasimli @Controller/APIGateway'ler) bir feature module almaz ->
    // BullModule.registerQueue HIC cagrilmaz, provider orphan kalirdi. CommonModule
    // bunlari toplar + wiring'ini yapar; AppModule import eder (buildAppModule).
    const commonFeature = graph.commonFeature();
    if (commonFeature) {
      for (const f of emitFeatureModule(commonFeature, ctx)) {
        collected.push({ ...f, path: `src/${f.path}` });
      }
    }

    // ── SERVICE TEST ISKELETI SENTEZI (H6) ──────────────────────────────────
    // Her Service icin yaninda bir <base>.service.spec.ts iskeleti (Test.create
    // TestingModule + DI mock'lari). Feature TS dosyalari gibi "src/" altina alinir.
    for (const f of emitServiceSpecs(ctx)) {
      collected.push({ ...f, path: `src/${f.path}` });
    }

    // Scaffold (node'dan bagimsiz) proje-genel dosyalar (graph-farkinda).
    // Bunlar zaten dogru kokte ("src/" TS dosyalari + kok package.json/tsconfig/...).
    collected.push(...emitScaffoldProject(ctx));

    // ── MIGRATION RUNNER SENTEZI (H5) ────────────────────────────────────────
    // table/view emitter'lari okunakli `migrations/NNN_create_<x>.sql` uretir ama
    // bunlar TypeORM CLI'ca calistirilamaz. Toplanan SQL'leri CALISTIRILABILIR
    // `src/migrations/NNN-<Name>.ts` (MigrationInterface) siniflarina cevir;
    // data-source.ts glob'u bunlara bakar -> `npm run db:migrate` semayi uygular.
    // SQL dosyalari NNN'e gore sirali verilir (path sirasi deterministik).
    const sqlMigrations = collected
      .filter((f) => f.language === "sql" && /^migrations\/\d+_create_.+\.sql$/.test(f.path))
      .map((f) => ({ path: f.path, content: f.content }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    collected.push(...emitMigrationRunners(sqlMigrations));

    // ── SURGICAL PLAN SENTEZI (SURGICAL_PLAN.md) ────────────────────────────
    // TUM dosyalar (scaffold + feature + migration dahil) deduped+sorted hâle
    // geldikten AFTER uretilir ki plan, uretilen her .ts dosyasindaki
    // "@solarch:surgical" marker'larini GOREBILSIN. Sonra dosyaya eklenir ve
    // liste yeniden dedupe/sort edilir (SURGICAL_PLAN.md dogru yere otursun).
    //   ONEMLI: MD'nin KENDI marker'i NONETUR (plan METNIdir, surgicalMarkers:0)
    //   -> surgicalMarkerCount mantigi bozulmaz.
    const assembled = dedupeAndSort(collected);
    const surgicalPlan = emitSurgicalPlan(assembled, graph);
    const files = dedupeAndSort([...assembled, surgicalPlan]);
    const surgicalMarkerCount = files.reduce((sum, f) => sum + f.surgicalMarkers, 0);
    // node.id -> uretilen dosya yollari. NIHAI (deduped+sorted) dosyalardan kurulur
    // -> path'ler montaj sonrasi gercek yollardir. Yalniz nodeId tasiyan dosyalar.
    const nodeFiles = buildNodeFiles(files);

    return {
      target,
      files,
      nodeFiles,
      // M4: graph'ta tespit edilen yapisal uyarilar (kirilan dongusel module
      // import'lari vb.) + diyagram-ani kontrat denetimi (contract-lint: govde-alan
      // write endpoint'i input DTO'su olmadan vb.) ciktiya tasinir — aksi halde
      // sessizce kaybolurdu. Ikisi de deterministik + sirali.
      warnings: [...graph.warnings(), ...lintContracts(graph)],
      summary: {
        version: CODEGEN_VERSION,
        fileCount: files.length,
        nodeCount: graph.nodes.length,
        surgicalMarkerCount,
        skippedKinds: sortRecord(skippedKinds),
      },
    };
  }
}

const SURGICAL_MARKER_RE = /\/\/\s*@solarch:surgical\s+id=([^\s#]+)#(\S+)/;
const NOT_IMPLEMENTED_RE = /^(\s*)throw new Error\("NOT_IMPLEMENTED:/;

/** Sakli algoritma govdelerini iskeletteki NOT_IMPLEMENTED satirinin yerine enjekte eder
 *  (deterministik, string-bazli — ts-morph gerektirmez). Her surgical marker
 *  (`// @solarch:surgical id=nodeId#member`) icin sakli govde varsa: marker + bilgi
 *  yorumlarini korur, NOT_IMPLEMENTED throw satirini `// @solarch:filled` imzasi + govde
 *  (satir girintisi marker blogununkiyle eslenir) ile degistirir. Sakli govdesi olmayan
 *  bolgeler iskelet kalir → re-fill onlari secer (kaldigi yerden devam). */
export function applySurgicalFills(files: GeneratedFile[], fills: StoredFill[]): GeneratedFile[] {
  const byKey = new Map<string, StoredFill>();
  for (const f of fills) byKey.set(`${f.nodeId}#${f.member}`, f);

  return files.map((file) => {
    if (file.language !== "typescript" || !file.content.includes("@solarch:surgical")) return file;
    const lines = file.content.split("\n");
    const out: string[] = [];
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const m = SURGICAL_MARKER_RE.exec(lines[i]!);
      const fill = m ? byKey.get(`${m[1]}#${m[2]}`) : undefined;
      if (!fill) {
        out.push(lines[i]!);
        continue;
      }
      // marker satiri + onu izleyen yorum (// …) satirlarini koru.
      out.push(lines[i]!);
      let j = i + 1;
      while (j < lines.length && /^\s*\/\//.test(lines[j]!)) {
        out.push(lines[j]!);
        j++;
      }
      // Simdi lines[j] NOT_IMPLEMENTED throw olmali; degilse (zaten dolu) dokunma.
      const thr = NOT_IMPLEMENTED_RE.exec(lines[j] ?? "");
      if (!thr) {
        i = j - 1; // yorum satirlarini ciktiladik; dongu j'den devam etsin
        continue;
      }
      const indent = thr[1] ?? "";
      out.push(`${indent}// @solarch:filled by=ai at=${fill.filledAt}`);
      out.push("");
      for (const bl of fill.body.split("\n")) out.push(bl.length > 0 ? `${indent}${bl}` : "");
      changed = true;
      i = j; // throw satirini atla
    }
    return changed ? { ...file, content: out.join("\n") } : file;
  });
}

/** Nihai dosyalardan node.id -> path[] haritasi kurar. Yalniz nodeId tasiyan
 *  (node-emitter) dosyalar dahil; anahtarlar + her node'un path listesi sirali. */
function buildNodeFiles(files: GeneratedFile[]): Record<string, string[]> {
  const map = new Map<string, string[]>();
  for (const f of files) {
    if (!f.nodeId) continue;
    const arr = map.get(f.nodeId);
    if (arr) arr.push(f.path);
    else map.set(f.nodeId, [f.path]);
  }
  const out: Record<string, string[]> = {};
  for (const id of [...map.keys()].sort()) {
    out[id] = [...map.get(id)!].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  return out;
}

function bump(rec: SkippedKinds, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

/** Path'e gore sirala + cift path'leri tekillestir (ilk-kazanir). */
function dedupeAndSort(files: GeneratedFile[]): GeneratedFile[] {
  const byPath = new Map<string, GeneratedFile>();
  for (const f of files) if (!byPath.has(f.path)) byPath.set(f.path, f);
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Record'u key'e gore sirali yeniden kurar (deterministik JSON ciktisi). */
function sortRecord(rec: SkippedKinds): SkippedKinds {
  const out: SkippedKinds = {};
  for (const k of Object.keys(rec).sort()) out[k] = rec[k];
  return out;
}

// CodeNode tipini disa-bagli tuketicilere kapatma — sadece tip referansi.
export type { CodeNode };

/** FNV-1a → short stable key (cache invalidation on graph change). */
function hashStr(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** A complete, rich, non-dev example placed BEFORE the rules (visual primacy): the LLM
 *  anchors on a concrete target shape — a small DFD with labeled data-flows — instead of
 *  guessing. Small, consistent shape vocabulary; every arrow carries a plain verb. */
const SKETCH_EXAMPLE = [
  "flowchart TD",
  '  orders["Orders"]',
  '  orders --> orders__gate{"Signed in?"}',
  '  orders__gate --> orders__a0["Place an order"]',
  '  orders__gate --> orders__a1["See your orders"]',
  '  orders__a0 -->|Saves| orders__d0[("Orders")]',
  '  orders__a1 -->|Reads| orders__d0',
  '  orders -->|Uses| orders__x0[/"Stripe"/]',
  '  payments["Payments"]',
  "  orders -->|Needs| payments",
].join("\n");

/** Refine a valid deterministic Mermaid into a friendlier, RICHER non-dev one (DeepSeek
 *  v4-pro). Research-shaped prompt: a full worked example first, then a small fixed shape
 *  set + labeled arrows, so the output reads like a real data-flow story (not a bare list)
 *  while staying truthful to the input. */
async function aiRefineMermaid(baseline: string): Promise<string> {
  const llm = getGenerationChat({ model: "deepseek-v4-pro" });
  const sys =
    "You turn a software system into a friendly Mermaid flowchart for NON-DEVELOPERS. " +
    "It must read like a real data-flow story a person can follow, not a bare list. " +
    'Output STRICTLY JSON: {"mermaid":"<a valid mermaid flowchart TD>"} and NOTHING else.\n\n' +
    "Match the shape of this example exactly (small, consistent visual vocabulary):\n" +
    SKETCH_EXAMPLE +
    "\n\nRules:\n" +
    '1. Start with "flowchart TD". Do NOT use subgraphs.\n' +
    "2. Keep EVERY feature, operation, data store, outside service and cross-feature link from the input — never drop parts, and never invent parts that are not there.\n" +
    '3. Use ONLY these four shapes: ["label"] = an action/step, {"label"} = a yes/no decision, [("label")] = stored data, [/"label"/] = an outside service. No other shapes.\n' +
    "4. LABEL every relationship arrow with one short plain verb: Saves, Reads, Uses, Needs, Works with, or Notifies.\n" +
    "5. Use plain human language for labels (no code, ids, or jargon) and keep them short.\n" +
    "6. Keep it legible: do not add extra crossing arrows and never repeat the same check.\n" +
    "Output ONLY the JSON object.";
  const user =
    "Rewrite this structure into a clearer, friendlier data-flow flowchart for a non-technical reader. " +
    "Keep it valid Mermaid, keep every part, and keep the data stores and the labeled arrows.\n\n" +
    baseline;
  const res = await llm.invoke([
    { role: "system", content: sys },
    { role: "user", content: user },
  ]);
  const txt = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  const parsed = JSON.parse(txt) as { mermaid?: string };
  const m = String(parsed.mermaid ?? "").trim();
  if (!/^(flowchart|graph)\b/.test(m)) throw new Error("invalid mermaid from AI");
  return m;
}

/** SURGICAL update: minimally edit an existing friendly Mermaid to match a new baseline
 *  (add/remove only the changed parts; keep everything else identical → stable layout). */
async function aiPatchMermaid(previous: string, newBaseline: string): Promise<string> {
  const llm = getGenerationChat({ model: "deepseek-v4-pro" });
  const sys =
    "You SURGICALLY update an existing friendly Mermaid flowchart to match a new structure, " +
    "changing as LITTLE as possible. Keep EVERY existing node id, label, shape and order " +
    "IDENTICAL unless the new structure removed it; only ADD the genuinely new parts and REMOVE " +
    "the deleted ones, so the diagram stays visually stable. Preserve the data stores ([(\"...\")]) " +
    "and the labeled arrows (Saves / Reads / Uses / Needs / Notifies). Do NOT use subgraphs. " +
    'Start with "flowchart TD". Output STRICTLY JSON: {"mermaid":"<valid flowchart TD>"} and nothing else.';
  const user =
    `PREVIOUS friendly Mermaid (keep as stable as possible):\n${previous}\n\n` +
    `NEW structure to match now (deterministic baseline):\n${newBaseline}\n\n` +
    `Return the minimally-updated friendly Mermaid.`;
  const res = await llm.invoke([
    { role: "system", content: sys },
    { role: "user", content: user },
  ]);
  const txt = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  const parsed = JSON.parse(txt) as { mermaid?: string };
  const m = String(parsed.mermaid ?? "").trim();
  if (!/^(flowchart|graph)\b/.test(m)) throw new Error("invalid mermaid from AI patch");
  return m;
}

/* ── Tool-calling enrichment of the structured sketch model (DeepSeek v4-flash) ─────────── */

const RenameSketchArgs = z.object({
  id: z.string().describe("the id of the part to rename (must be one of the given part ids)"),
  name: z.string().describe("a short, plain, human name a non-developer understands (no code, ids, or jargon; 1-4 words)"),
});

/** Refine a deterministic SimpleSketchModel's PRESENTATION via tool calls — RENAME ONLY.
 *  Colors are deterministic (the projector gives each group a distinct palette hue). The AI is NOT
 *  allowed to color: in practice it washes EVERY group into one hue, which destroys the grouping.
 *  Rename only touches existing ids; structure, kind, color, groups and connections stay graph-true. */
async function aiEnrichSketchModel(model: SimpleSketchModel): Promise<SimpleSketchModel> {
  const llm = getGenerationChat({ toolCalling: true }); // default model = deepseek-v4-flash (tool calling OK)
  const withTools = llm.bindTools!([
    { name: "rename", description: "Rename a part to a short, plain, non-developer name (e.g. 'MessageController' → 'Messages'). Only ids that exist. Returns { ok }.", schema: RenameSketchArgs },
  ]);

  const nodes = new Map(model.nodes.map((n) => [n.id, { ...n }]));

  const inventory = JSON.stringify({
    groups: model.groups.map((g) => ({ id: g.id, name: g.name })),
    parts: model.nodes.map((n) => ({ id: n.id, kind: n.kind, name: n.name })),
    connections: model.edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
  });
  const sys =
    "You make a software system's diagram friendly for NON-DEVELOPERS (business people). You are given its " +
    "PARTS (id, kind, current name), GROUPS, and CONNECTIONS. RENAME parts to short, plain, human names — drop " +
    "code suffixes and ids ('MessageController' → 'Messages', 'UserRepository' → 'Users'); leave already-friendly " +
    "names. Colors are handled automatically (each group already has its own distinct color) — do NOT try to color " +
    "anything. Only reference ids that exist. NEVER invent parts or change connections. Call rename, then stop.";
  const messages: BaseMessage[] = [
    new SystemMessage(sys),
    new HumanMessage("Diagram:\n" + inventory + "\n\nRename the parts to friendly names, then stop."),
  ];

  const MAX_TURNS = 8;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const ai = (await withTools.invoke(messages)) as AIMessage;
    const calls = (ai.tool_calls ?? []) as Array<{ id?: string; name: string; args: Record<string, unknown> }>;
    if (calls.length === 0) break;
    messages.push(ai);
    for (const call of calls) {
      let result: { ok: boolean; message?: string };
      try {
        if (call.name === "rename") {
          const a = RenameSketchArgs.parse(call.args);
          const n = nodes.get(a.id);
          if (!n) result = { ok: false, message: `no part with id '${a.id}'` };
          else { n.name = a.name.trim().slice(0, 60); result = { ok: true }; }
        } else result = { ok: false, message: `unknown tool '${call.name}'` };
      } catch (e) {
        result = { ok: false, message: String((e as Error).message).slice(0, 140) };
      }
      messages.push(new ToolMessage({ content: JSON.stringify(result), tool_call_id: call.id ?? call.name }));
    }
  }
  // groups untouched → deterministic distinct palette colors survive.
  return { nodes: [...nodes.values()], edges: model.edges, groups: model.groups };
}

/* ── AI Documentize: grounded tool-calling enrichment of the OpenAPI doc ──────────────────
 * The structure (paths/operations/schemas) is verified and graph-true. The agent only adds
 * PROSE and EXAMPLES on EXISTING operations/schemas — it can never invent a path, operation, or
 * schema. Every tool funnels through an apply-helper that looks its target up by operationId /
 * schema name; a miss returns { ok:false } as a ToolMessage so the model self-corrects instead of
 * fabricating. Mirrors aiEnrichSketchModel (getGenerationChat({toolCalling}) → bindTools → loop). */

/** Find an operation object (the method entry under a path) by operationId. Returns the live
 *  reference so callers mutate the doc in place; null when no operation carries that id. */
function findOperation(doc: OpenAPIObject, operationId: string): Record<string, unknown> | null {
  const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
  for (const path of Object.keys(paths)) {
    const item = paths[path] ?? {};
    for (const method of Object.keys(item)) {
      const op = item[method] as Record<string, unknown> | undefined;
      if (op && typeof op === "object" && op.operationId === operationId) return op;
    }
  }
  return null;
}

const DescribeOperationArgs = z.object({
  operationId: z.string().describe("the operationId to annotate (must be one of the listed operationIds)"),
  summary: z.string().optional().describe("a short one-line summary (a handful of words)"),
  description: z.string().optional().describe("1-3 plain sentences describing what the operation does"),
});
const ExampleResponseArgs = z.object({
  operationId: z.string().describe("the operationId whose response to give an example for"),
  status: z.union([z.string(), z.number()]).describe("the HTTP status code of an EXISTING response (e.g. 200, 201)"),
  exampleJson: z.string().describe("a realistic example response body, as a JSON string"),
});
const DescribeSchemaArgs = z.object({
  schema: z.string().describe("the component schema name to annotate (must be one of the listed schemas)"),
  description: z.string().describe("1-2 plain sentences describing what the schema represents"),
});
const DescribeFieldArgs = z.object({
  schema: z.string().describe("the component schema name that owns the field"),
  field: z.string().describe("the field name to annotate (must exist on that schema)"),
  description: z.string().describe("a short, specific Markdown description of the field (what it is, constraints, example)"),
});
const DescribeApiArgs = z.object({
  description: z.string().describe("a Markdown OVERVIEW of the whole API — what it does, the main resources, how auth works, and a short getting-started (2-5 short paragraphs / lists)"),
});

/** Set summary/description on an EXISTING operation. No-op (ok:false) for an unknown operationId —
 *  the agent can annotate but never invents a path or operation. Exported for deterministic tests. */
export function applyDescribeOperation(
  doc: OpenAPIObject,
  args: { operationId: string; summary?: string; description?: string },
): { ok: boolean } {
  const op = findOperation(doc, args.operationId);
  if (!op) return { ok: false };
  if (args.summary) op.summary = args.summary.trim().slice(0, 200);
  if (args.description) op.description = args.description.trim().slice(0, 4000);
  return { ok: true };
}

/** Set the API-level overview (info.description, Markdown) — the Docs landing. Always applies. */
export function applyDescribeApi(doc: OpenAPIObject, args: { description: string }): { ok: boolean } {
  if (!doc.info) doc.info = { title: "API", version: "1.0.0" } as OpenAPIObject["info"];
  doc.info.description = args.description.trim().slice(0, 6000);
  return { ok: true };
}

/** Attach an example to an EXISTING response (matched by status) of an existing operation. Invalid
 *  JSON or an unknown operation/status is a no-op (ok:false) — examples never create new responses. */
export function applyExampleResponse(
  doc: OpenAPIObject,
  args: { operationId: string; status: string | number; exampleJson: string },
): { ok: boolean } {
  const op = findOperation(doc, args.operationId);
  if (!op) return { ok: false };
  const responses = (op.responses ?? {}) as Record<string, Record<string, unknown>>;
  const resp = responses[String(args.status)];
  if (!resp) return { ok: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(args.exampleJson);
  } catch {
    return { ok: false };
  }
  const content = (resp.content ?? (resp.content = {})) as Record<string, Record<string, unknown>>;
  const json = (content["application/json"] ?? (content["application/json"] = {})) as Record<string, unknown>;
  json.example = parsed;
  return { ok: true };
}

/** Set a description on an EXISTING component schema; unknown schema name is a no-op (ok:false). */
export function applyDescribeSchema(
  doc: OpenAPIObject,
  args: { schema: string; description: string },
): { ok: boolean } {
  const schemas = (doc.components?.schemas ?? {}) as Record<string, Record<string, unknown>>;
  const s = schemas[args.schema];
  if (!s) return { ok: false };
  s.description = args.description.trim().slice(0, 2000);
  return { ok: true };
}

/** Set a description on an EXISTING field of an existing schema; unknown schema/field is a no-op. */
export function applyDescribeField(
  doc: OpenAPIObject,
  args: { schema: string; field: string; description: string },
): { ok: boolean } {
  const schemas = (doc.components?.schemas ?? {}) as Record<string, { properties?: Record<string, Record<string, unknown>> }>;
  const prop = schemas[args.schema]?.properties?.[args.field];
  if (!prop) return { ok: false };
  prop.description = args.description.trim().slice(0, 1000);
  return { ok: true };
}

/** Enrich a deterministic OpenAPI doc with prose + examples via grounded tool calls. The agent is
 *  given an inventory of EXISTING operations and schemas and may only annotate those (every tool
 *  goes through a grounded apply-helper). Structure stays graph-true; the doc is cloned so the
 *  deterministic baseline is never mutated. */
async function aiDocumentizeOpenApi(doc: OpenAPIObject): Promise<OpenAPIObject> {
  const llm = getGenerationChat({ toolCalling: true }); // default model = deepseek-v4-flash (tool calling OK)
  const withTools = llm.bindTools!([
    { name: "describeApi", description: "Set a Markdown OVERVIEW of the whole API (info.description) — the documentation landing. Call once. Returns { ok }.", schema: DescribeApiArgs },
    { name: "describeOperation", description: "Set a summary and/or a rich Markdown description on an EXISTING operation (by operationId). Only listed operationIds. Returns { ok }.", schema: DescribeOperationArgs },
    { name: "exampleResponse", description: "Attach a realistic example body to an EXISTING response (by operationId + status). Only listed operations/statuses. Returns { ok }.", schema: ExampleResponseArgs },
    { name: "describeSchema", description: "Set a Markdown description on an EXISTING component schema (by name). Only listed schemas. Returns { ok }.", schema: DescribeSchemaArgs },
    { name: "describeField", description: "Set a description on an EXISTING field of a schema (by schema + field). Only listed fields. Returns { ok }.", schema: DescribeFieldArgs },
  ]);

  // Clone so the agent annotates a copy — the deterministic baseline is never mutated in place.
  const out = JSON.parse(JSON.stringify(doc)) as OpenAPIObject;

  // Inventory of the EXISTING surface the agent is allowed to annotate (operationIds, statuses, schemas, fields).
  const operations: { operationId: string; method: string; path: string; summary?: string; statuses: string[] }[] = [];
  const paths = (out.paths ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  for (const path of Object.keys(paths)) {
    const item = paths[path] ?? {};
    for (const method of Object.keys(item)) {
      const op = item[method];
      if (op && typeof op === "object" && typeof op.operationId === "string") {
        operations.push({
          operationId: op.operationId,
          method: method.toUpperCase(),
          path,
          summary: typeof op.summary === "string" ? op.summary : undefined,
          statuses: Object.keys((op.responses ?? {}) as Record<string, unknown>),
        });
      }
    }
  }
  const schemaObj = (out.components?.schemas ?? {}) as Record<string, { properties?: Record<string, unknown> }>;
  const schemas = Object.keys(schemaObj).map((name) => ({ schema: name, fields: Object.keys(schemaObj[name]?.properties ?? {}) }));
  if (operations.length === 0 && schemas.length === 0) return out;

  const inventory = JSON.stringify({ operations, schemas });
  const sys =
    "You write developer-friendly documentation for a REST API, in GitHub-flavored MARKDOWN. You are given " +
    "its EXISTING operations (operationId, method, path, response statuses) and component schemas (name + " +
    "fields). Do ALL of: (1) call describeApi ONCE with a Markdown OVERVIEW of the whole API — what it does, " +
    "the main resources, how auth works, and a short getting-started; (2) give each operation a concise summary " +
    "AND a richer Markdown description (what it does, when to use it, key behaviors/errors) using paragraphs, " +
    "bullet lists, and `code` spans where helpful; (3) attach a realistic example body to each operation's main " +
    "success response; (4) write a clear, specific description for each schema and each field. Write real, " +
    "specific prose — not filler like 'This endpoint does X.'. ONLY reference operationIds, statuses, schema " +
    "names and field names from the inventory — a tool targeting something not in the inventory returns " +
    "{ ok:false }. NEVER invent operations, paths, schemas or fields. No secrets or real credentials in " +
    "examples. Call the tools, then stop.";
  const messages: BaseMessage[] = [
    new SystemMessage(sys),
    new HumanMessage("API surface:\n" + inventory + "\n\nDocument the operations and schemas, then stop."),
  ];

  const MAX_TURNS = 12;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const ai = (await withTools.invoke(messages)) as AIMessage;
    const calls = (ai.tool_calls ?? []) as Array<{ id?: string; name: string; args: Record<string, unknown> }>;
    if (calls.length === 0) break;
    messages.push(ai);
    for (const call of calls) {
      let result: { ok: boolean; message?: string };
      try {
        switch (call.name) {
          case "describeApi": {
            const a = DescribeApiArgs.parse(call.args);
            result = applyDescribeApi(out, a).ok ? { ok: true } : { ok: false };
            break;
          }
          case "describeOperation": {
            const a = DescribeOperationArgs.parse(call.args);
            result = applyDescribeOperation(out, a).ok ? { ok: true } : { ok: false, message: `no operation '${a.operationId}'` };
            break;
          }
          case "exampleResponse": {
            const a = ExampleResponseArgs.parse(call.args);
            result = applyExampleResponse(out, a).ok ? { ok: true } : { ok: false, message: `no response '${a.status}' on '${a.operationId}' (or invalid JSON)` };
            break;
          }
          case "describeSchema": {
            const a = DescribeSchemaArgs.parse(call.args);
            result = applyDescribeSchema(out, a).ok ? { ok: true } : { ok: false, message: `no schema '${a.schema}'` };
            break;
          }
          case "describeField": {
            const a = DescribeFieldArgs.parse(call.args);
            result = applyDescribeField(out, a).ok ? { ok: true } : { ok: false, message: `no field '${a.field}' on '${a.schema}'` };
            break;
          }
          default:
            result = { ok: false, message: `unknown tool '${call.name}'` };
        }
      } catch (e) {
        result = { ok: false, message: String((e as Error).message).slice(0, 140) };
      }
      messages.push(new ToolMessage({ content: JSON.stringify(result), tool_call_id: call.id ?? call.name }));
    }
  }
  return out;
}
