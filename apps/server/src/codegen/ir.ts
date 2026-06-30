import type { StoredNode } from "../nodes/nodes.repository";
import type { StoredEdge } from "../edges/edges.repository";
import type { EdgeKind } from "../edges/schemas/edge.schema";
import type {
  NodeKind,
  TableNode,
  ServiceNode,
  ControllerNode,
  DTONode,
  RepositoryNode,
  ModelNode,
  EnumNode,
  ExceptionNode,
  ModuleNode,
} from "../nodes/schemas";

/* ────────────────────────────────────────────────────────────────────────
 * ir.ts — CodeGraph: çözümlenmiş ara temsil (Intermediate Representation).
 *
 * StoredNode/StoredEdge (DB ham hali) -> CodeGraph: emitter'ların ilişki
 * çözümlemek için kullandığı indeksli, sorgulanabilir yapı.
 *
 * TEMEL KURAL: HİÇBİR sorgu THROW ETMEZ. Kayıp ref/node -> null/[] döner.
 * Codegen kısmi (eksik) graph'ta da çalışmalı; atlamayı çağıran (emitter) verir.
 *
 * İLİŞKİ İKİ KAYNAKTAN örülür:
 *   (1) node property ref'leri (Service.Dependencies.Ref, Repository.EntityReference,
 *       Model.TableRef/RelatedModelRef, DTO field NestedDTORef/EnumRef,
 *       Controller.Endpoints DTO ref'leri, Module.ExposedServices/Dependencies).
 *   (2) edge'ler (CALLS, USES, QUERIES/WRITES, THROWS, EXTENDS, HAS, ROUTES_TO ...).
 *   KRİTİK: Controller->Service YALNIZ CALLS edge'inden gelir (Controller şemasında
 *   servis ref'i YOKTUR). Emitter'lar bunu graph.outEdges(controllerId, "CALLS") ile
 *   çözer.
 * ──────────────────────────────────────────────────────────────────────── */

/** Node ad alanını (TableName/ServiceName/...) kind'a göre çözen tek kaynak.
 *  NodesRepository'deki NAME_KEYS_BY_KIND ile birebir aynı tutulmalıdır. */
const NAME_KEY_BY_KIND: Record<NodeKind, string> = {
  Table: "TableName",
  DTO: "Name",
  Model: "ClassName",
  Enum: "Name",
  View: "ViewName",
  Service: "ServiceName",
  Worker: "WorkerName",
  EventHandler: "HandlerName",
  Controller: "ControllerName",
  MessageQueue: "QueueName",
  Repository: "RepositoryName",
  Cache: "CacheName",
  ExternalService: "ServiceName",
  FrontendApp: "AppName",
  UIComponent: "ComponentName",
  Middleware: "MiddlewareName",
  EnvironmentVariable: "Key",
  Exception: "ExceptionName",
  Module: "ModuleName",
  APIGateway: "GatewayName",
  Orchestrator: "OrchestratorName",
};

/** NestJS backend kapsamı DIŞINDA kalan node kind'ları. Bunlar için DOSYA
 *  ÜRETİLMEZ (bir backend'de frontend bileşenin yeri yoktur); feature-inference
 *  de bunları es geçer, orchestrator skippedKinds'e sayar.
 *
 *  NOT: View ARTIK kapsam-dışı DEĞİL — bir DB view de bir SQL migration üretir
 *  (CREATE VIEW), Table gibi migrations/ kökünde. Yalnız saf-istemci kind'lar
 *  (FrontendApp/UIComponent) bir backend'de yer bulmaz. */
export const EXCLUDED_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  "FrontendApp",
  "UIComponent",
]);

/** Bir çıkarılmış (veya açık Module'den gelen) FEATURE — orchestrator bu
 *  tanımlardan <feature>.module.ts SENTEZLER (Module node OLMASA bile).
 *  Tüm listeler isme göre sıralı (determinizm). */
export interface Feature {
  /** kebab-case feature slug ("auth", "image", ...). */
  slug: string;
  /** (varsa) bu feature'ı tohumlayan açık Module node; yoksa null (sentez). */
  module: CodeNode | null;
  /** Bu feature'a ait Controller node'ları (isme göre sıralı). */
  controllers: CodeNode[];
  /** Bu feature'a ait APIGateway node'ları (isme göre sıralı). Bir APIGateway
   *  GERÇEK bir @Controller olarak emit edilir (route'ları kendi HTTP metodları)
   *  -> module @Module.controllers'a Controller'larla BİRLİKTE eklenir (orphan
   *  kalmaz; NestJS routing'i otomatik bağlar). Provider DEĞİLDİR. */
  gateways: CodeNode[];
  /** Bu feature'a ait Service node'ları (isme göre sıralı). */
  services: CodeNode[];
  /** Bu feature'a ait Repository node'ları (isme göre sıralı). */
  repositories: CodeNode[];
  /** Bu feature'a ait Model (entity) node'ları — TypeOrmModule.forFeature için. */
  entities: CodeNode[];
  /** Bu feature'a ait, bir Repository tarafından referans edilen ama Model'i
   *  OLMAYAN Table node'ları. Her biri için bir @Entity SENTEZLENİR ve
   *  TypeOrmModule.forFeature'a Model entity'leriyle birlikte eklenir -> DI tam. */
  syntheticEntityTables: CodeNode[];
  /** Bu feature'ın service'lerine DI ile enjekte edilen stub node'lar
   *  (tam emitter'ı OLMAYAN enjekte edilebilir kind'lar). @Injectable() stub
   *  olarak üretilir ve module providers'ına eklenir. NOT: Cache/ExternalService
   *  artık TAM emitter'a sahip -> infraProviders'ta toplanır; bu liste şu an
   *  pratikte boştur ama mekanizma ileride yeni stub kind'lar için korunur. */
  stubProviders: CodeNode[];
  /** Bu feature'a ait, Service/Repository OLMAYAN ama TAM (gerçek) @Injectable()
   *  emitter'a sahip mimari altyapı provider'ları: Cache, ExternalService,
   *  Worker, EventHandler, Orchestrator, MessageQueue (producer). Hepsi module
   *  providers'ına eklenir; sınıf adı pascalCase(name) (Stub eki YOK). */
  infraProviders: CodeNode[];
  /** Bu feature'a ait Middleware node'ları (isme göre sıralı). module.emitter
   *  bunlardan NestModule.configure(consumer).apply(X).forRoutes(...) sentezler;
   *  Middleware @Injectable() olduğundan providers'a da eklenir. */
  middlewares: CodeNode[];
  /** Başka feature'ların kullandığı (dışa açılması gereken) provider node'ları:
   *  Service VEYA Repository (cross-feature CALLS hedefi). NestJS'te export
   *  edilmeyen provider modül-dışı görünmez -> bootta DI hatası verir. */
  exports: CodeNode[];
  /** Bu feature'ın bağımlı olduğu DİĞER feature slug'ları (cross-feature import). */
  dependsOn: string[];
  /** dependsOn ALT KÜMESİ: bir module-import DÖNGÜSÜNÜ kırmak için
   *  `forwardRef(() => XModule)` ile emit edilmesi GEREKEN bağımlılık slug'ları
   *  (breakCircularImports işaretler). Kenar dependsOn'da KORUNUR (silinmez) —
   *  yalnız emit'i lazy olur; NestJS döngüyü boot'ta forwardRef ile çözer. */
  forwardRefDeps: string[];
}

/** node.properties'in kind'a göre tipli görünümü.
 *  Emitter'lar `(node.properties as TableNode["properties"])` yerine helper
 *  kullanır: `propsOf<"Table">(node)`. */
export interface CodeNode extends StoredNode {
  /** Çözülmüş node adı (ilgili *Name alanı; yoksa boş string). */
  readonly name: string;
  /** node.type'ı NodeKind olarak döndüren yardımcı (StoredNode.type alias).
   *  StoredNode.type zaten NodeKind; kindOf() okunabilirlik + ileri-uyumluluk
   *  (bilinmeyen tip normalize) için sağlanır. */
  kindOf(): NodeKind;
}

/** Kind -> properties tip eşlemesi. Emitter'lar `propsOf(node)` ile tipli erişir. */
export interface PropsByKind {
  Table: TableNode["properties"];
  Service: ServiceNode["properties"];
  Controller: ControllerNode["properties"];
  DTO: DTONode["properties"];
  Repository: RepositoryNode["properties"];
  Model: ModelNode["properties"];
  Enum: EnumNode["properties"];
  Exception: ExceptionNode["properties"];
  Module: ModuleNode["properties"];
}

/** Tipli properties erişimi. Çağıran kind'ı bilir:
 *    const p = propsOf<"Service">(node);  // p: ServiceNode["properties"]
 *  Çalışma zamanı dönüşümü YOK — yalnız tip daraltma (DB zaten Zod-doğrulanmış). */
export function propsOf<K extends keyof PropsByKind>(node: CodeNode): PropsByKind[K] {
  return node.properties as PropsByKind[K];
}

/* ── İndekslenmiş graph ──────────────────────────────────────────────────── */
export class CodeGraph {
  readonly nodes: readonly CodeNode[];
  readonly edges: readonly StoredEdge[];

  private readonly _byId = new Map<string, CodeNode>();
  /** "kind name" -> node (proje içi name global unique varsayımı). */
  private readonly _byKindName = new Map<string, CodeNode>();
  /** "name" -> node (kind'tan bağımsız hızlı çözüm; ilk-kazanır, deterministik
   *  çünkü nodes isme göre sıralanır). */
  private readonly _byName = new Map<string, CodeNode>();
  private readonly _byKind = new Map<NodeKind, CodeNode[]>();
  private readonly _outBySource = new Map<string, StoredEdge[]>();
  private readonly _inByTarget = new Map<string, StoredEdge[]>();
  private readonly _moduleCache = new Map<string, CodeNode | null>();
  private _migrationOrder: string[] | null = null;
  /** node.id -> feature slug | "common" (lazy, feature-inference sonucu). */
  private _featureOf: Map<string, string> | null = null;
  /** çıkarılmış Feature tanımları (slug -> Feature), slug'a göre sıralı. */
  private _features: Feature[] | null = null;
  /** #7: cross-feature enjekte edilen infra provider id -> TEK sahip feature slug.
   *  computeFeatures sırasında doldurulur; collectInjectedInfraProviders sahip-dışı
   *  feature'larda provider'ı elemek için okur (singleton: tek module'de provider). */
  private _infraOwner: Map<string, string> = new Map();
  /** #7: infra provider id -> onu enjekte eden DİSTİNCT feature slug'ları.
   *  KAYNAK = Service.Dependencies property'si + inject-edge'ler (BİREBİR
   *  collectInjectedInfraProviders ile). isCrossFeatureInjectTarget bunu okur ki
   *  property-Dependency ile (EDGE OLMADAN) enjekte eden bir feature da SAHİBİN
   *  export'unu tetiklesin -> aksi halde sahip export etmez, tüketen bootta DI
   *  çözemez. computeInfraOwners doldurur. */
  private _infraInjectorSlugs: Map<string, Set<string>> = new Map();
  /** Deterministik codegen uyarıları (ör. kırılan döngüsel module import'ları).
   *  computeFeatures sırasında doldurulur; isme göre sıralı. */
  private _warnings: string[] = [];

  constructor(nodes: CodeNode[], edges: StoredEdge[]) {
    // DETERMİNİZM: node'lar isme (sonra id'ye) göre sıralı tutulur.
    this.nodes = [...nodes].sort(byNameThenId);
    // Edge'ler kind, source.name, target.name, id'ye göre sıralı.
    const nameOf = (id: string) => this._byId.get(id)?.name ?? "";
    for (const n of this.nodes) {
      this._byId.set(n.id, n);
      this._byKindName.set(kindNameKey(n.kindOf(), n.name), n);
      if (!this._byName.has(n.name)) this._byName.set(n.name, n);
      const arr = this._byKind.get(n.kindOf());
      if (arr) arr.push(n);
      else this._byKind.set(n.kindOf(), [n]);
    }
    this.edges = [...edges].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      const sa = nameOf(a.sourceNodeId);
      const sb = nameOf(b.sourceNodeId);
      if (sa !== sb) return sa < sb ? -1 : 1;
      const ta = nameOf(a.targetNodeId);
      const tb = nameOf(b.targetNodeId);
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    for (const e of this.edges) {
      pushTo(this._outBySource, e.sourceNodeId, e);
      pushTo(this._inByTarget, e.targetNodeId, e);
    }
  }

  /** id ile node (yoksa null). */
  byId(id: string): CodeNode | null {
    return this._byId.get(id) ?? null;
  }

  /** kind + name ile node (yoksa null). */
  byName(kind: NodeKind, name: string): CodeNode | null {
    return this._byKindName.get(kindNameKey(kind, name)) ?? null;
  }

  /** Bir node'un çıkan edge'leri (opsiyonel kind filtresi). Asla null dönmez. */
  outEdges(id: string, kind?: EdgeKind): StoredEdge[] {
    const all = this._outBySource.get(id) ?? [];
    return kind ? all.filter((e) => e.kind === kind) : all;
  }

  /** Bir node'a gelen edge'ler (opsiyonel kind filtresi). Asla null dönmez. */
  inEdges(id: string, kind?: EdgeKind): StoredEdge[] {
    const all = this._inByTarget.get(id) ?? [];
    return kind ? all.filter((e) => e.kind === kind) : all;
  }

  /** Belirli kind'taki tüm node'lar (isme göre sıralı). Asla null dönmez. */
  allOf(kind: NodeKind): CodeNode[] {
    return this._byKind.get(kind) ?? [];
  }

  /** Bir ref ismini bir veya birden çok kind içinde çözer (ilk eşleşen).
   *  kind verilmezse name-global çözüm. Bulamazsa null (THROW ETMEZ). */
  resolveRef(kind: NodeKind | NodeKind[] | undefined, name: string): CodeNode | null {
    if (kind === undefined) return this._byName.get(name) ?? null;
    const kinds = Array.isArray(kind) ? kind : [kind];
    for (const k of kinds) {
      const found = this.byName(k, name);
      if (found) return found;
    }
    return null;
  }

  /** Bir node'un ait olduğu Module node'u (heuristik). Bulamazsa null
   *  (= app.module / kök seviye). Sonuç cache'lenir.
   *
   *  Heuristik:
   *   - node Module ise -> kendisi.
   *   - Module.ExposedServices içinde geçen Service'ler o modüle aittir;
   *     ayrıca Module-[USES]->Service edge'i de bağlar.
   *   - Controller -> CALLS ettiği ilk Service'in modülüne.
   *   - Repository -> kendisine bağımlı (Service.Dependencies veya
   *     Service-[CALLS]->Repository) ilk Service'in modülüne.
   *   - Model/DTO/Enum/Exception/Table -> şu an modülden bağımsız (null);
   *     bunların dosya yolu featureFolderOf içinde kendi domain'inden türer.
   *   - artakalanlar -> null. */
  moduleOf(node: CodeNode): CodeNode | null {
    if (this._moduleCache.has(node.id)) return this._moduleCache.get(node.id) ?? null;
    const result = this.computeModuleOf(node);
    this._moduleCache.set(node.id, result);
    return result;
  }

  private computeModuleOf(node: CodeNode): CodeNode | null {
    if (node.kindOf() === "Module") return node;

    const modules = this.allOf("Module");

    if (node.kindOf() === "Service") {
      // ExposedServices içinde adı geçen ilk modül.
      for (const m of modules) {
        const exposed = propsOf<"Module">(m).ExposedServices ?? [];
        if (exposed.includes(node.name)) return m;
      }
      // Module-[USES]->Service edge'i.
      for (const e of this.inEdges(node.id, "USES")) {
        const src = this.byId(e.sourceNodeId);
        if (src && src.kindOf() === "Module") return src;
      }
      return null;
    }

    if (node.kindOf() === "Controller") {
      const svc = this.firstCalledService(node.id);
      return svc ? this.moduleOf(svc) : null;
    }

    if (node.kindOf() === "Repository") {
      // (a) Bu repo'ya bağımlı ilk Service (Dependencies veya CALLS).
      const svc = this.firstDependentService(node);
      if (svc) return this.moduleOf(svc);
      // (b) Açık bağ yoksa: EntityReference ile adlanan Model/Table'ın modülü.
      const entityRef = (node.properties as Record<string, unknown>).EntityReference;
      if (typeof entityRef === "string" && entityRef.length > 0) {
        const entity = this.resolveRef(["Model", "Table"], entityRef);
        if (entity) {
          const entMod = this.moduleOf(entity);
          if (entMod) return entMod;
        }
      }
      // (c) Hâlâ yoksa: aynı domain'i (stem) paylaşan ilk Service'in modülü.
      const domainSvc = this.serviceSharingDomain(node);
      return domainSvc ? this.moduleOf(domainSvc) : null;
    }

    return null;
  }

  /** Bir Repository ile aynı "domain stem"ini paylaşan ilk Service (isme göre
   *  sıralı). Repository "UserRepository" -> stem "user"; Service "UsersService"
   *  -> stem "users". Eşleşme için ikisinin de çoğul/tekil farkını eleyen ortak
   *  kök karşılaştırılır (tekilleştirilmiş kebab). Açık Dependencies/CALLS bağı
   *  olmadığında repo ile service'i AYNI feature'da tutmak için kullanılır. */
  private serviceSharingDomain(repo: CodeNode): CodeNode | null {
    const repoStem = domainStem(stripKindSuffix(repo.name, "Repository"));
    for (const svc of this.allOf("Service")) {
      if (domainStem(stripKindSuffix(svc.name, "Service")) === repoStem) return svc;
    }
    return null;
  }

  /** Controller'ın CALLS ettiği ilk Service (isme göre sıralı, deterministik). */
  private firstCalledService(controllerId: string): CodeNode | null {
    for (const e of this.outEdges(controllerId, "CALLS")) {
      const tgt = this.byId(e.targetNodeId);
      if (tgt && tgt.kindOf() === "Service") return tgt;
    }
    return null;
  }

  /** Bir Repository'ye bağımlı ilk Service (Service.Dependencies.Ref veya
   *  Service-[CALLS]->Repository). */
  private firstDependentService(repo: CodeNode): CodeNode | null {
    for (const svc of this.allOf("Service")) {
      const deps = propsOf<"Service">(svc).Dependencies ?? [];
      if (deps.some((d) => d.Kind === "Repository" && d.Ref === repo.name)) return svc;
    }
    for (const e of this.inEdges(repo.id, "CALLS")) {
      const src = this.byId(e.sourceNodeId);
      if (src && src.kindOf() === "Service") return src;
    }
    return null;
  }

  /* ── FEATURE-INFERENCE (mimari-farkındalık) ──────────────────────────────
   * Her node bir feature slug'a VEYA "common"a atanır. Graph'ta Module node
   * varsa onlar SEED kullanılır (kullanıcı niyetine saygı: ExposedServices +
   * bağımlılık kapanışı). Yoksa (yaygın) Controller'lardan çıkarılır:
   *   SEED: her Controller bir feature, slug = kebab(baseNameOf(controller)).
   *   ATAMA (deterministik sahiplik): Service<-CALLS eden Controller; Repository
   *   <-CALLS eden Service (yoksa WRITES/QUERIES Table); Table<-WRITES/QUERIES
   *   eden Repository; DTO<-USES eden Controller/Service; Enum/Exception<-kullanan;
   *   stub'lar<-en çok bağlı node. >=2 farklı feature -> "common".
   * Kayıp ref TOLERE edilir (throw yok). Sonuç cache'lenir.
   * ──────────────────────────────────────────────────────────────────────── */

  /** Bir node'un ait olduğu feature slug'ı ("auth", "image", ...) veya "common".
   *  Kapsam-dışı (FrontendApp/UIComponent/View) node için yine bir slug döner ama
   *  isExcluded(node)=true olduğundan dosya üretilmez. */
  featureOf(node: CodeNode): string {
    if (this._featureOf === null) this.computeFeatures();
    return this._featureOf!.get(node.id) ?? "common";
  }

  /** Çıkarılmış tüm Feature tanımları (slug'a göre sıralı). Orchestrator bunlardan
   *  <feature>.module.ts sentezler (Module node olmasa bile). */
  features(): Feature[] {
    if (this._features === null) this.computeFeatures();
    return this._features!;
  }

  /** Codegen sırasında üretilen DETERMİNİSTİK uyarılar (isme göre sıralı). Şu an:
   *  iki feature'ın KARŞILIKLI (A<->B) module import'ı tespit edilince NestJS boot'ta
   *  circular dependency hatası vermemesi için döngünün BİR yönü kırılır; her kırılan
   *  geri-kenar burada bir uyarı satırı olur. forwardRef ÜRETİLMEZ — yapı düzeltilir.
   *  Orchestrator bunu summary'e/loglara dökebilir. */
  warnings(): string[] {
    if (this._features === null) this.computeFeatures();
    return this._warnings;
  }

  /** node NestJS backend kapsamı DIŞINDA mı? (FrontendApp/UIComponent/View) */
  isExcluded(node: CodeNode): boolean {
    return EXCLUDED_KINDS.has(node.kindOf());
  }

  /** Bir Table/View node'unun migration sırası (0-based). FK + View.SourceTables
   *  bağımlılık topolojisi + isim. Önce bağımlı olunan nesneler gelir; View'lar
   *  daima kaynak Table'larından SONRA. Eşitlik isimle kırılır. */
  migrationIndexOf(node: CodeNode): number {
    if (this._migrationOrder === null) this._migrationOrder = this.computeMigrationOrder();
    const idx = this._migrationOrder.indexOf(node.id);
    return idx < 0 ? 0 : idx;
  }

  /** Tüm Table + View'lar için topolojik + isim-deterministik migration sırası
   *  (id listesi). Table'lar FK'leriyle, View'lar SourceTables ile bağımlılık
   *  verir; bir Table ASLA bir View'a bağlanmaz -> View'lar her zaman kaynak
   *  Table'larından sonra yerleşir. */
  private computeMigrationOrder(): string[] {
    const tables = this.allOf("Table"); // zaten isme göre sıralı
    const views = this.allOf("View");    // zaten isme göre sıralı
    // Migration nesneleri: Table'lar önce (isimce), sonra View'lar (isimce).
    // Kahn turu bağımlılıkları çözse de bu sıra eşitlik durumunda kullanılır.
    const objects = [...tables, ...views];
    const byTableName = new Map<string, CodeNode>();
    for (const t of tables) byTableName.set(t.name, t);

    // adj: nesne -> bağımlı olduğu (önce gelmesi gereken) nesneler.
    //   Table: FK ReferencesTable -> Table.
    //   View:  SourceTables -> Table.
    const deps = new Map<string, Set<string>>();
    for (const o of objects) deps.set(o.id, new Set());
    for (const t of tables) {
      const fks = propsOf<"Table">(t).ForeignKeys ?? [];
      for (const fk of fks) {
        const ref = byTableName.get(fk.ReferencesTable);
        if (ref && ref.id !== t.id) deps.get(t.id)!.add(ref.id);
      }
    }
    for (const v of views) {
      const sources = (v.properties as Record<string, unknown>).SourceTables;
      if (Array.isArray(sources)) {
        for (const src of sources) {
          const ref = typeof src === "string" ? byTableName.get(src) : undefined;
          if (ref && ref.id !== v.id) deps.get(v.id)!.add(ref.id);
        }
      }
    }

    // Kahn benzeri: bağımlılığı çözülmüş nesneleri (objects sırasında) al.
    const ordered: string[] = [];
    const placed = new Set<string>();
    const remaining = objects.map((o) => o.id);
    let guard = 0;
    while (placed.size < objects.length && guard++ <= objects.length + 1) {
      let progressed = false;
      for (const id of remaining) {
        if (placed.has(id)) continue;
        const unmet = [...deps.get(id)!].some((d) => !placed.has(d));
        if (!unmet) {
          ordered.push(id);
          placed.add(id);
          progressed = true;
        }
      }
      if (!progressed) break; // döngü -> kalanları isim sırasında ekle
    }
    for (const id of remaining) if (!placed.has(id)) ordered.push(id);
    return ordered;
  }

  /* ── computeFeatures: feature-inference çekirdeği ─────────────────────────
   * 1) SEED: Module node varsa onlardan; yoksa Controller'lardan feature slug'lar.
   * 2) ATAMA: her node'a deterministik sahiplik kuralıyla bir slug ata.
   * 3) "common" yükseltme: >=2 farklı feature'da kullanılan paylaşımlı node'lar.
   * 4) Feature[] tanımlarını (controllers/services/repos/entities/exports/deps) kur.
   * Sonuç _featureOf + _features map'lerine yazılır (cache). ──────────────── */
  private computeFeatures(): void {
    const assign = new Map<string, string>(); // node.id -> slug
    const modules = this.allOf("Module");
    const controllers = this.allOf("Controller");
    // APIGateway gerçek bir @Controller olarak emit edilir -> Controller'larla
    // AYNI şekilde feature tohumlar ve atanır (kendi route'larıyla bir HTTP
    // giriş katmanıdır; orphan kalmamalı).
    const gateways = this.allOf("APIGateway");

    // ── 1) SEED ──────────────────────────────────────────────────────────
    // Module node varsa: kullanıcı niyetine saygı (her Module bir feature).
    //   slug = kebab(baseName(Module)). ExposedServices + USES edge'leri o
    //   modülün service'lerini, onların CALLS kapanışı da repo/entity'leri toplar.
    // Yoksa: her Controller bir feature (slug = kebab(baseName(Controller))).
    if (modules.length > 0) {
      for (const m of modules) {
        const slug = featureSlug(m);
        assign.set(m.id, slug);
        // ExposedServices -> Service'ler bu modüle ait.
        for (const name of propsOf<"Module">(m).ExposedServices ?? []) {
          const svc = this.resolveRef("Service", name);
          if (svc && !assign.has(svc.id)) assign.set(svc.id, slug);
        }
        // Module-[USES]->Service edge'i de bağlar.
        for (const e of this.outEdges(m.id, "USES")) {
          const tgt = this.byId(e.targetNodeId);
          if (tgt && tgt.kindOf() === "Service" && !assign.has(tgt.id)) assign.set(tgt.id, slug);
        }
      }
    }
    // Her Controller daima bir feature tohumlar (Module'lü grafikte de
    // module'süz kalan controller'lar sahipsiz kalmasın).
    for (const c of controllers) {
      if (!assign.has(c.id)) assign.set(c.id, featureSlug(c));
    }
    // APIGateway: CALLS/ROUTES_TO ile bir Service/Controller'a bağlıysa onun
    //   feature'ına; değilse kendi adından bir feature tohumlar. Böylece her
    //   gateway bir feature module'ün controllers'ına girer (orphan değil).
    for (const g of gateways) {
      if (assign.has(g.id)) continue;
      const target = this.firstGatewayTargetFeature(g, assign);
      assign.set(g.id, target ?? featureSlug(g));
    }

    // ── 2) ATAMA (deterministik sahiplik; çoklu farklı -> "common") ────────
    // Service: onu CALLS eden Controller'ın feature'ı. ÇOKLU controller ->
    //   isimce İLK (common DEĞİL). Hiç controller yoksa kendi adından feature.
    for (const svc of this.allOf("Service")) {
      if (assign.has(svc.id)) continue;
      const first = this.firstSourceFeature(svc.id, "CALLS", "Controller", assign);
      assign.set(svc.id, first ?? featureSlug(svc));
    }
    // Repository sahipliği (#4 cross-feature DI): bir Repository, AYNI DOMAIN'i
    //   paylaşan Service'in feature'ında DURMALI (UserRepository<->UserService,
    //   PaymentRepository<->PaymentService). Aksi halde repo'yu CALLS eden ilk
    //   service'e (isimce) düşerdi; ör. OrderService cross-feature olarak
    //   PaymentRepository'yi çağırınca repo YANLIŞ feature'a (order) kayar, gerçek
    //   sahibi (payment) onu provider/export edemez -> PaymentService bootta
    //   "can't resolve PaymentRepository" alır. Domain co-location bunu önler:
    //     (a) domain-stem paylaşan Service'in feature'ı (asıl sahip),
    //     (b) yoksa onu CALLS eden ilk Service'in feature'ı (isimce; mevcut davranış),
    //     (c) ikisi de yoksa ikinci tur (entity feature) çözer.
    for (const repo of this.allOf("Repository")) {
      if (assign.has(repo.id)) continue;
      const domainSvc = this.serviceSharingDomain(repo);
      const domainFeature = domainSvc ? assign.get(domainSvc.id) ?? featureSlug(domainSvc) : null;
      const first = domainFeature ?? this.firstSourceFeature(repo.id, "CALLS", "Service", assign);
      if (first) assign.set(repo.id, first);
    }
    // Table/Model: onu WRITES (yoksa QUERIES) eden Repository'nin feature'ı.
    //   Ek: Repository.EntityReference property ref'i ile sahiplenen Repository
    //   (TypeOrmModule.forFeature DI'ı için entity repo ile AYNI feature'da
    //   olmalı). Model<->Table TableRef ile co-locate edilir. Çoklu FARKLI ->
    //   "common".
    for (const ent of [...this.allOf("Table"), ...this.allOf("Model")]) {
      if (assign.has(ent.id)) continue;
      const owners = this.entityOwnerFeatures(ent, assign);
      const picked = pickFeature(owners);
      if (picked) assign.set(ent.id, picked);
    }
    // Repository ikinci tur: hâlâ atanmamışsa EntityReference/WRITES/QUERIES ettiği
    //   Table/Model'in feature'ından (artık atanmış olabilir).
    for (const repo of this.allOf("Repository")) {
      if (assign.has(repo.id)) continue;
      const ents = this.featuresOfTargets(repo.id, ["WRITES", "QUERIES"], ["Table", "Model"], assign);
      const ref = (repo.properties as Record<string, unknown>).EntityReference;
      if (typeof ref === "string") {
        const ent = this.resolveRef(["Model", "Table"], ref);
        const f = ent ? assign.get(ent.id) : undefined;
        if (f) ents.add(f);
      }
      assign.set(repo.id, pickFeature(ents) ?? featureSlug(repo));
    }
    // Table/Model ikinci tur: Model<->Table TableRef co-location; yoksa kendi adı.
    for (const ent of [...this.allOf("Table"), ...this.allOf("Model")]) {
      if (assign.has(ent.id)) continue;
      const owners = this.entityOwnerFeatures(ent, assign);
      assign.set(ent.id, pickFeature(owners) ?? featureSlug(ent));
    }

    // DTO: onu USES eden Controller/Service'in feature'ı. Coklu FARKLI -> "common".
    //   USES edge yoksa: Controller Endpoints (Request/ResponseDTORef) +
    //   Service Method DtoRef'lerden kullananı bul.
    for (const dto of this.allOf("DTO")) {
      if (assign.has(dto.id)) continue;
      const owners = this.dtoConsumerFeatures(dto, assign);
      assign.set(dto.id, pickFeature(owners) ?? "common");
    }

    // Enum: USES eden node(lar)ın feature'ı; çoklu farklı -> "common".
    for (const en of this.allOf("Enum")) {
      if (assign.has(en.id)) continue;
      const owners = this.referrerFeatures(en.id, assign);
      assign.set(en.id, pickFeature(owners) ?? "common");
    }
    // Exception: THROWS eden Service'in feature'ı; çoklu farklı -> "common".
    for (const ex of this.allOf("Exception")) {
      if (assign.has(ex.id)) continue;
      const owners = this.featuresOfSources(ex.id, "THROWS", "Service", assign);
      assign.set(ex.id, pickFeature(owners) ?? "common");
    }

    // Stub'lar (Cache/MessageQueue/ExternalService/Worker/EventHandler/Middleware/
    //   EnvironmentVariable...): en çok bağlı olduğu node'un feature'ı; belirsiz ->
    //   "common". Kapsam-dışı (Frontend/UI/View) atanır ama dosya üretilmez.
    for (const n of this.nodes) {
      if (assign.has(n.id)) continue;
      const owners = this.referrerFeatures(n.id, assign, /* includeOutgoing */ true);
      assign.set(n.id, pickFeature(owners) ?? "common");
    }

    // ── #7 INFRA SINGLETON SAHİPLİĞİ ─────────────────────────────────────────
    // Bir Cache/ExternalService (ör. PaymentGateway) BİRDEN ÇOK feature'ın
    //   service'ince enjekte edilirse, pickFeature onu "common"a düşürür AMA
    //   collectInjectedInfraProviders her enjekte eden feature'ın providers'ına da
    //   koyardı -> aynı sınıf iki+ module'de provider -> iki+ ayrı örnek (singleton
    //   KIRILIR). Çözüm: cross-feature enjekte edilen her infra provider'a TEK
    //   DETERMİNİSTİK SAHİP feature ata (enjekte eden feature slug'larından isimce
    //   İLKİ). assign'ı bu sahibe yeniden yaz; böylece (a) yalnız sahip onu
    //   inFeature ile provider/export eder, (b) "common"dan çıkar (CommonModule
    //   tekrar yazmaz), (c) diğer enjekte edenler provider'ın out-edge'i sayesinde
    //   dependsOn[sahip] kazanıp SAHİBİN module'ünü import eder (tekrar provider
    //   YAZMAZ). collectInjectedInfraProviders ayrıca sahip-dışı feature'ları eler.
    this._infraOwner = this.computeInfraOwners(assign);
    for (const [providerId, ownerSlug] of this._infraOwner) {
      assign.set(providerId, ownerSlug);
    }

    this._featureOf = assign;
    this._features = this.buildFeatureDefs(assign, modules);
  }

  /** #7: Cross-feature enjekte edilen her infra provider (Cache/ExternalService)
   *  için TEK deterministik SAHİP feature slug'ı. providerId -> ownerSlug.
   *
   *  SAHİP SEÇİMİ (deterministik + DÖNGÜSÜZ): sahibi, onu enjekte eden DİĞER
   *  feature'lar SAHİBİN module'ünü import ederek alır. Bu yeni import'ların bir
   *  DÖNGÜ (A<->B) yaratmaması için sahip, "diğer enjekte edenlerin ZATEN bağımlı
   *  olduğu" feature OLMALI; yani sahip ne kadar çok enjekte edence bağımlıysa o
   *  kadar az YENİ kenar doğar. Bu yüzden sahip = enjekte edenler ARASINDA, diğer
   *  enjekte edenlerce EN ÇOK bağımlı olunan (in-degree) feature; eşitlik isimce
   *  ilk slug ile kırılır (stabil). Örn. order->payment service-call'u varken
   *  PaymentGateway'i ikisi de enjekte ederse sahip PAYMENT seçilir (order zaten
   *  payment'a bağımlı -> yeni geri-kenar yok, döngü yok). YALNIZ >=2 FARKLI feature
   *  enjekte edenler haritaya girer (tek feature enjekte ediyorsa zaten o feature'da
   *  durur; "common" sahip OLAMAZ -> module sentezlenmez, export edemez). */
  private computeInfraOwners(assign: Map<string, string>): Map<string, string> {
    // providerId -> onu enjekte eden DİSTİNCT feature slug'ları ("common" hariç).
    //   KAYNAK = collectInjectedInfraProviders ile BİREBİR AYNI: (1) Service.Dependencies
    //   property'si (Kind=Cache/ExternalService, resolveRef ile çözülür — EDGE GEREKMEZ)
    //   + (2) Service-[CALLS/CACHES_IN/REQUESTS]->provider edge'leri. Eskiden YALNIZ
    //   edge'lere bakılıyordu -> property-Dependency ile enjekte eden feature SAYILMIYOR,
    //   injector sayısı 2'nin altına düşüp tek-sahip kuralı DEVREYE GİRMİYORDU
    //   (ör. OrderService PaymentGateway'i property-dep ile enjekte eder, edge yok ->
    //   PaymentGateway hem order hem payment module'üne provider olur -> singleton kırık).
    const injectorSlugsByProvider = new Map<string, Set<string>>();
    const note = (providerId: string, slug: string | undefined): void => {
      if (!slug || slug === "common") return; // common module export edemez
      const set = injectorSlugsByProvider.get(providerId) ?? new Set<string>();
      set.add(slug);
      injectorSlugsByProvider.set(providerId, set);
    };
    for (const svc of this.allOf("Service")) {
      const svcSlug = assign.get(svc.id);
      // (1) property Dependencies (Kind ipucu var, edge GEREKMEZ).
      for (const dep of propsOf<"Service">(svc).Dependencies ?? []) {
        if (dep.Kind === "Service" || dep.Kind === "Repository") continue;
        const node = this.resolveRef(dep.Kind, dep.Ref);
        if (node && INJECTABLE_INFRA_KINDS.has(node.kindOf())) note(node.id, svcSlug);
      }
      // (2) CALLS/CACHES_IN/REQUESTS edge hedefleri (Cache/ExternalService).
      for (const ek of INJECT_EDGE_KINDS) {
        for (const e of this.outEdges(svc.id, ek)) {
          const tgt = this.byId(e.targetNodeId);
          if (tgt && INJECTABLE_INFRA_KINDS.has(tgt.kindOf())) note(tgt.id, svcSlug);
        }
      }
    }

    // export logic (isCrossFeatureInjectTarget) bu haritayı okur -> property-dep
    //   ile enjekte eden feature'lar da sahibin export'unu tetikler.
    this._infraInjectorSlugs = injectorSlugsByProvider;

    const owners = new Map<string, string>();
    for (const [providerId, injectorSlugs] of injectorSlugsByProvider) {
      // Yalnız >=2 farklı feature enjekte ediyorsa tek-sahip kuralı gerekir.
      if (injectorSlugs.size < 2) continue;
      owners.set(providerId, this.pickInfraOwner(injectorSlugs, assign));
    }
    return owners;
  }

  /** Bir provider'ı enjekte eden feature slug kümesinden DETERMİNİSTİK + döngüsüz
   *  sahip seçer: aday başına "diğer adayların bu adaya feature-bağımlılık (herhangi
   *  bir cross-feature edge ile) sayısı" (in-degree) hesaplanır; en yüksek in-degree
   *  sahip olur (diğerleri ona zaten bağımlı -> yeni import döngü yaratmaz). Eşitlik
   *  isimce ilk slug ile kırılır. */
  private pickInfraOwner(injectorSlugs: Set<string>, assign: Map<string, string>): string {
    const candidates = [...injectorSlugs].sort(); // determinizm tabanı
    // featureDependsOn(a, b): a feature'ı b feature'ına herhangi bir cross-feature
    //   edge ile bağlı mı? (a'nın node'larından b'nin node'una giden bir edge var mı)
    const inDegree = new Map<string, number>();
    for (const c of candidates) inDegree.set(c, 0);
    for (const from of candidates) {
      for (const to of candidates) {
        if (from === to) continue;
        if (this.featureDependsOn(from, to, assign)) {
          inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
        }
      }
    }
    let best = candidates[0];
    let bestDeg = inDegree.get(best) ?? 0;
    for (const c of candidates) {
      const deg = inDegree.get(c) ?? 0;
      if (deg > bestDeg) {
        best = c;
        bestDeg = deg;
      }
    }
    return best;
  }

  /** `from` feature'ı `to` feature'ına HERHANGİ bir cross-feature edge ile bağlı mı?
   *  (from'a atanmış bir node'dan to'ya atanmış bir node'a giden bir edge varsa.) */
  private featureDependsOn(from: string, to: string, assign: Map<string, string>): boolean {
    for (const e of this.edges) {
      if (assign.get(e.sourceNodeId) === from && assign.get(e.targetNodeId) === to) return true;
    }
    return false;
  }

  /** Bir APIGateway'in YÖNLENDİRDİĞİ ilk hedefin (Service/Controller) feature'ı.
   *  Hedefler: Routes[].TargetRef ∪ ROUTES_TO ∪ CALLS edge'leri. Gateway, bir
   *  Service'i (anti-pattern'i kırmak için Controller DEĞİL) enjekte eden bir
   *  @Controller olarak emit edileceğinden, o servisle AYNI feature'a düşmek
   *  modülasyonu temiz tutar (cross-feature import azalır). Çözülemezse null. */
  private firstGatewayTargetFeature(gateway: CodeNode, assign: Map<string, string>): string | null {
    const targets: CodeNode[] = [];
    // (1) Routes[].TargetRef -> Service|Controller.
    const routes = (gateway.properties as Record<string, unknown>).Routes;
    if (Array.isArray(routes)) {
      for (const r of routes) {
        const ref = r && typeof r === "object" ? (r as Record<string, unknown>).TargetRef : undefined;
        if (typeof ref === "string" && ref.length > 0) {
          const node = this.resolveRef(["Service", "Controller"], ref);
          if (node) targets.push(node);
        }
      }
    }
    // (2) ROUTES_TO / CALLS edge hedefleri.
    for (const ek of ["ROUTES_TO", "CALLS"] as EdgeKind[]) {
      for (const e of this.outEdges(gateway.id, ek)) {
        const tgt = this.byId(e.targetNodeId);
        if (tgt && (tgt.kindOf() === "Service" || tgt.kindOf() === "Controller")) targets.push(tgt);
      }
    }
    targets.sort(byNameThenId);
    for (const t of targets) {
      const f = assign.get(t.id) ?? featureSlug(t);
      if (f) return f;
    }
    return null;
  }

  /** Bir node'a `sourceKind`'li `edgeKind` edge'i ile GELEN kaynakların İLKİNİN
   *  (kaynak adına göre; edge'ler kind,source.name,target.name,id'ye sıralı)
   *  feature'ı. Çoklu kaynak -> isimce ilk (Service/Repository sahipliği). */
  private firstSourceFeature(
    targetId: string,
    edgeKind: EdgeKind,
    sourceKind: NodeKind,
    assign: Map<string, string>,
  ): string | null {
    for (const e of this.inEdges(targetId, edgeKind)) {
      const src = this.byId(e.sourceNodeId);
      if (!src || src.kindOf() !== sourceKind) continue;
      return assign.get(src.id) ?? featureSlug(src);
    }
    return null;
  }

  /** Bir node'a `kind`'li `edgeKind` edge'i ile GELEN kaynakların atanmış
   *  feature'larını toplar (kaynak henüz atanmamışsa o kaynağın seed feature'ını
   *  kullanır). Set döner; pickFeature ile çoklu-farklı kararı verilir. */
  private featuresOfSources(
    targetId: string,
    edgeKind: EdgeKind,
    sourceKind: NodeKind,
    assign: Map<string, string>,
  ): Set<string> {
    const out = new Set<string>();
    for (const e of this.inEdges(targetId, edgeKind)) {
      const src = this.byId(e.sourceNodeId);
      if (!src || src.kindOf() !== sourceKind) continue;
      out.add(assign.get(src.id) ?? featureSlug(src));
    }
    return out;
  }

  /** Bir node'tan `kinds`'li `edgeKinds` edge'i ile GİDEN hedeflerin atanmış
   *  feature'larını toplar. */
  private featuresOfTargets(
    sourceId: string,
    edgeKinds: EdgeKind[],
    targetKinds: NodeKind[],
    assign: Map<string, string>,
  ): Set<string> {
    const out = new Set<string>();
    for (const ek of edgeKinds) {
      for (const e of this.outEdges(sourceId, ek)) {
        const tgt = this.byId(e.targetNodeId);
        if (!tgt || !targetKinds.includes(tgt.kindOf())) continue;
        const f = assign.get(tgt.id);
        if (f) out.add(f);
      }
    }
    return out;
  }

  /** Bir node'a herhangi bir edge ile bağlı (gelen; opsiyonel giden) komşuların
   *  atanmış feature'larını toplar (Enum/stub sahipliği için). */
  private referrerFeatures(
    nodeId: string,
    assign: Map<string, string>,
    includeOutgoing = false,
  ): Set<string> {
    const out = new Set<string>();
    for (const e of this.inEdges(nodeId)) {
      const f = assign.get(e.sourceNodeId);
      if (f) out.add(f);
    }
    if (includeOutgoing) {
      for (const e of this.outEdges(nodeId)) {
        const f = assign.get(e.targetNodeId);
        if (f) out.add(f);
      }
    }
    return out;
  }

  /** Bir Table/Model entity'sinin SAHİP feature'larını toplar:
   *   - WRITES (yoksa QUERIES) eden Repository'nin feature'ı (edge).
   *   - EntityReference property ref'i bu entity'yi gösteren Repository'nin
   *     feature'ı (DI co-location: entity, kendisini yöneten repo ile aynı feature).
   *   - Model ise: TableRef ile bağlı Table'ın feature'ı (ve tersi) — co-location.
   *  Çoklu FARKLI -> pickFeature "common" verir. */
  private entityOwnerFeatures(ent: CodeNode, assign: Map<string, string>): Set<string> {
    let owners = this.featuresOfSources(ent.id, "WRITES", "Repository", assign);
    if (owners.size === 0) {
      owners = this.featuresOfSources(ent.id, "QUERIES", "Repository", assign);
    }
    // Repository.EntityReference property ref'i.
    for (const repo of this.allOf("Repository")) {
      const ref = (repo.properties as Record<string, unknown>).EntityReference;
      if (typeof ref !== "string" || ref.length === 0) continue;
      const target = this.resolveRef(["Model", "Table"], ref);
      if (target && target.id === ent.id) {
        const f = assign.get(repo.id);
        if (f) owners.add(f);
      }
    }
    // Model<->Table TableRef co-location.
    if (ent.kindOf() === "Model") {
      const tableRef = (ent.properties as Record<string, unknown>).TableRef;
      if (typeof tableRef === "string" && tableRef.length > 0) {
        const table = this.resolveRef("Table", tableRef);
        const f = table ? assign.get(table.id) : undefined;
        if (f) owners.add(f);
      }
    } else if (ent.kindOf() === "Table") {
      for (const m of this.allOf("Model")) {
        const tableRef = (m.properties as Record<string, unknown>).TableRef;
        if (typeof tableRef === "string" && this.resolveRef("Table", tableRef)?.id === ent.id) {
          const f = assign.get(m.id);
          if (f) owners.add(f);
        }
      }
      // FK CO-LOCATION (orphan join tablosu): repo'su/Model'i OLMAYAN bir Table
      //   (ör. order_items) hiçbir feature'a düşmez -> kendi slug'ına atanır ama o
      //   slug için module SENTEZLENMEZ (gerçek provider yok) -> entity HİÇBİR
      //   forFeature'a girmez -> TypeORM bootta "Entity metadata for X#y not found".
      //   Çözüm: bir feature'a bağlı (assigned) bir Table'a FK veren bu join
      //   tablosunu, O hedef tablonun feature'ına co-locate et (FK hedeflerinin
      //   feature'ları isme göre deterministik; o feature module zaten var ->
      //   forFeature'a ek entity olarak girer). Yalnız owner BULUNAMADIYSA devreye
      //   girer (gerçek sahipliği bozmaz).
      if (owners.size === 0) {
        const fks = propsOf<"Table">(ent).ForeignKeys ?? [];
        for (const fk of fks) {
          const target = this.allOf("Table").find((t) => t.name === fk.ReferencesTable);
          const f = target ? assign.get(target.id) : undefined;
          if (f) owners.add(f);
        }
      }
    }
    return owners;
  }

  /** Bir DTO'yu kullanan Controller/Service feature'larını toplar (USES edge'i +
   *  Controller Endpoints Request/ResponseDTORef + Service Method DtoRef'leri). */
  private dtoConsumerFeatures(dto: CodeNode, assign: Map<string, string>): Set<string> {
    const out = new Set<string>();
    // USES edge'i.
    for (const e of this.inEdges(dto.id, "USES")) {
      const src = this.byId(e.sourceNodeId);
      if (src && (src.kindOf() === "Controller" || src.kindOf() === "Service")) {
        const f = assign.get(src.id);
        if (f) out.add(f);
      }
    }
    // Controller Endpoints ref'leri.
    for (const c of this.allOf("Controller")) {
      const f = assign.get(c.id);
      if (!f) continue;
      for (const ep of propsOf<"Controller">(c).Endpoints ?? []) {
        if (ep.RequestDTORef === dto.name || ep.ResponseDTORef === dto.name) out.add(f);
      }
    }
    // Service Method DtoRef'leri.
    for (const s of this.allOf("Service")) {
      const f = assign.get(s.id);
      if (!f) continue;
      for (const m of propsOf<"Service">(s).Methods ?? []) {
        if (m.ReturnDtoRef === dto.name) out.add(f);
        for (const p of m.Parameters ?? []) if (p.DtoRef === dto.name) out.add(f);
      }
    }
    return out;
  }

  /** assign map'inden Feature[] tanımlarını kurar. SLUG KÜMESİ atamalardan
   *  türetilir: en az bir backend dosyası üretecek (Controller/Service/Repository/
   *  Model) node'un atandığı her "common"-olmayan slug bir feature olur. Böylece
   *  controller'sız bir Service de kendi feature'ında bir module alır (app.module
   *  onu import eder -> sahipsiz/loose provider kalmaz). "common" feature DEĞİLDİR. */
  private buildFeatureDefs(
    assign: Map<string, string>,
    modules: CodeNode[],
  ): Feature[] {
    const slugSet = new Set<string>();
    for (const kind of ["Controller", "APIGateway", "Service", "Repository", "Model"] as NodeKind[]) {
      for (const n of this.allOf(kind)) {
        const s = assign.get(n.id);
        if (s && s !== "common") slugSet.add(s);
      }
    }
    const slugs = [...slugSet].sort();
    const moduleBySlug = new Map<string, CodeNode>();
    for (const m of modules) moduleBySlug.set(featureSlug(m), m);

    const features: Feature[] = [];
    for (const slug of slugs) {
      features.push(this.buildFeatureDef(slug, assign, slugs, moduleBySlug.get(slug) ?? null));
    }
    this.breakCircularImports(features);
    return features;
  }

  /** Feature module import DÖNGÜLERİNİ (N-cycle dahil) DETERMİNİSTİK kırar — kenarı
   *  SİLEREK değil, forwardRef ile işaretleyerek.
   *
   *  PROBLEM: cross-feature import'lar bir DÖNGÜ oluşturursa (A->B->A ikili VEYA
   *  A->B->C->A üçlü/N'li) NestJS boot'ta UndefinedModuleException ("circular
   *  dependency") verir. Eski sürüm yalnız İKİLİ {A,B} çiftlerini tarıyordu →
   *  üçlü+ döngüler kaçıyordu; ayrıca geri-kenarı dependsOn'dan SİLİYORDU → emit
   *  edilen module GERÇEK bir provider import'unu kaybediyordu (latent DI bug).
   *
   *  ÇÖZÜM (yapıyı düzelt, kenarı koru): eager-import grafiğinde (forwardRef OLMAYAN
   *  dependsOn kenarları) Tarjan ile SCC bul; her güçlü-bağlı bileşen (boyut >= 2)
   *  bir döngü içerir. Bileşen içinde DETERMİNİSTİK bir geri-kenar seç ve onu
   *  forwardRef'e çevir (lazy yap), grafiği yeniden hesapla; DAG kalınca dur. Kenar
   *  dependsOn'da KALIR → provider import'u kaybolmaz; yalnız `forwardRef(() => X)`
   *  ile emit edilir → NestJS döngüyü boot'ta çözer.
   *
   *  GERİ-KENAR KURALI (validator ile TEK KAYNAK): bileşendeki eager kenarlar
   *  arasından (target, source) ikilisi LEKSİKOGRAFİK EN KÜÇÜK olan seçilir —
   *  DFS sırasından bağımsız, sabit, denetlenebilir.
   *
   *  NOT: "common"a doğru bağımlılık yoktur → common döngüye giremez; yalnız
   *  feature<->feature kenarları taranır. */
  private breakCircularImports(features: Feature[]): void {
    const bySlug = new Map<string, Feature>();
    for (const f of features) bySlug.set(f.slug, f);
    // forwardRef'e çevrilmiş kenarlar: slug -> {lazy yapılmış dependsOn slug'ları}.
    //   Bu kenarlar eager-grafikte SCC dışı sayılır (boot'ta lazy).
    const fref = new Map<string, Set<string>>();
    for (const f of features) fref.set(f.slug, new Set<string>());

    const broken: string[] = []; // "from->to" (uyarı için)
    // Fixpoint: eager-kenar grafiğinde SCC>=2 kaldıkça deterministik bir geri-kenarı
    //   forwardRef'e çevir, yeniden hesapla. Her tur en az bir kenar lazy olur →
    //   sonlu (kenar sayısı üst sınır); DAG kalınca durur.
    for (;;) {
      const cyclic = this.tarjanSCC(features, fref).filter((c) => c.size >= 2);
      if (cyclic.length === 0) break;
      let changedAny = false;
      for (const scc of cyclic) {
        // SCC içi eager kenarlar (source->target; ikisi de SCC'de; forwardRef değil).
        const edges: Array<{ from: string; to: string }> = [];
        for (const from of scc) {
          const lazy = fref.get(from)!;
          for (const to of bySlug.get(from)!.dependsOn) {
            if (scc.has(to) && !lazy.has(to)) edges.push({ from, to });
          }
        }
        if (edges.length === 0) continue;
        // (to, from) leksikografik EN KÜÇÜK geri-kenarı seç (deterministik).
        edges.sort((x, y) => (x.to !== y.to ? (x.to < y.to ? -1 : 1) : x.from < y.from ? -1 : 1));
        const pick = edges[0];
        fref.get(pick.from)!.add(pick.to);
        broken.push(`${pick.from}->${pick.to}`);
        changedAny = true;
      }
      if (!changedAny) break; // güvenlik valfi (teoride erişilmez)
    }

    if (broken.length === 0) return;
    for (const f of features) f.forwardRefDeps = [...fref.get(f.slug)!].sort();
    for (const edge of [...broken].sort()) {
      const [from, to] = edge.split("->");
      this._warnings.push(
        `Circular module import broken with forwardRef: ${pascalForWarn(from)}Module imports ${pascalForWarn(to)}Module via forwardRef(() => ${pascalForWarn(to)}Module). The cross-feature dependency is preserved; NestJS resolves the cycle lazily at boot.`,
      );
    }
    this._warnings.sort();
  }

  /** Tarjan güçlü-bağlı-bileşen (SCC) algoritması — eager module-import grafiği
   *  üzerinde (dependsOn EKSİ forwardRef kenarları, yalnız bilinen feature slug'ları).
   *  DFS sırası slug-sıralı → SCC sonuçları DETERMİNİSTİK. Boyut>=2 bileşenler döngü
   *  içerir. (Tek-düğüm self-loop feature'larda olmaz; göz ardı edilir.) */
  private tarjanSCC(features: Feature[], fref: Map<string, Set<string>>): Set<string>[] {
    const bySlug = new Map<string, Feature>();
    for (const f of features) bySlug.set(f.slug, f);
    const order = features.map((f) => f.slug).sort();
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: Set<string>[] = [];
    let idx = 0;

    const strongconnect = (v: string): void => {
      index.set(v, idx);
      low.set(v, idx);
      idx++;
      stack.push(v);
      onStack.add(v);
      const lazy = fref.get(v) ?? new Set<string>();
      const deps = (bySlug.get(v)?.dependsOn ?? [])
        .filter((d) => bySlug.has(d) && !lazy.has(d))
        .sort();
      for (const w of deps) {
        if (!index.has(w)) {
          strongconnect(w);
          low.set(v, Math.min(low.get(v)!, low.get(w)!));
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, index.get(w)!));
        }
      }
      if (low.get(v) === index.get(v)) {
        const comp = new Set<string>();
        for (;;) {
          const w = stack.pop()!;
          onStack.delete(w);
          comp.add(w);
          if (w === v) break;
        }
        sccs.push(comp);
      }
    };

    for (const v of order) if (!index.has(v)) strongconnect(v);
    return sccs;
  }

  /** Tek bir feature slug için Feature tanımını kurar (buildFeatureDefs + common
   *  feature ortak yolu). `knownSlugs`: cross-feature dependsOn için geçerli
   *  feature slug'ları (common HARİÇ). `moduleSeed`: varsa SEED Module node. */
  private buildFeatureDef(
    slug: string,
    assign: Map<string, string>,
    knownSlugs: string[],
    moduleSeed: CodeNode | null,
  ): Feature {
    const synthTableIds = this.computeSyntheticEntityTableIds();
    const inFeature = (kind: NodeKind) =>
      this.allOf(kind).filter((n) => assign.get(n.id) === slug);

    const controllers = inFeature("Controller");
    // APIGateway'ler gerçek @Controller olarak emit edilir -> module
    //   controllers'ına Controller'larla birlikte girer (provider DEĞİL).
    const gateways = inFeature("APIGateway");
    const services = inFeature("Service");
    const repositories = inFeature("Repository");
    const entities = inFeature("Model");
    // Mimari altyapı provider'ları (tam @Injectable() emitter'lı): Cache,
    //   ExternalService, Worker, EventHandler, Orchestrator, MessageQueue.
    //   Bu feature'a ATANANLAR (inFeature) ∪ bu feature'ın service'lerine
    //   ENJEKTE EDİLEN Cache/ExternalService (kendi ataması "common"a düşse
    //   bile enjekte eden module'e girmeli -> boot DI). DEDUP + isme göre sıralı.
    const infraById = new Map<string, CodeNode>();
    for (const kind of INFRA_PROVIDER_KINDS) {
      for (const n of inFeature(kind)) infraById.set(n.id, n);
    }
    for (const n of this.collectInjectedInfraProviders(services, slug)) infraById.set(n.id, n);
    const infraProviders = [...infraById.values()].sort(byNameThenId);
    // Middleware'ler: @Injectable() + NestModule.configure() bağlaması için ayrı.
    const middlewares = inFeature("Middleware");
    // Bu feature'a atanmış, Model'siz + repository-referanslı Table'lar.
    const syntheticEntityTables = this.allOf("Table").filter(
      (t) => synthTableIds.has(t.id) && assign.get(t.id) === slug,
    );

    // dependsOn: bu feature'ın node'larının (controller/provider/altyapı)
    //   herhangi bir edge ile ulaştığı BAŞKA feature'lar (cross-feature module
    //   import). "common" hariç (common module ZATEN AppModule'de + her feature
    //   common'a doğrudan import ile bağlanmaz — common provider'ları gerekirse
    //   feature module'ünün kendi providers'ına enjekte-toplama ile girer).
    const dependsOn = new Set<string>();
    const localNodes = [
      ...controllers,
      ...gateways,
      ...services,
      ...repositories,
      ...infraProviders,
      ...middlewares,
    ];
    for (const n of localNodes) {
      for (const e of this.outEdges(n.id)) {
        const tgt = this.byId(e.targetNodeId);
        if (!tgt) continue;
        const tf = assign.get(tgt.id);
        if (tf && tf !== slug && tf !== "common" && knownSlugs.includes(tf)) dependsOn.add(tf);
      }
    }

    // #7: bu feature'ın service'leri, SAHİBİ BAŞKA bir feature olan bir infra
    //   provider enjekte ediyorsa (property-dep ile EDGE OLMADAN da olabilir),
    //   sahibin module'ünü import ETMELİ -> dependsOn[sahip]. Yoksa (sahip-dışı
    //   feature provider'ı kendi yazmaz + import da etmezse) bootta DI çözülemez.
    //   collectInjectedInfraProviders'taki enjeksiyon-toplama mantığının AYNISI,
    //   ama owner-filtresiz: enjekte edilen TÜM infra'ları gez, owner != slug ise ekle.
    for (const svc of services) {
      for (const dep of propsOf<"Service">(svc).Dependencies ?? []) {
        const node = this.resolveRef(dep.Kind, dep.Ref);
        if (!node) continue;
        if (dep.Kind === "Service" || dep.Kind === "Repository") {
          // Çapraz-feature Service/Repository enjeksiyonu PROPERTY ile (graf'ta EDGE
          //   YOK; ör. TokenService -> UserRepository). Tüketici, sahibin module'ünü
          //   import ETMELİ — yoksa bootta "Nest can't resolve UserRepository"
          //   (UnknownDependenciesException). Sahip = node'un atandığı feature.
          const owner = assign.get(node.id);
          if (owner && owner !== slug && owner !== "common" && knownSlugs.includes(owner)) {
            dependsOn.add(owner);
          }
          continue;
        }
        if (INJECTABLE_INFRA_KINDS.has(node.kindOf())) {
          const owner = this._infraOwner.get(node.id);
          if (owner && owner !== slug && owner !== "common" && knownSlugs.includes(owner)) {
            dependsOn.add(owner);
          }
        }
      }
      for (const ek of INJECT_EDGE_KINDS) {
        for (const e of this.outEdges(svc.id, ek)) {
          const tgt = this.byId(e.targetNodeId);
          if (tgt && INJECTABLE_INFRA_KINDS.has(tgt.kindOf())) {
            const owner = this._infraOwner.get(tgt.id);
            if (owner && owner !== slug && owner !== "common" && knownSlugs.includes(owner)) {
              dependsOn.add(owner);
            }
          }
        }
      }
    }

    // exports: bu feature'ın PROVIDER'larından (Service/Repository VE mimari
    //   altyapı provider'ları) BAŞKA bir feature'ın çağırdığı her biri. NestJS'te
    //   export edilmeyen provider modül-dışı görünmez -> cross-feature injection
    //   bootta DI hatası verir. Common feature için: BAŞKA feature'ın enjekte
    //   ettiği her common provider export edilmeli (CommonModule -> consumer).
    const exports = [...services, ...repositories, ...infraProviders].filter((p) =>
      this.isCrossFeatureInjectTarget(p.id, slug, assign),
    );

    // stubProviders: bu feature'ın service'lerine DI ile enjekte edilen, tam
    //   emitter'ı OLMAYAN node'lar. Cache/ExternalService artık tam emitter'lı
    //   (infraProviders) -> bu liste pratikte boş; mekanizma korunur.
    const stubProviders = this.collectFeatureStubProviders(services);

    return {
      slug,
      module: moduleSeed,
      controllers,
      gateways,
      services,
      repositories,
      entities,
      syntheticEntityTables,
      stubProviders,
      infraProviders,
      middlewares,
      exports,
      dependsOn: [...dependsOn].sort(),
      forwardRefDeps: [], // breakCircularImports döngü kenarlarını işaretler (regular features)
    };
  }

  /** "common"a düşen feature-BAĞSIZ altyapı için sentetik bir CommonModule
   *  Feature'ı (slug="common"). MessageQueue/EventHandler/Cache/ExternalService/
   *  Worker/Orchestrator/Middleware ve common @Controller/APIGateway'leri toplar.
   *  Bunlar bir feature'a bağlanamadığı için (paylaşımlı/cross-cutting) hiçbir
   *  feature module sentezlenmez -> BullModule.registerQueue HİÇ çağrılmaz, provider
   *  orphan kalırdı. CommonModule bunları toplar + wiring'ini yapar; AppModule
   *  import eder. Toplanacak hiçbir node yoksa null döner (gereksiz dosya üretme).
   *
   *  NOT: Service/Repository common'a düşmez (>=2 farklı feature paylaşımı ancak
   *  enjekte-toplama ile zaten consumer module'üne girer); common feature yalnız
   *  feature-BAĞSIZ altyapı + paylaşımlı HTTP giriş katmanı içindir. */
  commonFeature(): Feature | null {
    if (this._featureOf === null) this.computeFeatures();
    const assign = this._featureOf!;
    const knownSlugs = (this._features ?? []).map((f) => f.slug);
    const def = this.buildFeatureDef("common", assign, knownSlugs, null);
    // common feature yalnız altyapı + controller/gateway + (cross-feature) sentetik
    //   entity tablosu içeriyorsa anlamlı. syntheticEntityTables: birden çok feature'a
    //   FK veren orphan join tablosu (ör. order_items) "common"a düşer; CommonModule
    //   onu TypeOrmModule.forFeature'a kaydetmezse @OneToMany(() => OrderItem) bootta
    //   "Entity metadata not found" verir.
    const hasContent =
      def.controllers.length > 0 ||
      def.gateways.length > 0 ||
      def.infraProviders.length > 0 ||
      def.middlewares.length > 0 ||
      def.syntheticEntityTables.length > 0;
    return hasContent ? def : null;
  }

  /** Model'i OLMAYAN ama entity SENTEZLENECEK Table id'leri. entity-synthesis'in
   *  `tablesNeedingSyntheticEntity` kümesiyle BYTE-BYTE aynı olmalı: o emitter bu
   *  tablolar için @Entity dosyası + @OneToMany/@ManyToOne ilişkileri üretir; bu
   *  küme ise module.emitter'ın TypeOrmModule.forFeature kaydını belirler. İkisi
   *  AYRIŞIRSA (ör. join tablosu entity'si üretilir ama forFeature'a girmez)
   *  TypeORM bootta "Entity metadata for X#y was not found" fırlatır (autoLoadEntities
   *  yalnız forFeature'a giren entity'leri yükler). Bu yüzden AYNI iki adımı yürütür:
   *    1) ÇEKİRDEK: repo-referanslı (EntityReference) Model'siz Table'lar.
   *    2) FK KAPANIŞI: çekirdeğe FK veren VEYA çekirdekten FK alan her Model'siz
   *       Table (join/ara tablolar, ör. order_items) — transitif fixpoint. */
  private computeSyntheticEntityTableIds(): Set<string> {
    // Bir Table'ı TableRef ile temsil eden Model var mı? (varsa Model entity üretilir.)
    const backedTableIds = new Set<string>();
    for (const m of this.allOf("Model")) {
      const tableRef = (m.properties as Record<string, unknown>).TableRef;
      if (typeof tableRef === "string") {
        const t = this.resolveRef("Table", tableRef);
        if (t) backedTableIds.add(t.id);
      }
    }
    // Model'siz Table'lar aday; isme göre indeks (FK ReferencesTable çözümü için).
    const tables = this.allOf("Table").filter((t) => !backedTableIds.has(t.id));
    const byTableName = new Map<string, CodeNode>();
    for (const t of tables) byTableName.set(t.name, t);

    // ── 1) ÇEKİRDEK: repo-referanslı Model'siz Table'lar ──────────────────────
    const out = new Set<string>();
    for (const repo of this.allOf("Repository")) {
      const ref = (repo.properties as Record<string, unknown>).EntityReference;
      if (typeof ref !== "string" || ref.length === 0) continue;
      const node = this.resolveRef(["Model", "Table"], ref);
      if (node && node.kindOf() === "Table" && !backedTableIds.has(node.id)) {
        out.add(node.id);
      }
    }

    // ── 2) FK KAPANIŞI (transitif, çift-yönlü; Model'siz aday'lar arasında) ────
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of tables) {
        const fks = propsOf<"Table">(t).ForeignKeys ?? [];
        for (const fk of fks) {
          const target = byTableName.get(fk.ReferencesTable);
          if (!target) continue;
          const tIn = out.has(t.id);
          const targetIn = out.has(target.id);
          if (tIn && !targetIn) {
            out.add(target.id);
            changed = true;
          } else if (targetIn && !tIn) {
            out.add(t.id);
            changed = true;
          }
        }
      }
    }
    return out;
  }

  /** Bir provider (Service/Repository/Cache/ExternalService/...) BAŞKA bir feature
   *  tarafından enjekte ediliyor mu? Enjeksiyon CALLS (Service/Repository),
   *  CACHES_IN (Cache) veya REQUESTS (ExternalService) edge'lerinden gelir;
   *  hepsinde GELEN kaynak başka bir feature ise export ZORUNLU ("common" sayılmaz).
   *  AYRICA (#7): infra provider'lar Service.Dependencies property'si ile EDGE
   *  OLMADAN da enjekte edilebilir (_infraInjectorSlugs). Sahip-dışı bir feature
   *  property-dep ile enjekte ediyorsa export yine ZORUNLU — yoksa o feature sahibin
   *  module'ünü import etse de PaymentGateway export edilmediği için bootta DI
   *  çözemez ("Nest can't resolve"). NestJS'te export edilmeyen provider modül-dışı
   *  görünmez. */
  private isCrossFeatureInjectTarget(
    providerId: string,
    ownSlug: string,
    assign: Map<string, string>,
  ): boolean {
    for (const ek of INJECT_EDGE_KINDS) {
      for (const e of this.inEdges(providerId, ek)) {
        const src = this.byId(e.sourceNodeId);
        if (!src) continue;
        const sf = assign.get(src.id);
        if (sf && sf !== ownSlug && sf !== "common") return true;
      }
    }
    // #7: property-Dependency (edge'siz) ile enjekte eden başka bir feature var mı?
    for (const sf of this._infraInjectorSlugs.get(providerId) ?? []) {
      if (sf !== ownSlug && sf !== "common") return true;
    }
    // Çapraz-feature Service/Repository enjeksiyonu PROPERTY ile (edge YOK): başka
    //   bir feature'ın service'i bu provider'ı Dependencies'inde Kind=Service/Repository
    //   olarak listeliyorsa, sahip module onu EXPORT etmeli — yoksa tüketici sahibin
    //   module'ünü import etse bile provider modül-dışı görünmez (boot DI hatası).
    const prov = this.byId(providerId);
    if (prov && (prov.kindOf() === "Service" || prov.kindOf() === "Repository")) {
      for (const svc of this.allOf("Service")) {
        const sf = assign.get(svc.id);
        if (!sf || sf === ownSlug || sf === "common") continue;
        for (const dep of propsOf<"Service">(svc).Dependencies ?? []) {
          if (dep.Kind !== "Service" && dep.Kind !== "Repository") continue;
          const node = this.resolveRef(dep.Kind, dep.Ref);
          if (node && node.id === providerId) return true;
        }
      }
    }
    return false;
  }

  /** Verilen service'lere DI ile enjekte edilen, TAM emitter'lı mimari altyapı
   *  provider'ları (Cache/ExternalService). Service.Dependencies ∪
   *  Service-[CALLS/CACHES_IN/REQUESTS]->target kenarlarından toplanır.
   *
   *  #7 TEK-SAHİP KURALI: bir provider BİRDEN ÇOK feature'ca enjekte ediliyorsa
   *  (_infraOwner'da kayıtlı), YALNIZ SAHİP feature (ownSlug === owner) onu provider
   *  olarak yazar; diğer enjekte eden feature'lar provider'ı TEKRAR YAZMAZ (sahibin
   *  module'ünü import eder -> singleton korunur). Tek feature enjekte ediyorsa
   *  (_infraOwner'da yok) eskisi gibi o feature'a girer. ownSlug verilmezse (ör.
   *  geriye-dönük çağrı) eleme yapılmaz. İsme göre sıralı + DEDUP. */
  private collectInjectedInfraProviders(services: CodeNode[], ownSlug?: string): CodeNode[] {
    const byId = new Map<string, CodeNode>();
    const keepProvider = (node: CodeNode): boolean => {
      const owner = this._infraOwner.get(node.id);
      // Çoklu-enjekte (owner kayıtlı) ise YALNIZ sahip feature tutar; aksi halde tut.
      return owner === undefined || ownSlug === undefined || owner === ownSlug;
    };
    for (const svc of services) {
      // (1) property Dependencies (Kind ipucu var).
      for (const dep of propsOf<"Service">(svc).Dependencies ?? []) {
        if (dep.Kind === "Service" || dep.Kind === "Repository") continue;
        const node = this.resolveRef(dep.Kind, dep.Ref);
        if (node && INJECTABLE_INFRA_KINDS.has(node.kindOf()) && keepProvider(node)) byId.set(node.id, node);
      }
      // (2) CALLS/CACHES_IN/REQUESTS edge hedefleri (Cache/ExternalService).
      for (const ek of INJECT_EDGE_KINDS) {
        for (const e of this.outEdges(svc.id, ek)) {
          const tgt = this.byId(e.targetNodeId);
          if (tgt && INJECTABLE_INFRA_KINDS.has(tgt.kindOf()) && keepProvider(tgt)) byId.set(tgt.id, tgt);
        }
      }
    }
    return [...byId.values()].sort(byNameThenId);
  }

  /** Verilen service'lere DI ile enjekte edilen, tam emitter'ı OLMAYAN node'lar
   *  (Cache/ExternalService/...). Service.Dependencies ∪ Service-[CALLS]->target
   *  kenarlarından; FULL_PROVIDER_KINDS (Service/Repository) HARİÇ. Bunlar stub
   *  olarak üretilir ve module providers'ına eklenmek zorunda (boot DI). İsme
   *  göre sıralı + DEDUP. */
  private collectFeatureStubProviders(services: CodeNode[]): CodeNode[] {
    const byId = new Map<string, CodeNode>();
    for (const svc of services) {
      // (1) property Dependencies.
      for (const dep of propsOf<"Service">(svc).Dependencies ?? []) {
        if (dep.Kind === "Service" || dep.Kind === "Repository") continue;
        const node = this.resolveRef(dep.Kind, dep.Ref);
        if (node && !FULL_PROVIDER_KINDS.has(node.kindOf())) byId.set(node.id, node);
      }
      // (2) CALLS edge hedefleri (Cache/ExternalService stub'ları).
      for (const e of this.outEdges(svc.id, "CALLS")) {
        const tgt = this.byId(e.targetNodeId);
        if (!tgt) continue;
        if (FULL_PROVIDER_KINDS.has(tgt.kindOf())) continue;
        if (STUB_INJECTABLE_KINDS.has(tgt.kindOf())) byId.set(tgt.id, tgt);
      }
    }
    return [...byId.values()].sort(byNameThenId);
  }
}

/** Tam (gerçek) provider emitter'ı OLAN kind'lar — bunlar stubProvider DEĞİL.
 *  Cache + ExternalService artık tam emitter'a sahip (cache.emitter /
 *  external-service.emitter) -> stub değil, gerçek @Injectable() sınıf üretirler;
 *  DI tipi pascalCase(name) (Stub eki YOK). service.emitter FULL_EMITTER_KINDS
 *  ile birebir tutulmalıdır. */
const FULL_PROVIDER_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  "Service",
  "Repository",
  "Cache",
  "ExternalService",
]);

/** Service'e DI ile enjekte edilebilen, stub olarak üretilen kind'lar. Cache +
 *  ExternalService artık tam emitter'lı (FULL_PROVIDER_KINDS) -> bu küme şu an
 *  BOŞ. Mekanizma ileride tam emitter'ı OLMAYAN yeni enjekte edilebilir kind'lar
 *  için korunur (stub.emitter INJECTABLE_STUB_KINDS ile tutarlı). */
const STUB_INJECTABLE_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([]);

/** Service/Repository OLMAYAN ama TAM @Injectable() emitter'a sahip mimari altyapı
 *  provider kind'ları. Bunlar feature module providers'ına eklenir (sınıf adı
 *  pascalCase(name)). MessageQueue producer da bir @Injectable() provider'dır.
 *  Middleware AYRI ele alınır (configure() bağlaması + providers). */
const INFRA_PROVIDER_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  "Cache",
  "ExternalService",
  "Worker",
  "EventHandler",
  "Orchestrator",
  "MessageQueue",
]);

/** Service'e DI ile enjekte EDİLEBİLEN mimari altyapı kind'ları (Cache/
 *  ExternalService). Enjekte eden service'in module'üne provider olarak eklenmek
 *  zorundalar (kendi feature ataması farklı olsa bile). */
const INJECTABLE_INFRA_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  "Cache",
  "ExternalService",
]);

/** Bir provider'a DI enjeksiyonunu işaret eden edge kind'ları: Service->Repository/
 *  Service (CALLS), Service->Cache (CACHES_IN), Service->ExternalService (REQUESTS).
 *  Cross-feature export + injected-infra toplama bu kenarları tarar. */
const INJECT_EDGE_KINDS: readonly EdgeKind[] = ["CALLS", "CACHES_IN", "REQUESTS"];

/** Tek bir StoredNode'u, name + kindOf() eklenmiş CodeNode'a çevirir.
 *  FAULT-ISOLATION (M5): name TEK KAYNAĞI burası. Bozuk bir node'da name-property
 *  string OLMAYABİLİR (ör. 12345 / null / nesne); `readonly name: string`
 *  sözleşmesini KORUMAK için string'e zorlanır. Aksi halde feature-inference
 *  (kebabOf/featureSlug) string varsayar ve TÜM codegen'i düşürür — per-node
 *  try/catch bunu YAKALAMAZ (graph.features() node döngüsünün DIŞINDADIR). */
function toCodeNode(n: StoredNode): CodeNode {
  const raw = (n.properties as Record<string, unknown>)[NAME_KEY_BY_KIND[n.type]];
  const name = typeof raw === "string" ? raw : "";
  const node: CodeNode = {
    ...n,
    name,
    kindOf(): NodeKind {
      return n.type;
    },
  } as CodeNode;
  return node;
}

/** Ham StoredNode/StoredEdge'lerden çözümlenmiş CodeGraph kurar.
 *  - Bilinmeyen kind'lı node'lar TOLERE edilir (kindOf hâlâ çalışır, name="").
 *  - Self-loop / kopuk edge'ler korunur; emitter'lar resolveRef ile süzer. */
export function buildCodeGraph(nodes: StoredNode[], edges: StoredEdge[]): CodeGraph {
  return new CodeGraph(nodes.map(toCodeNode), edges);
}

/* ── iç yardımcılar ─────────────────────────────────────────────────────── */
function kindNameKey(kind: NodeKind, name: string): string {
  return `${kind} ${name}`;
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function byNameThenId(a: CodeNode, b: CodeNode): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Bir isimden kind suffix'ini (Service/Repository) ayıklar (büyük/küçük
 *  harf duyarsız). "UserRepository" -> "User", "UsersService" -> "Users". */
function stripKindSuffix(name: string, suffix: string): string {
  if (name.length > suffix.length && name.toLowerCase().endsWith(suffix.toLowerCase())) {
    return name.slice(0, name.length - suffix.length);
  }
  return name;
}

/** Çoğul/tekil + case farkını eleyen kaba domain kökü: lowercase + tek sondaki
 *  's' düşürülür. "user"/"users" -> "user"; "category"/"categories" değil ama
 *  yaygın "-s" çoğulları için yeterli (FK/feature co-location heuristiği). */
function domainStem(raw: string): string {
  const lc = raw.toLowerCase();
  return lc.endsWith("s") ? lc.slice(0, -1) : lc;
}

/* ── Feature slug yardımcıları (naming.ts ile aynı kebab/rol-stripping mantığı;
 *  burada inline tutulur çünkü naming.ts ir.ts'ye bağımlı — döngü olmasın). ── */

/** Bir kind için rol son-ekleri (feature slug türetirken atılır). naming.ts
 *  ROLE_SUFFIX_BY_KIND ile birebir tutarlı tutulmalıdır. */
const FEATURE_ROLE_SUFFIX: Partial<Record<NodeKind, string[]>> = {
  Controller: ["Controller"],
  APIGateway: ["APIGateway", "Gateway"],
  Service: ["Service"],
  Repository: ["Repository"],
  Module: ["Module"],
  Exception: ["Exception", "Error"],
  DTO: ["DTO", "Dto"],
};

/** Bir node'un feature slug'ı: rol son-eki atılmış adın kebab-case hali.
 *  "AuthController"->"auth", "ImageGenerationService"->"image-generation",
 *  "UserRepository"->"user". Boş ada düşmez (rol son-eki adın tamamıysa korunur). */
function featureSlug(node: CodeNode): string {
  let base = node.name;
  const suffixes = FEATURE_ROLE_SUFFIX[node.kindOf()] ?? [];
  for (const suf of suffixes) {
    if (base.length > suf.length && base.toLowerCase().endsWith(suf.toLowerCase())) {
      base = base.slice(0, base.length - suf.length);
      break;
    }
  }
  return kebabOf(base) || kebabOf(node.name) || "common";
}

/** Bir kebab-case feature slug'ından okunaklı PascalCase (yalnız uyarı metni için;
 *  naming.pascalCase'e bağlanmaz — ir.ts döngü-kaçınması). "user-profile" ->
 *  "UserProfile". */
function pascalForWarn(slug: string): string {
  return slug
    .split(/[\s\-_./]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/** Yerel kebab-case (naming.kebabCase ile aynı kelime bölme kuralları). */
function kebabOf(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s\-_./]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase())
    .join("-");
}

/** Bir feature-aday kümesinden deterministik seçim:
 *   - boş -> null (çağıran fallback'e düşer).
 *   - tek -> o.
 *   - >=2 FARKLI -> "common" (paylaşımlı node).
 *  Tek elemanlı set tek feature demektir; çoklu farklı paylaşımı işaret eder. */
function pickFeature(features: Set<string>): string | null {
  const distinct = [...features].filter((f) => f.length > 0);
  if (distinct.length === 0) return null;
  if (distinct.length === 1) return distinct[0];
  return "common";
}
