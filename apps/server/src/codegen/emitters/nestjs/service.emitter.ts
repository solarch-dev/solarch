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
 * @Injectable() bir NestJS servisi uretir:
 *   - DI alanlari: ServiceNode.Dependencies (Kind+Ref) BIRLESIM
 *     graph.outEdges(id, "CALLS") hedefleri (Repository/Service/Cache/
 *     ExternalService). DEDUP edilir, isme gore siralanir, constructor'a
 *     `private readonly <camelCaseRef>: <ClassName>` olarak enjekte edilir.
 *     Cozulebilen ref'ler icin import eklenir; cozulemeyen ref'ler ham
 *     Ref isminden sinif adi turetir (import atlanir → ASLA throw).
 *   - Metotlar: Parameters (DtoRef -> DTO tipi+import; yoksa ham Type;
 *     Optional -> "?"; Default), ReturnType (ReturnDtoRef -> DTO;
 *     IsAsync -> Promise<>). Govde = surgicalMarker (Description, Throws ->
 *     Exception, erisilebilir bagimliliklar this.<dep>) + notImplemented().
 *
 * SAF + DETERMINISTIC: koleksiyonlar sirali, import'lar ImportCollector ile,
 * timestamp/random yok, icerik tek "\n" ile biter.
 * ──────────────────────────────────────────────────────────────────────── */

/** DI ile enjekte edilebilen bagimlilik kind'lari (Dependencies.Kind ⊆ bunlar). */
const INJECTABLE_KINDS: NodeKind[] = ["Repository", "Service", "Cache", "ExternalService"];

/** Bir servisi "auth servisi" sayan kimlik-metodu adlari (onek eslesmesi). Boyle
 *  bir metot varsa paylasimli auth helper'lari (password/token) import edilir →
 *  fill grounding'i: Login/Register duz-metin sifre / sahte token yerine bunlari kullanir. */
const AUTH_METHOD_RE =
  /^(login|register|signup|signin|authenticate|refreshtoken|validatetoken|verifytoken|resetpassword|changepassword|forgotpassword)/i;

/** Tam backend emitter'i OLAN (sinifi `pascalCase(name)` olarak export eden)
 *  kind'lar. Cache + ExternalService artik tam emitter'a sahip (cache.emitter /
 *  external-service.emitter) -> gercek sinifi `pascalCase(name)` export ederler
 *  (Stub eki NONE). DI tipi/import sembolu bununla eslesmek ZORUNDA; ir.ts
 *  FULL_PROVIDER_KINDS ile birebir tutulmalidir. */
const FULL_EMITTER_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  "Repository",
  "Service",
  "Cache",
  "ExternalService",
]);

/** Bir node'un uretilen dosyada export ettigi sinif adini dondurur: tam
 *  emitter'li kind'lar `pascalCase(name)`; stub'lanan kind'lar `pascalCase(name)
 *  + "Stub"` (stub.emitter.ts ile TEK SOURCE). resolved=null (kayip ref) ->
 *  ham ref'in pascal'i (kind bilinmez; mevcut davranis korunur). */
function injectedClassName(resolved: CodeNode | null, rawRef: string): string {
  if (!resolved) return pascalCase(rawRef);
  const base = pascalCase(resolved.name);
  return FULL_EMITTER_KINDS.has(resolved.kindOf()) ? base : `${base}Stub`;
}

/** Cozulmus bir bagimlilik: DI alani + sinif tipi + (varsa) import yolu. */
interface ResolvedDep {
  /** constructor'da `this.<field>` */
  field: string;
  /** enjekte edilen sinif tipi */
  className: string;
  /** cozulen node'un dosya yolu (import icin); cozulemezse null. */
  filePath: string | null;
}

export const emitService: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = propsOf<"Service">(node);
  const className = pascalCase(node.name);
  const filePath = filePathFor(node, ctx.graph);
  const graph = ctx.graph;

  const imports = new ImportCollector();
  imports.add("Injectable", "@nestjs/common");

  // ── DI bagimliliklari: Dependencies ∪ CALLS hedefleri, DEDUP + isme gore sirali ──
  // Cozulemeyen dep'ler (filePath===null) DI'dan DUSURULUR: ciplak tipli constructor
  // param'i hem TS2304 (import yok) hem NestJS DI boot patlamasi (saglayici yok) verirdi.
  // Bunlar contract-lint Rule 5 ile YUKSEK SESLE bildirilir; in-file de TODO birakilir.
  const allDeps = collectDependencies(node, graph);
  const deps = allDeps.filter((d) => d.filePath !== null);
  const unresolvedDeps = allDeps.filter((d) => d.filePath === null);
  for (const dep of deps) {
    imports.add(dep.className, importPathOf(relativeImportPath(filePath, dep.filePath!)));
  }

  // ── AUTH GROUNDING: kimlik-metodu (login/register/...) tasiyan servise paylasimli
  //    auth helper'larini import et. Bunlar scaffold tarafindan uretilir; import
  //    edilince readDeclaredSurface AI'in apiSurface'ine koyar → Login duz-metin sifre
  //    yerine comparePassword, sahte token yerine signAccessToken kullanir. noUnusedLocals
  //    kapali → kullanilmazsa zararsiz (dead import degil tsc hatasi NOT). ──
  if (props.Methods.some((m) => AUTH_METHOD_RE.test(m.MethodName))) {
    imports.add("comparePassword", relativeImportPath(filePath, "shared/auth/password"));
    imports.add("hashPassword", relativeImportPath(filePath, "shared/auth/password"));
    imports.add("signAccessToken", relativeImportPath(filePath, "shared/auth/auth-token"));
  }

  // ── STATE-MACHINE GROUNDING (L2): status-guncelleyen metodu (Update*Status)
  //    olan servise, gecis kurali TANIMLI enum'larin assert<Enum>Transition guard'ini
  //    import et -> AI fill'i illegal durum gecisini (pending->delivered) reddeder.
  //    Yalniz Transitions tasiyan enum'lar (status enum'lari); Color/Size eklenmez. ──
  if (props.Methods.some((m) => /update\w*status/i.test(m.MethodName))) {
    for (const en of graph.allOf("Enum")) {
      if ((propsOf<"Enum">(en).Transitions ?? []).length === 0) continue;
      const enumName = pascalCase(en.name);
      imports.add(`assert${enumName}Transition`, importPathOf(relativeImportPath(filePath, filePathFor(en, graph))));
    }
  }

  // ── Metotlar ───────────────────────────────────────────────────────────
  const methodBlocks: string[] = [];
  // Metotlari MethodName'e gore deterministik sirala.
  const methods = [...props.Methods].sort((a, b) => cmp(a.MethodName, b.MethodName));
  for (const m of methods) {
    methodBlocks.push(renderMethod(node, className, m, deps, graph, filePath, imports));
  }

  // ── Sinif govdesi ────────────────────────────────────────────────────────
  const lines: string[] = [];
  // Anlamli bir aciklama varsa JSDoc bas; tek-harf/bos gurultuyu (ham "s"/"c"
  //   gibi) atla -> "/** s */" gibi anlamsiz doc uretme.
  if (isMeaningfulDoc(props.Description)) lines.push(`/** ${props.Description!.trim()} */`);
  lines.push("@Injectable()");
  lines.push(`export class ${className} {`);

  // Cozulemeyen bagimliliklar: DI'dan dusuruldu; in-file TODO ile gorunur kil.
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

/** Dependencies (Kind+Ref) ∪ CALLS edge hedeflerini DEDUP edip isme gore
 *  siralanmis ResolvedDep listesi dondurur. Cozulemeyen ref'ler ham isimden
 *  sinif adi turetir (filePath=null → import atlanir). Asla throw etmez. */
function collectDependencies(node: CodeNode, graph: CodeGraph): ResolvedDep[] {
  // refName -> ResolvedDep (DEDUP anahtari: cozulen node.name veya ham ref).
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

/** Bir bagimliligi (cozulmus node veya ham ref) DEDUP map'ine ekler.
 *  COZULEN KAZANIR: ayni isimde bir kayit zaten varsa ama o kayit cozulmemisse
 *  (filePath===null) ve gelen cozulmusse, kaydi YUKSELT (import kaybini onler).
 *  Orn. cozulemeyen bir property Dependency, ayni node'a giden cozulebilir bir
 *  CALLS edge'ini maskelemesin — eskiden ilk-kazanir filePath=null birakiyordu. */
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
    // Mevcut cozulmemis + gelen cozulmus -> yukselt; aksi halde ilk-kazanir.
    // Yukseltirken sinif adini da duzelt (stub kind'i `<Pascal>Stub` olabilir).
    if (existing.filePath === null && resolved) {
      existing.filePath = filePathFor(resolved, graph);
      existing.className = injectedClassName(resolved, rawRef);
    }
    return;
  }
  byKey.set(key, {
    // DI alani node adindan (stub eki tasimaz; "usersCache").
    field: camelCase(refName),
    // DI tipi = uretilen sinif adi: tam emitter -> Pascal; stub -> Pascal+"Stub".
    className: injectedClassName(resolved, rawRef),
    filePath: resolved ? filePathFor(resolved, graph) : null,
  });
}

/** Tek bir ServiceMethod'u (imza + surgical govde) render eder. */
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
    // implicit opsiyonel yapar. Default varsa "?" dusurulur.
    const optional = p.Optional && !hasDefault ? "?" : "";
    const def = hasDefault ? ` = ${p.Default}` : "";
    params.push(`${p.Name}${optional}: ${typeName}${def}`);
  }
  const paramList = params.join(", ");

  // ── Donus tipi ───────────────────────────────────────────────────────────
  //  TEK-SOURCE KARDINALITE: ReturnsCollection bildirildiyse (true) donus tipini
  //  DTO[]'e zorla — graf tekil ReturnType verse bile (or. ListProducts: ReturnType
  //  'ProductDto' ama operasyon koleksiyon). Boylece service imzasi controller'in
  //  koleksiyon karariyla HIZALI kalir; aksi halde tekil imza + dizi donduren surgical
  //  govde derleme hatasi verirdi (gercek bug). Zaten dizi/Array<> tasiyan tip IKI
  //  KEZ sarilmaz.
  let innerReturn = resolveTypeName(method.ReturnDtoRef, method.ReturnType, graph, fromFile, imports);
  // Bildirilmis ReturnsCollection (true/false) KAZANIR; yoksa metot-adi liste-
  // semantigi fallback'i (list/all/search/findAll/findMany). Zaten dizi olan tip
  // (or. ReturnType 'XDto[]') IKI KEZ sarilmaz.
  const returnsCollection =
    method.ReturnsCollection ?? tokensHaveCollectionSemantics(splitWords(method.MethodName));
  if (returnsCollection && !isArrayType(innerReturn)) {
    innerReturn = `${innerReturn}[]`;
  }
  // ── ASYNC: PUBLIC service metotlari DAIMA async (NestJS idiom + guvenlik agi).
  //  Public bir metot neredeyse her zaman I/O yapar (repo/servis cagrisi → await);
  //  graf IsAsync:false dese bile surgical fill `await` kullaninca sync imza TS1308
  //  ile kirilirdi (gercek bug: AuthService.ValidateToken). Public → async (Promise
  //  sarmali); private metotlar graf IsAsync'ini KORUR (saf yardimci olabilir).
  const isAsync = method.IsAsync || method.Visibility === "public";
  const returnType = isAsync ? `Promise<${innerReturn}>` : innerReturn;

  // ── Erisilebilir bagimliliklar (this.<field>) ──────────────────────────────
  const depFields = deps.map((d) => `this.${d.field}`);

  // ── Firlatilabilir Exception'lar — HER ZAMAN import edilir. ────────────────
  //  Cozulen Exception node'u → o dosyadan. Cozulmeyen (bildirilmis-ama-tanimsiz
  //  Throws) → exception-synthesis SENTETIK sinifi uretir; import'u da oradan yap
  //  (TEK SOURCE synthException*). Aksi halde marker fill'i `throw new X` uretmeye
  //  zorlar ama X import'suz/tanimsiz kalir → TS2304 (gercek bug: PlaceOrder'in
  //  CartEmptyException'i). Sentetik dosya assemble'da emitSyntheticException ile basilir.
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

/** Bir parametre/donus tipini cozer: DtoRef varsa DTO sinif adi (+import),
 *  yoksa ham Type NORMALIZE edilir (resolveTypeRef: UUID->string, User->import+
 *  sinif). Cozulemeyen serbest ad oldugu gibi gecer (controller.emitter ile ayni
 *  tolerans) ama skaler es anlamlilar ve entity/DTO/Enum adlari cozulur -> TS2304
 *  onlenir.
 *
 *  DIZI/SARMALAYICI KORUMA: graf zaten dizi donusleri icin ReturnType="XDto[]"
 *  (or. "CartItemDto[]") verir ama DtoRef de doludur (DTO sinifini isaret eder).
 *  Eskiden DtoRef dolu oldugunda ham Type TAMAMEN atilir, ciplak "CartItemDto"
 *  donerdi -> service tekil, controller (resolveTypeRef'ten gectigi icin) dizi ->
 *  UYUMSUZ imza. Duzeltme: DtoRef SINIF ADINI cozse bile ham Type'taki
 *  dizi/sarmalayici son-ekini ([], Array<>, <>, | null/undefined ...) KORU.
 *  Yontem: ham Type icindeki ciplak tanimlayiciyi (DTO adi) cozulmus sinif adina
 *  yer-degistir, cevreleyen sarmalayiciyi (resolveTypeRef'in korudugu <>[]| vb.)
 *  oldugu gibi birak. Ham Type sarmalayici icermiyorsa (tekil, or. "unknown" +
 *  DtoRef) MEVCUT davranis korunur: ciplak DTO sinifi doner. */
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
      // DEGER import'u (type-only NOT): surgical AI govdede DTO'yu runtime
      // deger olarak kullanir (plainToInstance(CreateUserDto, ...), validate(...));
      // `import type` olsaydi bu kullanim derlenmezdi. Controller.emitter @Body
      // DTO'sunu da DEGER import eder (class-validator runtime) -> tutarli.
      imports.add(dtoClass, importPathOf(relativeImportPath(fromFile, filePathFor(dtoNode, graph))));
      // Ham Type bir dizi/sarmalayici tasiyorsa onu KORU (controller ile hizali):
      //   "CartItemDto[]" -> "CartItemDto[]", "Promise<UserDto>" -> "Promise<UserDto>".
      //   Tekil ham Type (sarmalayicisiz) -> ciplak DTO sinifi (mevcut davranis).
      return applyTypeWrapper(rawType, dtoClass);
    }
    // Cozulemeyen DtoRef -> ham Type'i normalize et; yoksa ref ismini koru.
    return rawType && rawType !== "" ? resolveTypeRef(rawType, graph, fromFile, imports) : pascalCase(dtoRef);
  }
  return resolveTypeRef(rawType, graph, fromFile, imports);
}

/** Ham bir tip stringinin SARMALAYICISINI cozulmus sinif adina uygular.
 *
 *  Ham Type icindeki TEK ciplak tanimlayici parcasini (DTO adi) `resolvedClass`
 *  ile yer-degistirir; cevredeki sarmalayici sembolleri ([], <>, |, Array, Promise,
 *  bosluk, null, undefined ...) OLDUGU GIBI korur. Boylece:
 *    "CartItemDto[]"        + UserDto  -> "UserDto[]"        (DtoRef sinifi, dizi korunur)
 *    "CartItemDto"          + UserDto  -> "UserDto"          (tekil; mevcut davranis)
 *    "unknown" / ""         + UserDto  -> "UserDto"          (sarmalayici yok -> ciplak)
 *    "Promise<CartItemDto>" + UserDto  -> "Promise<UserDto>" (sarmalayici korunur)
 *
 *  Ham Type'ta tam olarak BIR tip-tanimlayicisi (TS anahtar kelimesi olmayan)
 *  varsa onu resolvedClass ile degistirir. Aksi halde (0 ya da >1 tanimlayici,
 *  or. union "A | B") sarmalayiciyi guvenle esleyemeyiz -> ciplak resolvedClass'a
 *  duseriz (mevcut tekil davranis; determinizm + guvenli taraf). */
function applyTypeWrapper(rawType: string, resolvedClass: string): string {
  const t = (rawType ?? "").trim();
  if (t.length === 0) return resolvedClass;
  // Tip-tanimlayicisi parcalari (TS sarmalayici anahtar kelimeleri HARIC).
  const ids = (t.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).filter((tok) => !TYPE_WRAPPER_KEYWORDS.has(tok));
  // Tam olarak bir tip-tanimlayicisi yoksa sarmalayiciyi guvenle esleyemeyiz.
  if (ids.length !== 1) return resolvedClass;
  // O tek tanimlayiciyi resolvedClass ile degistir; sarmalayiciyi koru.
  return t.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (tok) =>
    TYPE_WRAPPER_KEYWORDS.has(tok) ? tok : resolvedClass,
  );
}

/** Sarmalayici/yapisal tip anahtar kelimeleri: bunlar bir DTO adi NOTDIR, ham
 *  Type'ta gorunseler bile yer-degistirme disi tutulur (sarmalayici parcasi). */
const TYPE_WRAPPER_KEYWORDS: ReadonlySet<string> = new Set<string>([
  "Promise", "Array", "Readonly", "Partial", "null", "undefined", "void",
]);

/** Deterministik string karsilastirmasi. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}


/** Bir Description'in anlamli bir JSDoc'a degip degmedigi: trim sonrasi >=3 char.
 *  Tek-harf/bos aciklamalar ("s", "c", " ") JSDoc gurultusu; atlanir. */
function isMeaningfulDoc(desc: string | undefined): boolean {
  return typeof desc === "string" && desc.trim().length >= 3;
}

/* ── Yerel tip: ServiceMethod (service.schema.ts ile ayni shape) ──────────── */
type ServiceProps = PropsByKind["Service"];
type ServiceMethod = ServiceProps["Methods"][number];
