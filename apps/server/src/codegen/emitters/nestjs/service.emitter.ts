import type { GeneratedFile, NodeEmitter } from "../../types";
import { propsOf, type CodeGraph, type CodeNode, type PropsByKind } from "../../ir";
import {
  camelCase,
  filePathFor,
  importPathOf,
  pascalCase,
  relativeImportPath,
  resolveTypeRef,
  splitWords,
} from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers, notImplemented, surgicalMarker } from "../../surgical";
import { isArrayType, tokensHaveCollectionSemantics } from "../../cardinality";
import { synthExceptionFilePath } from "./exception-synthesis";
import type { NodeKind } from "../../../nodes/schemas";

/* ────────────────────────────────────────────────────────────────────────
 * service.emitter.ts — ServiceNode -> <feature>/<kebab>.service.ts.
 *
 * @Injectable() bir NestJS servisi üretir:
 *   - DI alanları: ServiceNode.Dependencies (Kind+Ref) BİRLEŞİM
 *     graph.outEdges(id, "CALLS") hedefleri (Repository/Service/Cache/
 *     ExternalService). DEDUP edilir, isme göre sıralanır, constructor'a
 *     `private readonly <camelCaseRef>: <ClassName>` olarak enjekte edilir.
 *     Çözülebilen ref'ler için import eklenir; çözülemeyen ref'ler ham
 *     Ref isminden sınıf adı türetir (import atlanır → ASLA throw).
 *   - Metotlar: Parameters (DtoRef -> DTO tipi+import; yoksa ham Type;
 *     Optional -> "?"; Default), ReturnType (ReturnDtoRef -> DTO;
 *     IsAsync -> Promise<>). Gövde = surgicalMarker (Description, Throws ->
 *     Exception, erişilebilir bağımlılıklar this.<dep>) + notImplemented().
 *
 * SAF + DETERMİNİSTİK: koleksiyonlar sıralı, import'lar ImportCollector ile,
 * timestamp/random yok, içerik tek "\n" ile biter.
 * ──────────────────────────────────────────────────────────────────────── */

/** DI ile enjekte edilebilen bağımlılık kind'ları (Dependencies.Kind ⊆ bunlar). */
const INJECTABLE_KINDS: NodeKind[] = ["Repository", "Service", "Cache", "ExternalService"];

/** Bir servisi "auth servisi" sayan kimlik-metodu adları (önek eşleşmesi). Böyle
 *  bir metot varsa paylaşımlı auth helper'ları (password/token) import edilir →
 *  fill grounding'i: Login/Register düz-metin şifre / sahte token yerine bunları kullanır. */
const AUTH_METHOD_RE =
  /^(login|register|signup|signin|authenticate|refreshtoken|validatetoken|verifytoken|resetpassword|changepassword|forgotpassword)/i;

/** Tam backend emitter'ı OLAN (sınıfı `pascalCase(name)` olarak export eden)
 *  kind'lar. Cache + ExternalService artık tam emitter'a sahip (cache.emitter /
 *  external-service.emitter) -> gerçek sınıfı `pascalCase(name)` export ederler
 *  (Stub eki YOK). DI tipi/import sembolü bununla eşleşmek ZORUNDA; ir.ts
 *  FULL_PROVIDER_KINDS ile birebir tutulmalıdır. */
const FULL_EMITTER_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  "Repository",
  "Service",
  "Cache",
  "ExternalService",
]);

/** Bir node'un üretilen dosyada export ettiği sınıf adını döndürür: tam
 *  emitter'lı kind'lar `pascalCase(name)`; stub'lanan kind'lar `pascalCase(name)
 *  + "Stub"` (stub.emitter.ts ile TEK KAYNAK). resolved=null (kayıp ref) ->
 *  ham ref'in pascal'ı (kind bilinmez; mevcut davranış korunur). */
function injectedClassName(resolved: CodeNode | null, rawRef: string): string {
  if (!resolved) return pascalCase(rawRef);
  const base = pascalCase(resolved.name);
  return FULL_EMITTER_KINDS.has(resolved.kindOf()) ? base : `${base}Stub`;
}

/** Çözülmüş bir bağımlılık: DI alanı + sınıf tipi + (varsa) import yolu. */
interface ResolvedDep {
  /** constructor'da `this.<field>` */
  field: string;
  /** enjekte edilen sınıf tipi */
  className: string;
  /** çözülen node'un dosya yolu (import için); çözülemezse null. */
  filePath: string | null;
}

export const emitService: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = propsOf<"Service">(node);
  const className = pascalCase(node.name);
  const filePath = filePathFor(node, ctx.graph);
  const graph = ctx.graph;

  const imports = new ImportCollector();
  imports.add("Injectable", "@nestjs/common");

  // ── DI bağımlılıkları: Dependencies ∪ CALLS hedefleri, DEDUP + isme göre sıralı ──
  // Çözülemeyen dep'ler (filePath===null) DI'dan DÜŞÜRÜLÜR: çıplak tipli constructor
  // param'ı hem TS2304 (import yok) hem NestJS DI boot patlaması (sağlayıcı yok) verirdi.
  // Bunlar contract-lint Rule 5 ile YÜKSEK SESLE bildirilir; in-file de TODO bırakılır.
  const allDeps = collectDependencies(node, graph);
  const deps = allDeps.filter((d) => d.filePath !== null);
  const unresolvedDeps = allDeps.filter((d) => d.filePath === null);
  for (const dep of deps) {
    imports.add(dep.className, importPathOf(relativeImportPath(filePath, dep.filePath!)));
  }

  // ── AUTH GROUNDING: kimlik-metodu (login/register/...) taşıyan servise paylaşımlı
  //    auth helper'larını import et. Bunlar scaffold tarafından üretilir; import
  //    edilince readDeclaredSurface AI'ın apiSurface'ine koyar → Login düz-metin şifre
  //    yerine comparePassword, sahte token yerine signAccessToken kullanır. noUnusedLocals
  //    kapalı → kullanılmazsa zararsız (dead import değil tsc hatası DEĞİL). ──
  if (props.Methods.some((m) => AUTH_METHOD_RE.test(m.MethodName))) {
    imports.add("comparePassword", relativeImportPath(filePath, "shared/auth/password"));
    imports.add("hashPassword", relativeImportPath(filePath, "shared/auth/password"));
    imports.add("signAccessToken", relativeImportPath(filePath, "shared/auth/auth-token"));
  }

  // ── STATE-MACHINE GROUNDING (L2): status-güncelleyen metodu (Update*Status)
  //    olan servise, geçiş kuralı TANIMLI enum'ların assert<Enum>Transition guard'ını
  //    import et -> AI fill'i illegal durum geçişini (pending->delivered) reddeder.
  //    Yalnız Transitions taşıyan enum'lar (status enum'ları); Color/Size eklenmez. ──
  if (props.Methods.some((m) => /update\w*status/i.test(m.MethodName))) {
    for (const en of graph.allOf("Enum")) {
      if ((propsOf<"Enum">(en).Transitions ?? []).length === 0) continue;
      const enumName = pascalCase(en.name);
      imports.add(`assert${enumName}Transition`, importPathOf(relativeImportPath(filePath, filePathFor(en, graph))));
    }
  }

  // ── Metotlar ───────────────────────────────────────────────────────────
  const methodBlocks: string[] = [];
  // Metotları MethodName'e göre deterministik sırala.
  const methods = [...props.Methods].sort((a, b) => cmp(a.MethodName, b.MethodName));
  for (const m of methods) {
    methodBlocks.push(renderMethod(node, className, m, deps, graph, filePath, imports));
  }

  // ── Sınıf gövdesi ────────────────────────────────────────────────────────
  const lines: string[] = [];
  // Anlamlı bir açıklama varsa JSDoc bas; tek-harf/boş gürültüyü (ham "s"/"c"
  //   gibi) atla -> "/** s */" gibi anlamsız doc üretme.
  if (isMeaningfulDoc(props.Description)) lines.push(`/** ${props.Description!.trim()} */`);
  lines.push("@Injectable()");
  lines.push(`export class ${className} {`);

  // Çözülemeyen bağımlılıklar: DI'dan düşürüldü; in-file TODO ile görünür kıl.
  for (const u of unresolvedDeps) {
    lines.push(
      `  // TODO: dependency "${u.field}" (${u.className}) could not be resolved — omitted from DI (fix the reference).`,
    );
  }

  if (deps.length > 0) {
    lines.push("  constructor(");
    for (const dep of deps) {
      lines.push(`    private readonly ${dep.field}: ${dep.className},`);
    }
    lines.push("  ) {}");
    if (methodBlocks.length > 0) lines.push("");
  }

  methodBlocks.forEach((block, i) => {
    lines.push(block);
    if (i < methodBlocks.length - 1) lines.push("");
  });

  lines.push("}");

  const importBlock = imports.render();
  const body = (importBlock ? `${importBlock}\n\n` : "") + lines.join("\n") + "\n";

  const file: GeneratedFile = {
    path: filePath,
    content: body,
    language: "typescript",
    surgicalMarkers: countSurgicalMarkers(body),
  };
  return [file];
};

/** Dependencies (Kind+Ref) ∪ CALLS edge hedeflerini DEDUP edip isme göre
 *  sıralanmış ResolvedDep listesi döndürür. Çözülemeyen ref'ler ham isimden
 *  sınıf adı türetir (filePath=null → import atlanır). Asla throw etmez. */
function collectDependencies(node: CodeNode, graph: CodeGraph): ResolvedDep[] {
  // refName -> ResolvedDep (DEDUP anahtarı: çözülen node.name veya ham ref).
  const byKey = new Map<string, ResolvedDep>();

  const props = propsOf<"Service">(node);

  // (1) property Dependencies — Kind ipucu var.
  for (const dep of props.Dependencies ?? []) {
    const resolved = graph.resolveRef(dep.Kind, dep.Ref);
    addDep(byKey, resolved, dep.Ref, graph);
  }

  // (2) CALLS edge hedefleri — Repository/Service/Cache/ExternalService.
  for (const e of graph.outEdges(node.id, "CALLS")) {
    const tgt = graph.byId(e.targetNodeId);
    if (!tgt) continue;
    if (!INJECTABLE_KINDS.includes(tgt.kindOf())) continue;
    addDep(byKey, tgt, tgt.name, graph);
  }

  return [...byKey.values()].sort((a, b) => cmp(a.field, b.field));
}

/** Bir bağımlılığı (çözülmüş node veya ham ref) DEDUP map'ine ekler.
 *  ÇÖZÜLEN KAZANIR: aynı isimde bir kayıt zaten varsa ama o kayıt çözülmemişse
 *  (filePath===null) ve gelen çözülmüşse, kaydı YÜKSELT (import kaybını önler).
 *  Örn. çözülemeyen bir property Dependency, aynı node'a giden çözülebilir bir
 *  CALLS edge'ini maskelemesin — eskiden ilk-kazanır filePath=null bırakıyordu. */
function addDep(
  byKey: Map<string, ResolvedDep>,
  resolved: CodeNode | null,
  rawRef: string,
  graph: CodeGraph,
): void {
  const refName = resolved ? resolved.name : rawRef;
  const key = refName;
  const existing = byKey.get(key);
  if (existing) {
    // Mevcut çözülmemiş + gelen çözülmüş -> yükselt; aksi halde ilk-kazanır.
    // Yükseltirken sınıf adını da düzelt (stub kind'ı `<Pascal>Stub` olabilir).
    if (existing.filePath === null && resolved) {
      existing.filePath = filePathFor(resolved, graph);
      existing.className = injectedClassName(resolved, rawRef);
    }
    return;
  }
  byKey.set(key, {
    // DI alanı node adından (stub eki taşımaz; "usersCache").
    field: camelCase(refName),
    // DI tipi = üretilen sınıf adı: tam emitter -> Pascal; stub -> Pascal+"Stub".
    className: injectedClassName(resolved, rawRef),
    filePath: resolved ? filePathFor(resolved, graph) : null,
  });
}

/** Tek bir ServiceMethod'u (imza + surgical gövde) render eder. */
function renderMethod(
  node: CodeNode,
  className: string,
  method: ServiceMethod,
  deps: ResolvedDep[],
  graph: CodeGraph,
  fromFile: string,
  imports: ImportCollector,
): string {
  const indent = "  ";

  // ── Parametreler ─────────────────────────────────────────────────────────
  const params: string[] = [];
  for (const p of method.Parameters ?? []) {
    const typeName = resolveTypeName(p.DtoRef, p.Type, graph, fromFile, imports);
    const hasDefault = p.Default !== undefined && p.Default !== "";
    // TS: bir parametre HEM "?" HEM "= default" alamaz; default zaten parametreyi
    // implicit opsiyonel yapar. Default varsa "?" düşürülür.
    const optional = p.Optional && !hasDefault ? "?" : "";
    const def = hasDefault ? ` = ${p.Default}` : "";
    params.push(`${p.Name}${optional}: ${typeName}${def}`);
  }
  const paramList = params.join(", ");

  // ── Dönüş tipi ───────────────────────────────────────────────────────────
  //  TEK-KAYNAK KARDİNALİTE: ReturnsCollection bildirildiyse (true) dönüş tipini
  //  DTO[]'e zorla — graf tekil ReturnType verse bile (ör. ListProducts: ReturnType
  //  'ProductDto' ama operasyon koleksiyon). Böylece service imzası controller'ın
  //  koleksiyon kararıyla HİZALI kalır; aksi halde tekil imza + dizi döndüren surgical
  //  gövde derleme hatası verirdi (gerçek bug). Zaten dizi/Array<> taşıyan tip İKİ
  //  KEZ sarılmaz.
  let innerReturn = resolveTypeName(method.ReturnDtoRef, method.ReturnType, graph, fromFile, imports);
  // Bildirilmiş ReturnsCollection (true/false) KAZANIR; yoksa metot-adı liste-
  // semantiği fallback'i (list/all/search/findAll/findMany). Zaten dizi olan tip
  // (ör. ReturnType 'XDto[]') İKİ KEZ sarılmaz.
  const returnsCollection =
    method.ReturnsCollection ?? tokensHaveCollectionSemantics(splitWords(method.MethodName));
  if (returnsCollection && !isArrayType(innerReturn)) {
    innerReturn = `${innerReturn}[]`;
  }
  // ── ASYNC: PUBLIC service metotları DAİMA async (NestJS idiom + güvenlik ağı).
  //  Public bir metot neredeyse her zaman I/O yapar (repo/servis çağrısı → await);
  //  graf IsAsync:false dese bile surgical fill `await` kullanınca sync imza TS1308
  //  ile kırılırdı (gerçek bug: AuthService.ValidateToken). Public → async (Promise
  //  sarmalı); private metotlar graf IsAsync'ini KORUR (saf yardımcı olabilir).
  const isAsync = method.IsAsync || method.Visibility === "public";
  const returnType = isAsync ? `Promise<${innerReturn}>` : innerReturn;

  // ── Erişilebilir bağımlılıklar (this.<field>) ──────────────────────────────
  const depFields = deps.map((d) => `this.${d.field}`);

  // ── Fırlatılabilir Exception'lar — HER ZAMAN import edilir. ────────────────
  //  Çözülen Exception node'u → o dosyadan. Çözülmeyen (bildirilmiş-ama-tanımsız
  //  Throws) → exception-synthesis SENTETİK sınıfı üretir; import'u da oradan yap
  //  (TEK KAYNAK synthException*). Aksi halde marker fill'i `throw new X` üretmeye
  //  zorlar ama X import'suz/tanımsız kalır → TS2304 (gerçek bug: PlaceOrder'ın
  //  CartEmptyException'ı). Sentetik dosya assemble'da emitSyntheticException ile basılır.
  const throwsNames: string[] = [];
  for (const exName of method.Throws ?? []) {
    const exNode = graph.resolveRef("Exception", exName);
    const exClass = pascalCase(exNode ? exNode.name : exName);
    throwsNames.push(exClass);
    const toPath = exNode ? filePathFor(exNode, graph) : synthExceptionFilePath(exName);
    imports.add(exClass, importPathOf(relativeImportPath(fromFile, toPath)));
  }

  const marker = surgicalMarker({
    nodeId: node.id,
    member: method.MethodName,
    description: method.Description,
    throws: throwsNames.length > 0 ? throwsNames : undefined,
    deps: depFields.length > 0 ? depFields : undefined,
  });

  const asyncKw = isAsync ? "async " : "";
  const visibility = method.Visibility && method.Visibility !== "public" ? `${method.Visibility} ` : "";

  const lines: string[] = [];
  lines.push(`${indent}${visibility}${asyncKw}${method.MethodName}(${paramList}): ${returnType} {`);
  for (const ml of marker.split("\n")) lines.push(`${indent}${indent}${ml}`);
  lines.push(`${indent}${indent}${notImplemented(className, method.MethodName)}`);
  lines.push(`${indent}}`);
  return lines.join("\n");
}

/** Bir parametre/dönüş tipini çözer: DtoRef varsa DTO sınıf adı (+import),
 *  yoksa ham Type NORMALIZE edilir (resolveTypeRef: UUID->string, User->import+
 *  sınıf). Çözülemeyen serbest ad olduğu gibi geçer (controller.emitter ile aynı
 *  tolerans) ama skaler eş anlamlılar ve entity/DTO/Enum adları çözülür -> TS2304
 *  önlenir.
 *
 *  DİZİ/SARMALAYICI KORUMA: graf zaten dizi dönüşleri için ReturnType="XDto[]"
 *  (or. "CartItemDto[]") verir ama DtoRef de doludur (DTO sınıfını işaret eder).
 *  Eskiden DtoRef dolu olduğunda ham Type TAMAMEN atılır, çıplak "CartItemDto"
 *  dönerdi -> service tekil, controller (resolveTypeRef'ten geçtiği için) dizi ->
 *  UYUMSUZ imza. Düzeltme: DtoRef SINIF ADINI çözse bile ham Type'taki
 *  dizi/sarmalayıcı son-ekini ([], Array<>, <>, | null/undefined ...) KORU.
 *  Yöntem: ham Type içindeki çıplak tanımlayıcıyı (DTO adı) çözülmüş sınıf adına
 *  yer-değiştir, çevreleyen sarmalayıcıyı (resolveTypeRef'in koruduğu <>[]| vb.)
 *  olduğu gibi bırak. Ham Type sarmalayıcı içermiyorsa (tekil, ör. "unknown" +
 *  DtoRef) MEVCUT davranış korunur: çıplak DTO sınıfı döner. */
function resolveTypeName(
  dtoRef: string | undefined,
  rawType: string,
  graph: CodeGraph,
  fromFile: string,
  imports: ImportCollector,
): string {
  if (dtoRef && dtoRef !== "") {
    const dtoNode = graph.resolveRef("DTO", dtoRef);
    if (dtoNode) {
      const dtoClass = pascalCase(dtoNode.name);
      // DEĞER import'u (type-only DEĞİL): surgical AI gövdede DTO'yu runtime
      // değer olarak kullanır (plainToInstance(CreateUserDto, ...), validate(...));
      // `import type` olsaydı bu kullanım derlenmezdi. Controller.emitter @Body
      // DTO'sunu da DEĞER import eder (class-validator runtime) -> tutarlı.
      imports.add(dtoClass, importPathOf(relativeImportPath(fromFile, filePathFor(dtoNode, graph))));
      // Ham Type bir dizi/sarmalayıcı taşıyorsa onu KORU (controller ile hizalı):
      //   "CartItemDto[]" -> "CartItemDto[]", "Promise<UserDto>" -> "Promise<UserDto>".
      //   Tekil ham Type (sarmalayıcısız) -> çıplak DTO sınıfı (mevcut davranış).
      return applyTypeWrapper(rawType, dtoClass);
    }
    // Çözülemeyen DtoRef -> ham Type'ı normalize et; yoksa ref ismini koru.
    return rawType && rawType !== "" ? resolveTypeRef(rawType, graph, fromFile, imports) : pascalCase(dtoRef);
  }
  return resolveTypeRef(rawType, graph, fromFile, imports);
}

/** Ham bir tip stringinin SARMALAYICISINI çözülmüş sınıf adına uygular.
 *
 *  Ham Type içindeki TEK çıplak tanımlayıcı parçasını (DTO adı) `resolvedClass`
 *  ile yer-değiştirir; çevredeki sarmalayıcı sembolleri ([], <>, |, Array, Promise,
 *  boşluk, null, undefined ...) OLDUĞU GİBİ korur. Böylece:
 *    "CartItemDto[]"        + UserDto  -> "UserDto[]"        (DtoRef sınıfı, dizi korunur)
 *    "CartItemDto"          + UserDto  -> "UserDto"          (tekil; mevcut davranış)
 *    "unknown" / ""         + UserDto  -> "UserDto"          (sarmalayıcı yok -> çıplak)
 *    "Promise<CartItemDto>" + UserDto  -> "Promise<UserDto>" (sarmalayıcı korunur)
 *
 *  Ham Type'ta tam olarak BİR tip-tanımlayıcısı (TS anahtar kelimesi olmayan)
 *  varsa onu resolvedClass ile değiştirir. Aksi halde (0 ya da >1 tanımlayıcı,
 *  ör. union "A | B") sarmalayıcıyı güvenle eşleyemeyiz -> çıplak resolvedClass'a
 *  düşeriz (mevcut tekil davranış; determinizm + güvenli taraf). */
function applyTypeWrapper(rawType: string, resolvedClass: string): string {
  const t = (rawType ?? "").trim();
  if (t.length === 0) return resolvedClass;
  // Tip-tanımlayıcısı parçaları (TS sarmalayıcı anahtar kelimeleri HARİÇ).
  const ids = (t.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).filter((tok) => !TYPE_WRAPPER_KEYWORDS.has(tok));
  // Tam olarak bir tip-tanımlayıcısı yoksa sarmalayıcıyı güvenle eşleyemeyiz.
  if (ids.length !== 1) return resolvedClass;
  // O tek tanımlayıcıyı resolvedClass ile değiştir; sarmalayıcıyı koru.
  return t.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (tok) =>
    TYPE_WRAPPER_KEYWORDS.has(tok) ? tok : resolvedClass,
  );
}

/** Sarmalayıcı/yapısal tip anahtar kelimeleri: bunlar bir DTO adı DEĞİLDİR, ham
 *  Type'ta görünseler bile yer-değiştirme dışı tutulur (sarmalayıcı parçası). */
const TYPE_WRAPPER_KEYWORDS: ReadonlySet<string> = new Set<string>([
  "Promise", "Array", "Readonly", "Partial", "null", "undefined", "void",
]);

/** Deterministik string karşılaştırması. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}


/** Bir Description'ın anlamlı bir JSDoc'a değip değmediği: trim sonrası >=3 char.
 *  Tek-harf/boş açıklamalar ("s", "c", " ") JSDoc gürültüsü; atlanır. */
function isMeaningfulDoc(desc: string | undefined): boolean {
  return typeof desc === "string" && desc.trim().length >= 3;
}

/* ── Yerel tip: ServiceMethod (service.schema.ts ile aynı shape) ──────────── */
type ServiceProps = PropsByKind["Service"];
type ServiceMethod = ServiceProps["Methods"][number];
