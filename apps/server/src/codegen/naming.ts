import type { NodeKind } from "../nodes/schemas";
import type { CodeNode, CodeGraph } from "./ir";
import type { ImportCollector } from "./imports";

/* ────────────────────────────────────────────────────────────────────────
 * naming.ts — DETERMINISTIC isim ve yol uretimi.
 *
 * Tum emitter'lar isim donusumu ve dosya yolu icin YALNIZ bu modulu kullanir
 * (hardcode case donusumu YASAK). Ayni node -> ayni isim -> ayni yol.
 * ──────────────────────────────────────────────────────────────────────── */

/** Bir tanimlayiciyi kelimelere boler: camelCase, PascalCase, snake_case,
 *  kebab-case, "bosluklu metin" — hepsini normalize eder. */
export function splitWords(input: string): string[] {
  return (
    input
      // camelCase / PascalCase siniri: "userId" -> "user Id"
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      // ardisik buyuk harf + sozcuk: "HTTPServer" -> "HTTP Server"
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      // ayraclar
      .split(/[\s\-_./]+/)
      .filter((w) => w.length > 0)
  );
}

const lower = (w: string) => w.toLowerCase();
const cap = (w: string) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase());

/** "user_profiles" / "UserProfile" -> "UserProfile". */
export function pascalCase(input: string): string {
  return splitWords(input).map(cap).join("");
}

/** "UserProfile" -> "userProfile". */
export function camelCase(input: string): string {
  const p = pascalCase(input);
  return p.length === 0 ? p : p[0].toLowerCase() + p.slice(1);
}

/** Bir property/field adini TS UYE TANIMLAYICISI olarak normalize eder (entity/model
 *  alani + iliski prop). Diyagram PascalCase yazsa da (Id, CustomerId, Title) idiomatik
 *  TS camelCase'e cevirir → Surgical AI grounding'i de bu yuzeyi okuyup uyumlu camelCase
 *  govde uretir. DB kolon ADI NOT — o ham `.Name`'den snakeCase ile ayri turetilir
 *  (SnakeNamingStrategy member adini ayni snake_case'e indirir, drift olmaz). */
export const tsPropName = camelCase;

/** "UserProfile" -> "user-profile". */
export function kebabCase(input: string): string {
  return splitWords(input).map(lower).join("-");
}

/** "UserProfile" -> "user_profile". */
export function snakeCase(input: string): string {
  return splitWords(input).map(lower).join("_");
}

/* ── Fiziksel tablo adi — TEK SOURCE ───────────────────────────────────────
 * Bir Table node'unun TableName'i (ve TableRef ile ona baglanan Model'in
 * @Entity adi) DAIMA bu fonksiyondan gelir; boylece migration'daki
 * `CREATE TABLE` ile entity'nin `@Entity(...)` adi ASLA ayrismaz.
 *
 * KARAR: TableName author'in sectigi LITERAL fiziksel tablo adidir — tekrar
 * cogullanmaz (yalniz snake_case'lenir). "users" -> "users", "User" -> "user",
 * "OrderItem" -> "order_item". (Acik ad yoksa class adindan turetmek icin ayrica
 * pluralizeSnake kullanilir — bkz. model.emitter resolveTableName.) */
export function tableSqlName(rawTableName: string): string {
  return snakeCase(rawTableName);
}

/* ── Cok basit, deterministik Ingilizce cogullama ──────────────────────────
 * Kapsam: yaygin kurallar. AI/sozluk NONE — codegen deterministik kalsin.
 * "category" -> "categories", "box" -> "boxes", "user" -> "users".
 * YALNIZ acik TableName'i WITHOUT bir tabloyu class adindan turetmek icin
 * kullanilir (Model.TableRef yoksa). Acik TableName'e ASLA uygulanmaz. */
export function pluralizeSnake(input: string): string {
  const base = snakeCase(input);
  if (base.length === 0) return base;
  const lastSeg = base.split("_").pop() as string;
  const prefix = base.slice(0, base.length - lastSeg.length);
  return prefix + pluralizeWord(lastSeg);
}

function pluralizeWord(w: string): string {
  if (w.length === 0) return w;
  const endsWith = (s: string) => w.endsWith(s);
  // -y -> -ies (unsuzden sonra)
  if (endsWith("y") && w.length > 1 && !"aeiou".includes(w[w.length - 2])) {
    return w.slice(0, -1) + "ies";
  }
  // -s, -ss, -sh, -ch, -x, -z -> -es
  if (endsWith("s") || endsWith("sh") || endsWith("ch") || endsWith("x") || endsWith("z")) {
    return w + "es";
  }
  return w + "s";
}

/* ── Sema tip stringi -> TypeScript skaler tipi ────────────────────────────
 * Semadaki serbest tip string'leri (Param/QueryParam.Type, Model.Property.Type,
 * DTO.Field.DataType) yaygin es anlamlilari TS tiplerine normalize eder. Bilinmeyen
 * tip OLDUGU GIBI doner (ozel sinif/DTO adi gecisi icin). Uc emitter da (controller/
 * model/dto) ayni eslemeyi paylassin diye buradadir — aksi halde controller
 * `id: uuid` gibi GECERSIZ TS uretirdi (uuid bir TS tipi degil). */
export function scalarTsType(raw: string): string {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "":
      return "string";
    case "string":
    case "text":
    case "varchar":
    case "char":
    case "bpchar":
    case "citext":
    case "guid":
    case "uuid":
    case "enum":
      // Generic SQL ENUM given as a free-form type string (no EnumRef, no enum node to
      // resolve) → string. EnumRef-backed columns resolve to the real generated enum type
      // via a separate path (sql-type-map.columnTsType); here an unresolvable generic
      // "ENUM" must not emit invalid TS (a bare `ENUM`) → string. (Consistent with
      // sql-type-map.ts sqlScalarTsType("ENUM") === "string".)
      return "string";
    case "int":
    case "integer":
    case "bigint":
    case "smallint":
    case "tinyint":
    case "long":
    case "number":
    case "float":
    case "double":
    case "real":
    case "decimal":
    case "numeric":
      return "number";
    case "bool":
    case "boolean":
      return "boolean";
    case "date":
    case "datetime":
    case "timestamp":
    case "timestamptz":
    case "time":
      return "Date";
    // JSON/JSONB: serbest tip string'i olarak verilen JSON -> Record<string, unknown>
    //   (sql-type-map ile tutarli; bare `JSON` GECERSIZ TS uretmesin).
    case "json":
    case "jsonb":
      return "Record<string, unknown>";
    // Parametresiz koleksiyon-ism'i (DataType="Array"/"List", eleman tipi yok) → bare
    // `Array` GECERSIZ TS (TS2314: tip argumani ister). Guvenli degradasyon: `unknown`
    // (IsCollection ekiyle `unknown[]`). Parametreli `List<X>`/`X[]` resolveTypeRef yolunda.
    case "array":
    case "list":
      return "unknown";
    default:
      return raw;
  }
}

/* ── Serbest tip stringi -> GECERLI TS tipi (scalar + ref cozumu + import) ──
 * Repository CustomQuery ve Service metot param/return tipleri semada SERBEST
 * string'tir (or. "User", "UUID", "User[]", "Promise<User>"). Ham birakilirsa
 * "User"/"UUID" gibi tanimsiz semboller `nest build`'i TS2304 ile kirar.
 *
 * resolveTypeRef tek bir tip token'ini:
 *   1) scalarTsType ile normalize eder (uuid->string, int->number, date->Date...),
 *   2) skaler degilse Model/DTO/Enum node'u olarak cozmeye calisir -> cozulurse
 *      sinif adini import eder (fromFile'a goreli) ve dondurur,
 *   3) hicbiri degilse token'i OLDUGU GIBI birakir (serbest tip; derlemeyi
 *      kirabilir ama bu zaten kullanicinin verdigi tiptir — controller.emitter
 *      ile ayni tolerans).
 *
 * Kompozit tipleri (Array<X>, X[], Promise<X>, X | null, X | undefined) parcalar:
 * sarmalayiciyi korur, ICERDEKI tanimlayicilari tek tek cozer. Determinizm:
 * yalniz ham string uzerinde regex; node sirasi graph'tan gelir.
 * ──────────────────────────────────────────────────────────────────────── */
export function resolveTypeRef(
  rawType: string,
  graph: CodeGraph,
  fromFile: string,
  imports: ImportCollector,
): string {
  const raw = (rawType ?? "").trim();
  if (raw.length === 0) return "void";
  // LLM-yazimi koleksiyon-ism'i: `List<X>` (Java/Kotlin) gecerli TS degil →
  // TS-native `Array<X>` (sozcuk-sinirli, buyuk/kucuk harf duyarsiz; `UserList`
  // dokunulmaz). Asagidaki dongu `Array`'i zaten passthrough gecer, icteki X'i cozer.
  const t = raw.replace(/\bList\s*</gi, "Array<");
  // Her tanimlayici parcasini coz; tanimlayici-olmayan kisimlari (<>[]|, bosluk)
  // oldugu gibi koru. Bu, Promise<User>, User[], User | null gibi tipleri kapsar.
  return t.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (token) => resolveTypeToken(token, graph, fromFile, imports));
}

/** Bilinen tip-anahtar kelimeleri (cozulmez; oldugu gibi gecer). */
const TS_TYPE_KEYWORDS = new Set([
  "Promise", "Array", "Record", "Map", "Set", "Partial", "Readonly", "Pick", "Omit",
  "string", "number", "boolean", "Date", "void", "any", "unknown", "null", "undefined",
  "object", "never", "bigint", "symbol", "true", "false",
]);

function resolveTypeToken(
  token: string,
  graph: CodeGraph,
  fromFile: string,
  imports: ImportCollector,
): string {
  if (TS_TYPE_KEYWORDS.has(token)) return token;
  // Skaler es anlamli mi? (uuid/int/date ...) -> TS skaleri.
  const scalar = scalarTsType(token);
  if (scalar !== token) return scalar;
  // Skaler degil -> bir Model/DTO/Enum node'u olabilir; coz + import et.
  const node = graph.resolveRef(["Model", "DTO", "Enum"], token);
  if (node) {
    const cls = pascalCase(node.name);
    const path = importPathOf(relativeImportPath(fromFile, filePathFor(node, graph)));
    // Enum tip-pozisyonunda gorunse de govdede DEGER olarak kullanilir (Status.SUBMITTED,
    // Object.values(Enum)) → VALUE import. `import type` olsa TS1361 verir. Model/DTO tip-only kalir.
    if (node.kindOf() === "Enum") imports.add(cls, path);
    else imports.addType(cls, path);
    return cls;
  }
  // Bir DB View mi? (repository View dondurur). View migration + TS @ViewEntity uretir;
  // tip olarak @ViewEntity sinifini import et (filePathFor(View) migration'dir → viewEntityFilePath).
  const view = graph.resolveRef("View", token);
  if (view) {
    const cls = pascalCase(view.name);
    // @ViewEntity bir SINIF — govdede deger olarak da kullanilabilir (repository token,
    // new) → VALUE import (Enum ile ayni; `import type` TS1361 verir).
    imports.add(cls, importPathOf(relativeImportPath(fromFile, viewEntityFilePath(view, graph))));
    return cls;
  }
  // Bir Table'dan SENTEZLENEN entity adi mi? (Model yokken servis/repo "User"
  //   dondurur; sentetik entity sinif adi entityClassNameForTable ile eslesir.)
  //   Hem ham tablo adi ("Users") hem sentetik sinif adi ("User") eslenir.
  const synthTable = resolveSyntheticEntityType(token, graph);
  if (synthTable) {
    const cls = entityClassNameForTable(synthTable);
    imports.addType(cls, importPathOf(relativeImportPath(fromFile, synthEntityFilePath(synthTable, graph))));
    return cls;
  }
  // Cozulemeyen serbest ad (hicbir Model/DTO/Enum/View/sentetik-Table node'una
  // cozulmedi): bu, graf'in bir KONTRAT BOSLUGUDUR — referans edilen tipin tanimi
  // yok. Token'i OLDUGU GIBI birakmak `Promise<TokenPair>` gibi TS2304 ile derlemeyi
  // KIRARDI. Bunun yerine acik-uclu `Record<string, unknown>`'a GUVENLI degrade et:
  //   · donus pozisyonu: `{ accessToken, ... }` obje literali atanabilir,
  //   · tuketim: `result.accessToken` -> unknown (index signature) — ikisi de derlenir.
  // Bosluk yine de YUKSEK SESLE bildirilir (contract-lint unresolvedTypeRefs uyarisi).
  return "Record<string, unknown>";
}

/** Bir tip token'i (or. "User" veya "Users") bir Table'dan SENTEZLENECEK
 *  entity'ye karsilik geliyor mu? Yalniz (a) bir Repository tarafindan referans
 *  edilen ve (b) Model'i WITHOUT Table'lar aday — bunlar icin sentetik entity
 *  dosyasi gercekten uretilir (aksi halde import TS2307 verirdi). Token, tablonun
 *  ham adi VEYA sentetik sinif adi (singular-pascal) olabilir. */
function resolveSyntheticEntityType(token: string, graph: CodeGraph): CodeNode | null {
  const want = pascalCase(token);
  for (const table of graph.allOf("Table")) {
    if (hasBackingModel(table, graph)) continue;
    if (!isRepositoryReferenced(table, graph)) continue;
    if (pascalCase(table.name) === want || entityClassNameForTable(table) === want) {
      return table;
    }
  }
  return null;
}

/** Bir Table, bir Repository.EntityReference ile referans ediliyor mu? */
function isRepositoryReferenced(table: CodeNode, graph: CodeGraph): boolean {
  for (const repo of graph.allOf("Repository")) {
    const ref = (repo.properties as Record<string, unknown>).EntityReference;
    if (typeof ref !== "string" || ref.length === 0) continue;
    const node = graph.resolveRef(["Model", "Table"], ref);
    if (node && node.id === table.id) return true;
  }
  return false;
}

/** Bu Table'i TableRef ile temsil eden bir Model var mi? (varsa Model entity'si
 *  uretilir; sentez gereksiz — resolveTypeRef Model'i ayri cozer.) */
function hasBackingModel(table: CodeNode, graph: CodeGraph): boolean {
  for (const m of graph.allOf("Model")) {
    const tableRef = (m.properties as Record<string, unknown>).TableRef;
    if (typeof tableRef === "string" && graph.resolveRef("Table", tableRef)?.id === table.id) {
      return true;
    }
  }
  return false;
}

/* ────────────────────────────────────────────────────────────────────────
 * Feature klasoru + dosya yolu — ARCHITECTURE-FARKINDA.
 *
 * Her node bir FEATURE slug'a ("auth", "image", ...) veya "common"a aittir;
 * bu atama ir.ts feature-inference tarafindan yapilir ve graph.featureOf(node)
 * ile okunur. Dosya yolunun KLASORU feature'dir; DOSYA ADI ise rol son-ekini
 * TEKRARLAMAYAN idiomatik isimden (baseNameOf -> kebab) turetilir.
 *
 *   AuthController     -> src/auth/auth.controller.ts
 *   UserRepository     -> src/user/user.repository.ts (feature'ina gore)
 *   AuthResponseDTO    -> src/auth/dto/auth-response.dto.ts
 *   ImageGenerationSvc -> src/image/image-generation.service.ts
 *
 * Table migrations/ altindadir — feature'a bagli degildir (degismez).
 * ──────────────────────────────────────────────────────────────────────── */

/** Bir kind icin idiomatik rol son-eki (dosya adinda TEKRARLANMAZ). NestJS
 *  dosya adi zaten ".controller.ts"/".service.ts" eki tasidigindan sinif
 *  adindaki "Controller"/"Service"/... son-eki dosya kok adindan dusurulur. */
const ROLE_SUFFIX_BY_KIND: Partial<Record<NodeKind, string[]>> = {
  Controller: ["Controller"],
  Service: ["Service"],
  Repository: ["Repository"],
  Module: ["Module"],
  Exception: ["Exception", "Error"],
  // DTO adlari "...DTO"/"...Dto" eki tasir -> dosya adi bunu tekrarlamaz.
  DTO: ["DTO", "Dto"],
  // ── Mimari altyapi kind'lari (rol eki dosya adinda TEKRARLANMAZ) ──────────
  // "ImageResultCache" -> base "ImageResult" -> image-result.cache.ts.
  Cache: ["Cache"],
  // "ImageJobsQueue"/"ImageMessageQueue" -> "ImageJobs"/"Image" -> *.queue.ts.
  MessageQueue: ["MessageQueue", "Queue"],
  // "ThumbnailWorker" -> "Thumbnail" -> thumbnail.worker.ts.
  Worker: ["Worker"],
  // "OrderCreatedEventHandler"/"OrderCreatedHandler" -> "OrderCreated" -> *.handler.ts.
  EventHandler: ["EventHandler", "Handler"],
  // "CheckoutOrchestrator" -> "Checkout" -> checkout.orchestrator.ts.
  Orchestrator: ["Orchestrator"],
  // "StableDiffusionApi"/"StripeClient"/"MailService" -> "StableDiffusion"/
  //   "Stripe"/"Mail" -> *.client.ts (idiomatik dis servis istemcisi).
  ExternalService: ["Client", "Api", "Service"],
  // "AuthMiddleware" -> "Auth" -> auth.middleware.ts.
  Middleware: ["Middleware"],
  // "PublicApiGateway"/"PublicGateway" -> "PublicApi"/"Public" -> *.gateway.ts.
  APIGateway: ["APIGateway", "Gateway"],
};

/** Bir node'un IDIOMATIK temel adi — rol son-eki ayiklanmis (dosya/feature adi
 *  turetmek icin). "AuthController"->"Auth", "UserRepository"->"User",
 *  "AuthResponseDTO"->"AuthResponse", "ImageGenerationService"->"ImageGeneration".
 *  Bilinen rol son-eki yoksa ad oldugu gibi doner. Bos ada dusmez (rol son-eki
 *  adin TAMAMIYSA orijinal ad korunur — "Service" -> "Service"). */
export function baseNameOf(node: CodeNode): string {
  const name = node.name;
  const suffixes = ROLE_SUFFIX_BY_KIND[node.kindOf()] ?? [];
  for (const suf of suffixes) {
    if (name.length > suf.length && name.toLowerCase().endsWith(suf.toLowerCase())) {
      return name.slice(0, name.length - suf.length);
    }
  }
  return name;
}

/** Node'un feature klasoru (kebab-case). graph.featureOf -> feature slug veya
 *  "common"; ir.ts feature-inference TEK KAYNAGIDIR. Yol uretiminin yalniz
 *  okudugu bir degerdir (heuristik burada NOT). */
export function featureFolderOf(node: CodeNode, graph: CodeGraph): string {
  return graph.featureOf(node) || "common";
}

/** Migration sira numarasini 3 haneli sifir-dolgulu dondurur: 1 -> "001". */
export function migrationSeq(index: number): string {
  return String(index + 1).padStart(3, "0");
}

/* ── filePathFor: node -> proje kokune goreli POSIX yolu (bas "/" yok) ──────
 * KLASOR = feature (graph.featureOf); DOSYA ADI = baseNameOf (rol son-eki
 * TEKRARSIZ). Idiomatik NestJS duzeni:
 *   Module     -> <feature>/<feature>.module.ts       (feature basina TEK module)
 *   Controller -> <feature>/<base>.controller.ts       (auth.controller.ts)
 *   Service    -> <feature>/<base>.service.ts
 *   Repository -> <feature>/<base>.repository.ts       (user.repository.ts)
 *   Model      -> <feature>/entities/<base>.entity.ts
 *   DTO        -> <feature>/dto/<base>.dto.ts           (auth-response.dto.ts)
 *   Enum       -> <feature>/enums/<base>.enum.ts  (feature)   |  common/enums/... (common)
 *   Exception  -> <feature>/exceptions/<base>.exception.ts    |  common/exceptions/... (common)
 *   Table      -> migrations/NNN_create_<snake>.sql   (NNN ir tarafindan verilir)
 *   View       -> migrations/NNN_create_<snake>.sql   (DB view -> SQL; Table gibi kokte)
 *   Cache           -> <feature>/<base>.cache.ts
 *   MessageQueue    -> <feature>/<base>.queue.ts
 *   Worker          -> <feature>/<base>.worker.ts
 *   EventHandler    -> <feature>/<base>.handler.ts
 *   Orchestrator    -> <feature>/<base>.orchestrator.ts
 *   ExternalService -> <feature>/<base>.client.ts
 *   Middleware      -> <feature>/<base>.middleware.ts  | common/<base>.middleware.ts
 *   APIGateway      -> <feature>/<base>.gateway.ts     | common/<base>.gateway.ts
 *   diger stub -> <feature>/stubs/<base>.<role>.stub.ts  (feature koku temiz)
 *
 * Tum dosyalar src/ KOKUNE goredir; src/ onekini scaffold/montaj ekler.
 * Table/View icin sira numarasi graph.migrationIndexOf(node) ile cozulur.
 * ──────────────────────────────────────────────────────────────────────── */
export function filePathFor(node: CodeNode, graph: CodeGraph): string {
  const feature = featureFolderOf(node, graph);
  const base = kebabCase(baseNameOf(node)) || kebabCase(node.name) || feature;
  switch (node.kindOf()) {
    case "Module":
      // Feature basina tek module -> dosya adi feature'in kendisidir.
      return `${feature}/${feature}.module.ts`;
    case "Controller":
      return `${feature}/${base}.controller.ts`;
    case "Service":
      return `${feature}/${base}.service.ts`;
    case "Repository":
      return `${feature}/${base}.repository.ts`;
    case "Model":
      return `${feature}/entities/${base}.entity.ts`;
    case "DTO":
      return `${feature}/dto/${base}.dto.ts`;
    case "Enum":
      // Paylasimli enum'lar common/; feature'a ozel olanlar feature altinda.
      return feature === "common"
        ? `common/enums/${base}.enum.ts`
        : `${feature}/enums/${base}.enum.ts`;
    case "Exception":
      return feature === "common"
        ? `common/exceptions/${base}.exception.ts`
        : `${feature}/exceptions/${base}.exception.ts`;
    // Table VE View ikisi de bir SQL migration'dir (CREATE TABLE / CREATE VIEW),
    // migrations/ kokunde ve AYNI sira duzeninde (migrationIndexOf View'i kaynak
    // Table'larindan sonra yerlestirir). Fiziksel ad tek kaynaktan (tableSqlName;
    // tekrar cogullanmaz) — table.emitter / model.emitter ile tutarli.
    case "Table":
    case "View": {
      const seq = migrationSeq(graph.migrationIndexOf(node));
      return `migrations/${seq}_create_${tableSqlName(node.name)}.sql`;
    }
    case "Cache":
      return `${feature}/${base}.cache.ts`;
    case "MessageQueue":
      return `${feature}/${base}.queue.ts`;
    case "Worker":
      return `${feature}/${base}.worker.ts`;
    case "EventHandler":
      return `${feature}/${base}.handler.ts`;
    case "Orchestrator":
      return `${feature}/${base}.orchestrator.ts`;
    case "ExternalService":
      return `${feature}/${base}.client.ts`;
    case "Middleware":
      // Middleware feature'a dusmuyorsa (cross-cutting) common'a iner.
      return `${feature}/${base}.middleware.ts`;
    case "APIGateway":
      // Gateway feature'a dusmuyorsa common'a iner (filePathFor feature='common').
      return `${feature}/${base}.gateway.ts`;
    default:
      // Desteklenmeyen tip -> stub dosyasi. Feature KOKUNE sacilmaz; ayri bir
      //   `stubs/` alt klasorune toplanir (gercek kod ile karismasin).
      return `${feature}/stubs/${base}.${kebabCase(node.kindOf())}.stub.ts`;
  }
}

/** Bir TS dosyasindan (import yolu icin) uzantisiz POSIX yolu. */
export function importPathOf(filePath: string): string {
  return filePath.replace(/\.tsx?$/, "");
}

/** Iki dosya yolu arasinda goreli import yolu uretir (deterministik, POSIX).
 *  Orn from="users/users.service.ts" to="common/enums/role.enum.ts"
 *      -> "../common/enums/role.enum". */
export function relativeImportPath(fromFile: string, toFile: string): string {
  const fromDir = fromFile.split("/").slice(0, -1);
  const toParts = importPathOf(toFile).split("/");
  let i = 0;
  while (i < fromDir.length && i < toParts.length - 1 && fromDir[i] === toParts[i]) i++;
  const up = fromDir.slice(i).map(() => "..");
  const down = toParts.slice(i);
  const segments = [...up, ...down];
  const joined = segments.join("/");
  return joined.startsWith(".") ? joined : `./${joined}`;
}

/** Bir kind icin "tek basina" sinif adi son eki (Service/Controller vb. zaten
 *  isimde olabilir; emitter'lar gerekirse kullanir). */
export const KIND_CLASS_SUFFIX: Partial<Record<NodeKind, string>> = {
  Controller: "Controller",
  Service: "Service",
  Repository: "Repository",
  Module: "Module",
  Exception: "Exception",
};

/* ── Table'dan SENTEZLENEN entity isim/yolu — TEK SOURCE ───────────────────
 * entity-synthesis.ts, repository.emitter, module.emitter, naming.resolveTypeRef
 * hepsi BU iki fonksiyona dayanir (entity sinif adi/dosya yolu tutarli kalsin).
 * Burada (naming.ts) tutulur cunku resolveTypeRef bunlara ihtiyac duyar ve
 * naming.ts emitter'lardan import EDEMEZ (dongu). entity-synthesis bunlari
 * re-export eder (geriye-uyum). ──────────────────────────────────────────── */

/** Bir Table node'undan SENTEZLENEN entity sinif adi (tekil-pascal). "Users"
 *  -> "User", "generated_images" -> "GeneratedImage". */
export function entityClassNameForTable(table: CodeNode): string {
  return pascalCase(singularize(table.name));
}

/** Bir Table node'unun SENTEZLENEN entity dosya yolu:
 *  <feature>/entities/<kebab(singular)>.entity.ts. */
export function synthEntityFilePath(table: CodeNode, graph: CodeGraph): string {
  const feature = featureFolderOf(table, graph);
  const base = kebabCase(singularize(table.name)) || kebabCase(table.name) || feature;
  return `${feature}/entities/${base}.entity.ts`;
}

/** View node'unun TS @ViewEntity dosya yolu — migration'dan AYRI (filePathFor(View)
 *  SQL migration'i verir). Repository bir View'i tip olarak dondurdugunde bu sinif
 *  import edilir. */
export function viewEntityFilePath(view: CodeNode, graph: CodeGraph): string {
  const feature = featureFolderOf(view, graph);
  const base = kebabCase(view.name) || feature;
  return `${feature}/entities/${base}.view.ts`;
}

/** Cok basit deterministik tekillestirme (sozluk NONE). "users"->"user",
 *  "categories"->"category", "boxes"->"box". Yalniz son segment tekillestirilir. */
export function singularize(input: string): string {
  const segments = input.split(/[\s\-_./]+/).filter((w) => w.length > 0);
  const last = segments.length > 0 ? segments[segments.length - 1] : input;
  const prefix = input.slice(0, input.length - last.length);
  const lower = last.toLowerCase();
  let singular = last;
  if (lower.endsWith("ies") && last.length > 3) {
    singular = last.slice(0, -3) + "y";
  } else if (
    lower.endsWith("ses") ||
    lower.endsWith("xes") ||
    lower.endsWith("zes") ||
    lower.endsWith("ches") ||
    lower.endsWith("shes")
  ) {
    singular = last.slice(0, -2);
  } else if (lower.endsWith("s") && !lower.endsWith("ss") && last.length > 1) {
    singular = last.slice(0, -1);
  }
  return prefix + singular;
}
