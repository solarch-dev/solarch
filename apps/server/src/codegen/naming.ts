import type { NodeKind } from "../nodes/schemas";
import type { CodeNode, CodeGraph } from "./ir";
import type { ImportCollector } from "./imports";

/* ────────────────────────────────────────────────────────────────────────
 * naming.ts — DETERMİNİSTİK isim ve yol üretimi.
 *
 * Tüm emitter'lar isim dönüşümü ve dosya yolu için YALNIZ bu modülü kullanır
 * (hardcode case dönüşümü YASAK). Aynı node -> aynı isim -> aynı yol.
 * ──────────────────────────────────────────────────────────────────────── */

/** Bir tanımlayıcıyı kelimelere böler: camelCase, PascalCase, snake_case,
 *  kebab-case, "boşluklu metin" — hepsini normalize eder. */
export function splitWords(input: string): string[] {
  return (
    input
      // camelCase / PascalCase sınırı: "userId" -> "user Id"
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      // ardışık büyük harf + sözcük: "HTTPServer" -> "HTTP Server"
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      // ayraçlar
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

/** Bir property/field adını TS ÜYE TANIMLAYICISI olarak normalize eder (entity/model
 *  alanı + ilişki prop). Diyagram PascalCase yazsa da (Id, CustomerId, Title) idiomatik
 *  TS camelCase'e çevirir → Surgical AI grounding'i de bu yüzeyi okuyup uyumlu camelCase
 *  gövde üretir. DB kolon ADI DEĞİL — o ham `.Name`'den snakeCase ile ayrı türetilir
 *  (SnakeNamingStrategy member adını aynı snake_case'e indirir, drift olmaz). */
export const tsPropName = camelCase;

/** "UserProfile" -> "user-profile". */
export function kebabCase(input: string): string {
  return splitWords(input).map(lower).join("-");
}

/** "UserProfile" -> "user_profile". */
export function snakeCase(input: string): string {
  return splitWords(input).map(lower).join("_");
}

/* ── Fiziksel tablo adı — TEK KAYNAK ───────────────────────────────────────
 * Bir Table node'unun TableName'i (ve TableRef ile ona bağlanan Model'in
 * @Entity adı) DAİMA bu fonksiyondan gelir; böylece migration'daki
 * `CREATE TABLE` ile entity'nin `@Entity(...)` adı ASLA ayrışmaz.
 *
 * KARAR: TableName author'ın seçtiği LİTERAL fiziksel tablo adıdır — tekrar
 * çoğullanmaz (yalnız snake_case'lenir). "users" -> "users", "User" -> "user",
 * "OrderItem" -> "order_item". (Açık ad yoksa class adından türetmek için ayrıca
 * pluralizeSnake kullanılır — bkz. model.emitter resolveTableName.) */
export function tableSqlName(rawTableName: string): string {
  return snakeCase(rawTableName);
}

/* ── Çok basit, deterministik İngilizce çoğullama ──────────────────────────
 * Kapsam: yaygın kurallar. AI/sözlük YOK — codegen deterministik kalsın.
 * "category" -> "categories", "box" -> "boxes", "user" -> "users".
 * YALNIZ açık TableName'i OLMAYAN bir tabloyu class adından türetmek için
 * kullanılır (Model.TableRef yoksa). Açık TableName'e ASLA uygulanmaz. */
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
  // -y -> -ies (ünsüzden sonra)
  if (endsWith("y") && w.length > 1 && !"aeiou".includes(w[w.length - 2])) {
    return w.slice(0, -1) + "ies";
  }
  // -s, -ss, -sh, -ch, -x, -z -> -es
  if (endsWith("s") || endsWith("sh") || endsWith("ch") || endsWith("x") || endsWith("z")) {
    return w + "es";
  }
  return w + "s";
}

/* ── Şema tip stringi -> TypeScript skaler tipi ────────────────────────────
 * Şemadaki serbest tip string'leri (Param/QueryParam.Type, Model.Property.Type,
 * DTO.Field.DataType) yaygın eş anlamlıları TS tiplerine normalize eder. Bilinmeyen
 * tip OLDUĞU GİBİ döner (özel sınıf/DTO adı geçişi için). Üç emitter da (controller/
 * model/dto) aynı eşlemeyi paylaşsın diye buradadır — aksi halde controller
 * `id: uuid` gibi GEÇERSİZ TS üretirdi (uuid bir TS tipi değil). */
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
    //   (sql-type-map ile tutarlı; bare `JSON` GEÇERSİZ TS üretmesin).
    case "json":
    case "jsonb":
      return "Record<string, unknown>";
    // Parametresiz koleksiyon-ism'i (DataType="Array"/"List", eleman tipi yok) → bare
    // `Array` GEÇERSİZ TS (TS2314: tip argümanı ister). Güvenli degradasyon: `unknown`
    // (IsCollection ekiyle `unknown[]`). Parametreli `List<X>`/`X[]` resolveTypeRef yolunda.
    case "array":
    case "list":
      return "unknown";
    default:
      return raw;
  }
}

/* ── Serbest tip stringi -> GEÇERLİ TS tipi (scalar + ref çözümü + import) ──
 * Repository CustomQuery ve Service metot param/return tipleri şemada SERBEST
 * string'tir (ör. "User", "UUID", "User[]", "Promise<User>"). Ham bırakılırsa
 * "User"/"UUID" gibi tanımsız semboller `nest build`'i TS2304 ile kırar.
 *
 * resolveTypeRef tek bir tip token'ını:
 *   1) scalarTsType ile normalize eder (uuid->string, int->number, date->Date...),
 *   2) skaler değilse Model/DTO/Enum node'u olarak çözmeye çalışır -> çözülürse
 *      sınıf adını import eder (fromFile'a göreli) ve döndürür,
 *   3) hiçbiri değilse token'ı OLDUĞU GİBİ bırakır (serbest tip; derlemeyi
 *      kırabilir ama bu zaten kullanıcının verdiği tiptir — controller.emitter
 *      ile aynı tolerans).
 *
 * Kompozit tipleri (Array<X>, X[], Promise<X>, X | null, X | undefined) parçalar:
 * sarmalayıcıyı korur, İÇERDEKİ tanımlayıcıları tek tek çözer. Determinizm:
 * yalnız ham string üzerinde regex; node sırası graph'tan gelir.
 * ──────────────────────────────────────────────────────────────────────── */
export function resolveTypeRef(
  rawType: string,
  graph: CodeGraph,
  fromFile: string,
  imports: ImportCollector,
): string {
  const raw = (rawType ?? "").trim();
  if (raw.length === 0) return "void";
  // LLM-yazımı koleksiyon-ism'i: `List<X>` (Java/Kotlin) geçerli TS değil →
  // TS-native `Array<X>` (sözcük-sınırlı, büyük/küçük harf duyarsız; `UserList`
  // dokunulmaz). Aşağıdaki döngü `Array`'i zaten passthrough geçer, içteki X'i çözer.
  const t = raw.replace(/\bList\s*</gi, "Array<");
  // Her tanımlayıcı parçasını çöz; tanımlayıcı-olmayan kısımları (<>[]|, boşluk)
  // olduğu gibi koru. Bu, Promise<User>, User[], User | null gibi tipleri kapsar.
  return t.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (token) => resolveTypeToken(token, graph, fromFile, imports));
}

/** Bilinen tip-anahtar kelimeleri (çözülmez; olduğu gibi geçer). */
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
  // Skaler eş anlamlı mı? (uuid/int/date ...) -> TS skaleri.
  const scalar = scalarTsType(token);
  if (scalar !== token) return scalar;
  // Skaler değil -> bir Model/DTO/Enum node'u olabilir; çöz + import et.
  const node = graph.resolveRef(["Model", "DTO", "Enum"], token);
  if (node) {
    const cls = pascalCase(node.name);
    const path = importPathOf(relativeImportPath(fromFile, filePathFor(node, graph)));
    // Enum tip-pozisyonunda görünse de gövdede DEĞER olarak kullanılır (Status.SUBMITTED,
    // Object.values(Enum)) → VALUE import. `import type` olsa TS1361 verir. Model/DTO tip-only kalır.
    if (node.kindOf() === "Enum") imports.add(cls, path);
    else imports.addType(cls, path);
    return cls;
  }
  // Bir DB View mi? (repository View döndürür). View migration + TS @ViewEntity üretir;
  // tip olarak @ViewEntity sınıfını import et (filePathFor(View) migration'dır → viewEntityFilePath).
  const view = graph.resolveRef("View", token);
  if (view) {
    const cls = pascalCase(view.name);
    // @ViewEntity bir SINIF — gövdede değer olarak da kullanılabilir (repository token,
    // new) → VALUE import (Enum ile aynı; `import type` TS1361 verir).
    imports.add(cls, importPathOf(relativeImportPath(fromFile, viewEntityFilePath(view, graph))));
    return cls;
  }
  // Bir Table'dan SENTEZLENEN entity adı mı? (Model yokken servis/repo "User"
  //   döndürür; sentetik entity sınıf adı entityClassNameForTable ile eşleşir.)
  //   Hem ham tablo adı ("Users") hem sentetik sınıf adı ("User") eşlenir.
  const synthTable = resolveSyntheticEntityType(token, graph);
  if (synthTable) {
    const cls = entityClassNameForTable(synthTable);
    imports.addType(cls, importPathOf(relativeImportPath(fromFile, synthEntityFilePath(synthTable, graph))));
    return cls;
  }
  // Çözülemeyen serbest ad (hiçbir Model/DTO/Enum/View/sentetik-Table node'una
  // çözülmedi): bu, graf'ın bir KONTRAT BOŞLUĞUDUR — referans edilen tipin tanımı
  // yok. Token'ı OLDUĞU GİBİ bırakmak `Promise<TokenPair>` gibi TS2304 ile derlemeyi
  // KIRARDI. Bunun yerine açık-uçlu `Record<string, unknown>`'a GÜVENLİ degrade et:
  //   · dönüş pozisyonu: `{ accessToken, ... }` obje literali atanabilir,
  //   · tüketim: `result.accessToken` -> unknown (index signature) — ikisi de derlenir.
  // Boşluk yine de YÜKSEK SESLE bildirilir (contract-lint unresolvedTypeRefs uyarısı).
  return "Record<string, unknown>";
}

/** Bir tip token'ı (ör. "User" veya "Users") bir Table'dan SENTEZLENECEK
 *  entity'ye karşılık geliyor mu? Yalnız (a) bir Repository tarafından referans
 *  edilen ve (b) Model'i OLMAYAN Table'lar aday — bunlar için sentetik entity
 *  dosyası gerçekten üretilir (aksi halde import TS2307 verirdi). Token, tablonun
 *  ham adı VEYA sentetik sınıf adı (singular-pascal) olabilir. */
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

/** Bu Table'ı TableRef ile temsil eden bir Model var mı? (varsa Model entity'si
 *  üretilir; sentez gereksiz — resolveTypeRef Model'i ayrı çözer.) */
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
 * Feature klasörü + dosya yolu — MİMARİ-FARKINDA.
 *
 * Her node bir FEATURE slug'a ("auth", "image", ...) veya "common"a aittir;
 * bu atama ir.ts feature-inference tarafından yapılır ve graph.featureOf(node)
 * ile okunur. Dosya yolunun KLASÖRÜ feature'dır; DOSYA ADI ise rol son-ekini
 * TEKRARLAMAYAN idiomatik isimden (baseNameOf -> kebab) türetilir.
 *
 *   AuthController     -> src/auth/auth.controller.ts
 *   UserRepository     -> src/user/user.repository.ts (feature'ına göre)
 *   AuthResponseDTO    -> src/auth/dto/auth-response.dto.ts
 *   ImageGenerationSvc -> src/image/image-generation.service.ts
 *
 * Table migrations/ altındadır — feature'a bağlı değildir (değişmez).
 * ──────────────────────────────────────────────────────────────────────── */

/** Bir kind için idiomatik rol son-eki (dosya adında TEKRARLANMAZ). NestJS
 *  dosya adı zaten ".controller.ts"/".service.ts" eki taşıdığından sınıf
 *  adındaki "Controller"/"Service"/... son-eki dosya kök adından düşürülür. */
const ROLE_SUFFIX_BY_KIND: Partial<Record<NodeKind, string[]>> = {
  Controller: ["Controller"],
  Service: ["Service"],
  Repository: ["Repository"],
  Module: ["Module"],
  Exception: ["Exception", "Error"],
  // DTO adları "...DTO"/"...Dto" eki taşır -> dosya adı bunu tekrarlamaz.
  DTO: ["DTO", "Dto"],
  // ── Mimari altyapı kind'ları (rol eki dosya adında TEKRARLANMAZ) ──────────
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
  //   "Stripe"/"Mail" -> *.client.ts (idiomatik dış servis istemcisi).
  ExternalService: ["Client", "Api", "Service"],
  // "AuthMiddleware" -> "Auth" -> auth.middleware.ts.
  Middleware: ["Middleware"],
  // "PublicApiGateway"/"PublicGateway" -> "PublicApi"/"Public" -> *.gateway.ts.
  APIGateway: ["APIGateway", "Gateway"],
};

/** Bir node'un IDIOMATIK temel adı — rol son-eki ayıklanmış (dosya/feature adı
 *  türetmek için). "AuthController"->"Auth", "UserRepository"->"User",
 *  "AuthResponseDTO"->"AuthResponse", "ImageGenerationService"->"ImageGeneration".
 *  Bilinen rol son-eki yoksa ad olduğu gibi döner. Boş ada düşmez (rol son-eki
 *  adın TAMAMIYSA orijinal ad korunur — "Service" -> "Service"). */
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

/** Node'un feature klasörü (kebab-case). graph.featureOf -> feature slug veya
 *  "common"; ir.ts feature-inference TEK KAYNAĞIDIR. Yol üretiminin yalnız
 *  okuduğu bir değerdir (heuristik burada DEĞİL). */
export function featureFolderOf(node: CodeNode, graph: CodeGraph): string {
  return graph.featureOf(node) || "common";
}

/** Migration sıra numarasını 3 haneli sıfır-dolgulu döndürür: 1 -> "001". */
export function migrationSeq(index: number): string {
  return String(index + 1).padStart(3, "0");
}

/* ── filePathFor: node -> proje köküne göreli POSIX yolu (baş "/" yok) ──────
 * KLASÖR = feature (graph.featureOf); DOSYA ADI = baseNameOf (rol son-eki
 * TEKRARSIZ). Idiomatik NestJS düzeni:
 *   Module     -> <feature>/<feature>.module.ts       (feature başına TEK module)
 *   Controller -> <feature>/<base>.controller.ts       (auth.controller.ts)
 *   Service    -> <feature>/<base>.service.ts
 *   Repository -> <feature>/<base>.repository.ts       (user.repository.ts)
 *   Model      -> <feature>/entities/<base>.entity.ts
 *   DTO        -> <feature>/dto/<base>.dto.ts           (auth-response.dto.ts)
 *   Enum       -> <feature>/enums/<base>.enum.ts  (feature)   |  common/enums/... (common)
 *   Exception  -> <feature>/exceptions/<base>.exception.ts    |  common/exceptions/... (common)
 *   Table      -> migrations/NNN_create_<snake>.sql   (NNN ir tarafından verilir)
 *   View       -> migrations/NNN_create_<snake>.sql   (DB view -> SQL; Table gibi kökte)
 *   Cache           -> <feature>/<base>.cache.ts
 *   MessageQueue    -> <feature>/<base>.queue.ts
 *   Worker          -> <feature>/<base>.worker.ts
 *   EventHandler    -> <feature>/<base>.handler.ts
 *   Orchestrator    -> <feature>/<base>.orchestrator.ts
 *   ExternalService -> <feature>/<base>.client.ts
 *   Middleware      -> <feature>/<base>.middleware.ts  | common/<base>.middleware.ts
 *   APIGateway      -> <feature>/<base>.gateway.ts     | common/<base>.gateway.ts
 *   diğer stub -> <feature>/stubs/<base>.<role>.stub.ts  (feature kökü temiz)
 *
 * Tüm dosyalar src/ KÖKÜNE göredir; src/ önekini scaffold/montaj ekler.
 * Table/View için sıra numarası graph.migrationIndexOf(node) ile çözülür.
 * ──────────────────────────────────────────────────────────────────────── */
export function filePathFor(node: CodeNode, graph: CodeGraph): string {
  const feature = featureFolderOf(node, graph);
  const base = kebabCase(baseNameOf(node)) || kebabCase(node.name) || feature;
  switch (node.kindOf()) {
    case "Module":
      // Feature başına tek module -> dosya adı feature'ın kendisidir.
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
      // Paylaşımlı enum'lar common/; feature'a özel olanlar feature altında.
      return feature === "common"
        ? `common/enums/${base}.enum.ts`
        : `${feature}/enums/${base}.enum.ts`;
    case "Exception":
      return feature === "common"
        ? `common/exceptions/${base}.exception.ts`
        : `${feature}/exceptions/${base}.exception.ts`;
    // Table VE View ikisi de bir SQL migration'dır (CREATE TABLE / CREATE VIEW),
    // migrations/ kökünde ve AYNI sıra düzeninde (migrationIndexOf View'ı kaynak
    // Table'larından sonra yerleştirir). Fiziksel ad tek kaynaktan (tableSqlName;
    // tekrar çoğullanmaz) — table.emitter / model.emitter ile tutarlı.
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
      // Middleware feature'a düşmüyorsa (cross-cutting) common'a iner.
      return `${feature}/${base}.middleware.ts`;
    case "APIGateway":
      // Gateway feature'a düşmüyorsa common'a iner (filePathFor feature='common').
      return `${feature}/${base}.gateway.ts`;
    default:
      // Desteklenmeyen tip -> stub dosyası. Feature KÖKÜNE saçılmaz; ayrı bir
      //   `stubs/` alt klasörüne toplanır (gerçek kod ile karışmasın).
      return `${feature}/stubs/${base}.${kebabCase(node.kindOf())}.stub.ts`;
  }
}

/** Bir TS dosyasından (import yolu için) uzantısız POSIX yolu. */
export function importPathOf(filePath: string): string {
  return filePath.replace(/\.tsx?$/, "");
}

/** İki dosya yolu arasında göreli import yolu üretir (deterministik, POSIX).
 *  Örn from="users/users.service.ts" to="common/enums/role.enum.ts"
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

/** Bir kind için "tek başına" sınıf adı son eki (Service/Controller vb. zaten
 *  isimde olabilir; emitter'lar gerekirse kullanır). */
export const KIND_CLASS_SUFFIX: Partial<Record<NodeKind, string>> = {
  Controller: "Controller",
  Service: "Service",
  Repository: "Repository",
  Module: "Module",
  Exception: "Exception",
};

/* ── Table'dan SENTEZLENEN entity isim/yolu — TEK KAYNAK ───────────────────
 * entity-synthesis.ts, repository.emitter, module.emitter, naming.resolveTypeRef
 * hepsi BU iki fonksiyona dayanır (entity sınıf adı/dosya yolu tutarlı kalsın).
 * Burada (naming.ts) tutulur çünkü resolveTypeRef bunlara ihtiyaç duyar ve
 * naming.ts emitter'lardan import EDEMEZ (döngü). entity-synthesis bunları
 * re-export eder (geriye-uyum). ──────────────────────────────────────────── */

/** Bir Table node'undan SENTEZLENEN entity sınıf adı (tekil-pascal). "Users"
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
 *  SQL migration'ı verir). Repository bir View'ı tip olarak döndürdüğünde bu sınıf
 *  import edilir. */
export function viewEntityFilePath(view: CodeNode, graph: CodeGraph): string {
  const feature = featureFolderOf(view, graph);
  const base = kebabCase(view.name) || feature;
  return `${feature}/entities/${base}.view.ts`;
}

/** Çok basit deterministik tekilleştirme (sözlük YOK). "users"->"user",
 *  "categories"->"category", "boxes"->"box". Yalnız son segment tekilleştirilir. */
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
