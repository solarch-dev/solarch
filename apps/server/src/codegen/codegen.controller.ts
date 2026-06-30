import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  HttpCode,
  NotFoundException,
  UseGuards,
  Sse,
  Query,
  Req,
  type MessageEvent,
} from "@nestjs/common";
import { from, type Observable } from "rxjs";
import { map } from "rxjs/operators";
import { ApiTags, ApiOperation, ApiParam, ApiResponse, type OpenAPIObject } from "@nestjs/swagger";
import { ProjectAccessGuard } from "../auth/project-access.guard";
import { CurrentAuth } from "../auth/current-auth.decorator";
import type { AuthContext } from "../auth/auth.types";
import { BillingService } from "../billing/billing.service";
import { ProjectsRepository } from "../projects/projects.repository";
import { CodegenService } from "./codegen.service";
import type { SystemMapDTO, SimpleSketchModel } from "./simple-projection";
import { CodegenFillService, type FillEvent } from "./codegen-fill.service";
import { ImportResolverService } from "./import-resolver.service";
import { SurgicalFillRepository } from "./surgical-fill.repository";
import { CodegenRequestDto } from "./dto/codegen.dto";
import { CODEGEN_VERSION } from "./codegen.version";
import { ok } from "../common/envelope";
import type { SuccessEnvelope } from "../common/envelope";
import type { GeneratedProject } from "./types";

/** PaymentRequiredException/HttpException gövdesinden code+message çıkar (SSE error event'i). */
function errBody(e: unknown): { code?: string; message: string } {
  const resp = (e as { getResponse?: () => unknown }).getResponse?.();
  if (resp && typeof resp === "object") {
    const r = resp as { code?: string; message?: string };
    return { code: r.code, message: r.message ?? "Error" };
  }
  return { message: (e as Error)?.message ?? "Error" };
}

/** Constructor sürüm durumu + diyagram drift'i — frontend "Codebase improved" /
 *  "diagram changed" rozetlerini buradan kurar. */
export interface CodegenStatus {
  /** Mevcut Constructor sürümü (CODEGEN_VERSION). */
  current: number;
  /** Projeye damgalı sürüm; hiç üretilmemişse null. */
  generated: number | null;
  /** generated != null && generated < current -> daha iyi bir iskelet var. */
  updateAvailable: boolean;
  /** Projenin şu anki yapısal graf revizyonu (node/edge değişimlerinde artar). */
  graphRevision: number;
  /** Üretim anında damgalanan graf revizyonu; hiç üretilmemişse null. */
  generatedGraphRevision: number | null;
  /** DİYAGRAM DRIFT'i: diyagram üretimden bu yana yapısal olarak değişti mi
   *  (generatedGraphRevision != null && graphRevision > generatedGraphRevision).
   *  NOT: bu, kod↔diyagram AST-drift'i DEĞİL (o lokal kodu gerektirir, CLI'da) —
   *  "üretilen kod güncel diyagramdan geride" sinyali; "regenerate" hatırlatır. */
  diagramDrifted: boolean;
  /** Üretimden bu yana yapısal değişiklik sayısı (diagramDrifted ise > 0). */
  driftCount: number;
}

@ApiTags("Codegen")
@UseGuards(ProjectAccessGuard)
@Controller("projects/:projectId/codegen")
export class CodegenController {
  constructor(
    private readonly service: CodegenService,
    private readonly billing: BillingService,
    private readonly projects: ProjectsRepository,
    private readonly fill: CodegenFillService,
    private readonly fills: SurgicalFillRepository,
    private readonly imports: ImportResolverService,
  ) {}

  /** Revert — TEK bir bölgenin saklı (AI/insan) gövdesini sil. Sonraki generate o
   *  bölgeyi NOT_IMPLEMENTED iskeletine döndürür. İdempotent (yoksa 200). Frontend
   *  rail'deki "Revert to stub" aksiyonu bunu çağırır + ardından yeniden üretir. */
  @Delete("fill/:nodeId/:member")
  @HttpCode(200)
  @ApiOperation({ summary: "Revert a filled surgical region back to its stub" })
  @ApiParam({ name: "nodeId", description: "Node UUID of the region" })
  @ApiParam({ name: "member", description: "Method/member name" })
  async revertFill(
    @Param("projectId") projectId: string,
    @Param("nodeId") nodeId: string,
    @Param("member") member: string,
  ): Promise<SuccessEnvelope<{ reverted: true }>> {
    await this.fills.deleteOne(projectId, nodeId, member);
    return ok({ reverted: true });
  }

  /** Basit Görünüm — yazılımcı-OLMAYANlar için mimari grafın READ-ONLY projeksiyonu:
   *  feature haritası (kutular + "kullanır"/"tetikler" okları) + her feature'ın
   *  capability kartları + mantık şeması. Kod ÜRETMEZ, AI yok → ücretsiz, billing-gate
   *  yok (canvas görüntülemek gibi). Aynı graf → aynı çıktı (Mermaid export'un kardeşi). */
  @Get("simple-view")
  @ApiOperation({
    summary: "Non-developer 'Simple View' projection of the architecture graph",
    description:
      "Read-only, deterministic projection for non-technical stakeholders: a feature map " +
      "(boxes + 'uses'/'triggers' arrows) and per-feature capability cards with logic-flow " +
      "diagrams. No code generated, no AI — free. Same graph -> byte-identical output.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: SystemMap` — features[], arrows[], shared?." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async simpleView(@Param("projectId") projectId: string): Promise<SuccessEnvelope<SystemMapDTO>> {
    return ok(await this.service.simpleView(projectId));
  }

  /** Simple SKETCH — Mermaid for the hand-drawn (Excalidraw-style) Simple view. AI
   *  (DeepSeek) refines a deterministic baseline into a friendlier non-dev diagram and
   *  the result is cached per project (LLM runs only when the graph changes); falls back
   *  to the deterministic baseline when AI is unavailable. */
  @Get("simple-sketch")
  @ApiOperation({
    summary: "Mermaid for the hand-drawn Simple sketch (AI-refined, cached, deterministic fallback)",
    description: "Returns `{ mermaid, source }` for the non-developer sketch view.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: { mermaid: string; source: 'ai' | 'deterministic' }`." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async simpleSketch(@Param("projectId") projectId: string): Promise<SuccessEnvelope<{ mermaid: string; source: "ai" | "deterministic" }>> {
    return ok(await this.service.simpleSketch(projectId));
  }

  /** Structured Simple-View model — Mermaid-free `{ nodes, edges, groups }` the client lays
   *  out with ELK and renders with rough.js (the new tool-calling generation path). */
  @Get("simple-sketch-model")
  @ApiOperation({ summary: "Structured Simple-View model (Mermaid-free; ELK-laid-out client-side)" })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: { model: { nodes, edges, groups }, source, aiConfigured }`." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async simpleSketchModel(
    @Param("projectId") projectId: string,
    @Query("stage") stage?: "baseline" | "full",
  ): Promise<SuccessEnvelope<{ model: SimpleSketchModel; source: "ai" | "deterministic"; aiConfigured: boolean }>> {
    return ok(await this.service.simpleSketchModel(projectId, stage === "baseline" ? "baseline" : "full"));
  }

  /** Regenerate the Simple-View model — bypass the per-project cache and re-run the AI refine.
   *  Powers the "Regenerate" button: when a previous run fell back to deterministic (an AI hiccup)
   *  and the graph hasn't changed, this forces a fresh attempt instead of returning the cached one.
   *  Free, no billing gate (like the Simple View — no code is generated). */
  @Post("simple-sketch-model/regenerate")
  @HttpCode(200)
  @ApiOperation({ summary: "Regenerate the Simple-View model (bypass cache, re-run the AI refine)" })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: { model, source, aiConfigured }` — freshly regenerated." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async regenerateSimpleSketchModel(
    @Param("projectId") projectId: string,
  ): Promise<SuccessEnvelope<{ model: SimpleSketchModel; source: "ai" | "deterministic"; aiConfigured: boolean }>> {
    return ok(await this.service.simpleSketchModel(projectId, "full", true));
  }

  /** OpenAPI document — a deterministic, graph-true OpenAPI 3.1 spec the client renders with Scalar.
   *  `?stage=baseline` returns the instant deterministic doc (no AI); otherwise the persisted
   *  AI-enriched doc is served while the graph is unchanged, falling back to the deterministic baseline
   *  when the AI is off or fails. The AI only annotates EXISTING operations/schemas (prose + examples) —
   *  it never invents paths. Free, no billing gate (like the Simple View — no code is generated). */
  @Get("openapi.json")
  @ApiOperation({
    summary: "OpenAPI 3.1 document for the architecture graph (Scalar-rendered, AI-documentized, cached)",
    description: "Returns `{ doc, source, aiConfigured }`. `?stage=baseline` skips the AI for an instant deterministic doc.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: { doc: OpenAPIObject; source: 'ai' | 'deterministic'; aiConfigured: boolean }`." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async openApi(
    @Param("projectId") projectId: string,
    @Query("stage") stage?: "baseline" | "full",
  ): Promise<SuccessEnvelope<{ doc: OpenAPIObject; source: "ai" | "deterministic"; aiConfigured: boolean }>> {
    return ok(await this.service.apiDoc(projectId, stage === "baseline" ? "baseline" : "full"));
  }

  /** AI Documentize — bypass the per-project cache and re-run the AI enrichment over the OpenAPI doc.
   *  Powers the "AI Documentize" button: forces a fresh prose/example pass even when the graph hasn't
   *  changed (e.g. a previous run fell back to deterministic on an AI hiccup). The structure stays
   *  graph-true; only descriptions/examples on existing operations/schemas change.
   *  Free, no billing gate (like the Simple View — no code is generated). */
  @Post("openapi/documentize")
  @HttpCode(200)
  @ApiOperation({ summary: "AI Documentize the OpenAPI doc (bypass cache, re-run the grounded enrichment)" })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: { doc, source, aiConfigured }` — freshly documentized." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async documentizeOpenApi(
    @Param("projectId") projectId: string,
  ): Promise<SuccessEnvelope<{ doc: OpenAPIObject; source: "ai" | "deterministic"; aiConfigured: boolean }>> {
    return ok(await this.service.apiDoc(projectId, "full", true));
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: "Generate deterministic code from the architecture graph (Constructor)",
    description:
      "From the TechnicalGraph (node + edge), generates a deterministic NestJS + TypeScript " +
      "code scaffold **without AI**. The backend chain (Module/Controller/Service/Repository/DTO/Model/" +
      "Table/Enum/Exception) is fully generated; the other 12 types become stubs with surgical markers. " +
      "Method bodies are marked with `@solarch:surgical` markers (the algorithm area — " +
      "the SURGICAL AI that fills these is separate/future, Code tier `canCodegen`). " +
      "The same graph -> byte-identical output.\n\n" +
      "**Build+ generates unlimited.** guest/free/draw get **one free preview per 4h** " +
      "(deterministic, no AI cost — value-before-paywall); once used, 402 ERR_PLAN_METER.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: { target, files[], summary }`." })
  @ApiResponse({ status: 402, description: "`ERR_PLAN_METER` — free preview used (Build for unlimited)." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async generate(
    @Param("projectId") projectId: string,
    @Body() body: CodegenRequestDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<SuccessEnvelope<GeneratedProject>> {
    // Build+ sınırsız; guest/free/draw 4h'de 1 ücretsiz önizleme (402 ERR_PLAN_METER dolunca).
    await this.billing.assertCanGenerateOrFreePass(auth.userId);
    const target = (body as { target?: "nestjs" }).target ?? "nestjs";
    try {
      const project = await this.service.generate(projectId, target);
      // SINIR: AI=algoritma, sistem=import. generate kayıtlı GÖVDELERİ re-inject eder ama
      // import'ları (owned tip/operatör) eklemez → "Cannot find name". Dolu bölge varsa
      // import'ları deterministik çöz (best-effort; hata olursa proje aynen döner). Dolu
      // bölge yoksa (taze iskelet zaten import'lu) atla → temp-dir maliyeti ödenmez.
      if (project.files.some((f) => f.content.includes("@solarch:filled"))) {
        project.files = await this.imports.resolveImports(project.files);
      }
      // DAMGALAMA: başarılı üretim sonrası projeye mevcut Constructor sürümünü yaz.
      // (service.generate proje yoksa zaten 404 atar -> buraya yalnız var olan proje gelir.)
      await this.projects.setCodegenVersion(projectId, CODEGEN_VERSION);
      return ok(project);
    } catch (e) {
      // Ücretsiz-önizleme metresi tüketildiyse hata durumunda iade et (proje-bulunamadı vb.
      // kullanıcının tek hakkını yakmasın). Paid'de consume olmadığından refund no-op (0'da kenetli).
      await this.billing.refund(auth.userId, "codegen").catch(() => {});
      throw e;
    }
  }

  @Sse("fill/stream")
  @ApiOperation({
    summary: "Surgical AI — fill the @solarch:surgical bodies (SSE, Code plan)",
    description:
      "Opens an EventSource. Generates the deterministic skeleton, then fills every `@solarch:surgical` " +
      "method body in parallel with the verification-driven fill agent (grounding + contract + declared-throws + " +
      "import-fix), then runs real `tsc` over the project and repairs failing regions in a loop. " +
      "Pass `?jest=true` to also generate+run behavioural specs (slower). Event types:\n" +
      "- `event: start` — { fileCount, markerCount }\n" +
      "- `event: mode` — { verified, withTests, reason? } verified=false ⇒ deps cache unavailable, draft only\n" +
      "- `event: region` — { status: filled|violation|error, member, file, attempts }\n" +
      "- `event: phase` — { kind: verify|repair|imports|tests, … } the live tsc/repair loop\n" +
      "- `event: report` — { filled, violations, errors, typecheck?, tests? }\n" +
      "- `event: files` — { files[] } the full filled project\n" +
      "- `event: error` — { code, message }\n\n" +
      "**Requires the Code plan** (402 `ERR_PLAN_CODEGEN`). Consumes one `generations` unit; refunded if nothing fills.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  fillStream(
    @Param("projectId") projectId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: { on(event: "close", cb: () => void): void },
    @Query("target") targetQ?: string,
    @Query("jest") jestQ?: string,
  ): Observable<MessageEvent> {
    const target = targetQ === "nestjs" ? "nestjs" : "nestjs"; // şimdilik tek hedef
    // jest ("derin doğrula") opsiyonel: tsc her zaman döngüde; jest yavaş+maliyetli → toggle.
    const withTests = jestQ === "true" || jestQ === "1";
    const ac = new AbortController();
    req.on("close", () => ac.abort());
    const self = this;

    async function* guarded(): AsyncGenerator<FillEvent> {
      try {
        await self.billing.assertCanCodegen(auth.userId); // 402 ERR_PLAN_CODEGEN (Code tier)
      } catch (e) {
        yield { event: "error", ...errBody(e) };
        return;
      }
      try {
        await self.billing.consume(auth.userId, "generations"); // kota (4h pencere)
      } catch (e) {
        yield { event: "error", ...errBody(e) };
        return;
      }
      // Metre LLM'den ÖNCE tüketildi. Hiçbir bölge dolmadan başarısızsa iade et — hata
      // bir THROW olabilir ya da stream içinde bir `error` event'i (ör. ERR_FILL_UNVERIFIED).
      let filledAny = false;
      let hadError = false;
      try {
        for await (const ev of self.fill.fill(projectId, target, ac.signal, { withTests })) {
          if (ev.event === "error") hadError = true;
          if (ev.event === "region" && ev.status === "filled") filledAny = true;
          if (ev.event === "report" && ev.filled > 0) filledAny = true;
          yield ev;
        }
        if (!hadError) await self.projects.setCodegenVersion(projectId, CODEGEN_VERSION).catch(() => {});
      } catch (e) {
        hadError = true;
        yield { event: "error", ...errBody(e) };
      } finally {
        // Hata (throw veya error-event) + hiç dolum yok → tüketilen generation'ı iade et.
        if (hadError && !filledAny) await self.billing.refund(auth.userId, "generations").catch(() => {});
      }
    }

    return from(guarded()).pipe(map((ev: FillEvent) => ({ type: ev.event, data: ev }) as MessageEvent));
  }

  @Get("status")
  @ApiOperation({
    summary: "Constructor version status",
    description:
      "Compares the current Constructor version with the version STAMPED on the project. " +
      "If `generated` is null the project has never generated code (nothing to update). " +
      "`updateAvailable` is true only if the stamped version is older than the current one — the frontend " +
      "uses this to show the 'Your codebase is now better' (Update) badge in the top bar.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: { current, generated, updateAvailable, graphRevision, generatedGraphRevision, diagramDrifted, driftCount }`." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async status(
    @Param("projectId") projectId: string,
  ): Promise<SuccessEnvelope<CodegenStatus>> {
    const generated = await this.projects.getCodegenVersion(projectId);
    if (generated === undefined) {
      throw new NotFoundException({
        code: "ERR_PROJECT_NOT_FOUND",
        message: `Project '${projectId}' not found.`,
      });
    }
    const current = CODEGEN_VERSION;
    const updateAvailable = generated !== null && generated < current;
    // Diyagram drift'i: üretim anındaki graphRevision ile şimdiki fark (kaç yapısal değişiklik).
    const graphRevision = await this.projects.getGraphRevision(projectId);
    const generatedGraphRevision = await this.projects.getCodegenGraphRevision(projectId);
    const diagramDrifted = generatedGraphRevision !== null && graphRevision > generatedGraphRevision;
    const driftCount = diagramDrifted ? graphRevision - generatedGraphRevision! : 0;
    return ok({ current, generated, updateAvailable, graphRevision, generatedGraphRevision, diagramDrifted, driftCount });
  }
}
