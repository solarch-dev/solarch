import type { GeneratedFile, NodeEmitter } from "../../types";
import { propsOf, type CodeNode } from "../../ir";
import {
  camelCase,
  filePathFor,
  importPathOf,
  pascalCase,
  relativeImportPath,
  scalarTsType,
  splitWords,
} from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers, notImplemented, surgicalMarker } from "../../surgical";
import { tokensHaveCollectionSemantics } from "../../cardinality";

/* ────────────────────────────────────────────────────────────────────────
 * controller.emitter.ts — ControllerNode -> <feature>/<c>.controller.ts.
 *
 * @Controller(BaseRoute (+ Version oneki)). DI = ctx.outEdges(id, "CALLS")
 * -> Service(ler), constructor injection (private readonly). Her Endpoint ->
 * dekoratorlu metot:
 *   - HTTP fiili     -> @Get/@Post/@Put/@Delete/@Patch(Route)
 *   - ilk StatusCode -> @HttpCode(code)
 *   - RequiresAuth   -> @UseGuards(AuthGuard)   (shared/ stub guard importu)
 *   - RequiredRoles  -> @Roles(...)             (shared/ stub decorator importu)
 *   - PathParams     -> @Param("name") name: Type
 *   - QueryParams    -> @Query("name") name: Type
 *   - RequestDTORef  -> @Body() dto: <DTO>      (ref cozulurse import + tip)
 *   - ResponseDTORef -> Promise<DTO>            (ref cozulurse import + tip)
 * Metot adi HttpMethod + Route + path param'lardan DETERMINISTIC turetilir
 * (or. GET /users/:id -> getUserById). Govde: surgicalMarker + NOT_IMPLEMENTED;
 * delegasyon ipucu (this.<service>.<?>) marker aciklamasinda verilir.
 *
 * SAF + DETERMINISTIC: koleksiyonlar sirali, kayip ref tolere edilir (THROW yok),
 * import'lar ImportCollector ile, icerik tek "\n" ile biter.
 * ──────────────────────────────────────────────────────────────────────── */

type EndpointProps = ReturnType<typeof propsOf<"Controller">>["Endpoints"][number];

const HTTP_DECORATOR: Record<string, string> = {
  GET: "Get",
  POST: "Post",
  PUT: "Put",
  DELETE: "Delete",
  PATCH: "Patch",
};

/** Istek govdesi (body) bekleyebilen HTTP fiilleri (GET/DELETE govdesizdir). */
const WRITE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH"]);

export const emitController: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = propsOf<"Controller">(node);
  const className = pascalCase(node.name);
  const thisFile = filePathFor(node, ctx.graph);

  const imports = new ImportCollector();

  // ── @Controller route: Version onekini SADECE BaseRoute zaten icermiyorsa
  //    ekle. BaseRoute tam yolu tasiyorsa (or. "api/v1/auth") tekrar onekleme
  //    -> "v1/api/v1/auth" gibi DOUBLE prefix OLUSMAZ. ──
  const baseRoute = normalizeRoute(props.BaseRoute);
  const controllerRoute = computeControllerRoute(props.Version, baseRoute);

  // @nestjs/common cekirdek dekoratorleri (kullanilanlar kosullu eklenir).
  imports.add("Controller", "@nestjs/common");
  // @nestjs/swagger: sinif @ApiTags ile bir OpenAPI grubu olarak etiketlenir
  //  (uretilen uygulama kendini Scalar /docs altinda belgeler).
  imports.add("ApiTags", "@nestjs/swagger");

  // ── DI: CALLS edge'lerinden Service'ler (edge'ler isme gore sirali) ──
  const services = collectInjectedServices(node, ctx);
  for (const svc of services) {
    imports.add(svc.className, relativeImportPath(thisFile, importPathOf(svc.file)));
  }

  // ── Endpoint metotlari ──
  // ROUTE SIRASI (Finding #6): NestJS rota'lari DEKLARASYON SIRASIYLA eslestirir.
  //   Ayni HTTP fiilinde STATIC rota'lar ("categories") PARAM rota'lardan (":id")
  //   FIRST gelmeli — yoksa "/categories" hicbir zaman eslesmez (":id" once yakalar).
  //   sortEndpointsForRouting: statik-segmentli endpoint'ler once, ":param" icerenler
  //   sonra; esitlikte mevcut sira KORUNUR (stable, deterministik).
  const orderedEndpoints = sortEndpointsForRouting(props.Endpoints);
  const methodBlocks: string[] = [];
  for (const ep of orderedEndpoints) {
    methodBlocks.push(buildEndpoint(node, ep, services, imports, thisFile, ctx, className));
  }

  // ── Sinif govdesi ──
  const lines: string[] = [];
  if (props.Description) lines.push(`/** ${props.Description} */`);
  lines.push(`@ApiTags(${JSON.stringify(node.name)})`);
  lines.push(`@Controller(${JSON.stringify(controllerRoute)})`);
  lines.push(`export class ${className} {`);

  // constructor (yalniz servis varsa)
  if (services.length > 0) {
    lines.push("  constructor(");
    services.forEach((svc, i) => {
      const comma = i < services.length - 1 ? "," : "";
      lines.push(`    private readonly ${svc.field}: ${svc.className}${comma}`);
    });
    lines.push("  ) {}");
    lines.push("");
  }

  methodBlocks.forEach((block, i) => {
    lines.push(block);
    if (i < methodBlocks.length - 1) lines.push("");
  });

  lines.push("}");

  const importBlock = imports.render();
  const body = (importBlock ? `${importBlock}\n\n` : "") + lines.join("\n") + "\n";

  const file: GeneratedFile = {
    path: thisFile,
    content: body,
    language: "typescript",
    surgicalMarkers: countSurgicalMarkers(body),
  };
  return [file];
};

/* ── DI: CALLS -> Service cozumleme ──────────────────────────────────────── */
interface InjectedService {
  name: string;
  className: string;
  field: string;
  file: string;
}

function collectInjectedServices(node: CodeNode, ctx: EmitterContext): InjectedService[] {
  const seen = new Set<string>();
  const out: InjectedService[] = [];
  // outEdges zaten kind,source.name,target.name,id'ye gore sirali (deterministik).
  for (const e of ctx.graph.outEdges(node.id, "CALLS")) {
    const tgt = ctx.graph.byId(e.targetNodeId);
    if (!tgt || tgt.kindOf() !== "Service") continue; // kayip/yanlis ref -> atla
    if (seen.has(tgt.id)) continue;
    seen.add(tgt.id);
    const cls = pascalCase(tgt.name);
    out.push({
      name: tgt.name,
      className: cls,
      field: camelCase(tgt.name),
      file: filePathFor(tgt, ctx.graph),
    });
  }
  return out;
}

/* ── Tek endpoint -> metot bloku ─────────────────────────────────────────── */
function buildEndpoint(
  node: CodeNode,
  ep: EndpointProps,
  services: InjectedService[],
  imports: ImportCollector,
  thisFile: string,
  ctx: EmitterContext,
  className: string,
): string {
  const decoratorLines: string[] = [];

  // HTTP fiili dekoratoru
  const httpDecorator = HTTP_DECORATOR[ep.HttpMethod] ?? "Get";
  imports.add(httpDecorator, "@nestjs/common");
  const routeArg = methodRouteArg(ep.Route);
  decoratorLines.push(`  @${httpDecorator}(${routeArg})`);

  // Ilk StatusCode -> @HttpCode
  const firstCode = ep.StatusCodes.length > 0 ? ep.StatusCodes[0].Code : undefined;
  if (firstCode !== undefined) {
    imports.add("HttpCode", "@nestjs/common");
    decoratorLines.push(`  @HttpCode(${firstCode})`);
  }

  // RequiresAuth/RequiredRoles -> @UseGuards(AuthGuard[, RolesGuard]). AuthGuard
  // (authentication) request.user'i yerlestirir; RolesGuard (authorization, #39)
  // @Roles metadata'sini Reflector ile okuyup enforce eder. SIRA onemli: AuthGuard
  // FIRST (user'i set eder), RolesGuard AFTER (role'u okur). Eskiden RolesGuard hic
  // baglanmiyordu -> @Roles oluydu.
  const guards: string[] = [];
  if (ep.RequiresAuth) {
    imports.add("AuthGuard", relativeImportPath(thisFile, "shared/guards/auth.guard"));
    guards.push("AuthGuard");
  }
  if (ep.RequiredRoles.length > 0) {
    imports.add("RolesGuard", relativeImportPath(thisFile, "shared/guards/roles.guard"));
    guards.push("RolesGuard");
  }
  if (guards.length > 0) {
    imports.add("UseGuards", "@nestjs/common");
    decoratorLines.push(`  @UseGuards(${guards.join(", ")})`);
  }

  // RequiredRoles -> @Roles(...) (RolesGuard bu ROLES_KEY metadata'sini okur)
  if (ep.RequiredRoles.length > 0) {
    imports.add("Roles", relativeImportPath(thisFile, "shared/decorators/roles.decorator"));
    const roleArgs = ep.RequiredRoles.map((r) => JSON.stringify(r)).join(", ");
    decoratorLines.push(`  @Roles(${roleArgs})`);
  }

  // ── Parametreler ──
  const params: string[] = [];

  // PathParams -> @Param("name") name: Type. (Paramsiz endpoint'lerde alan hic
  //  gelmeyebilir — graf verisi eksik olsa da emitter patlamamali: bos diziye dus.)
  for (const p of ep.PathParams ?? []) {
    imports.add("Param", "@nestjs/common");
    params.push(`@Param(${JSON.stringify(p.Name)}) ${safeIdent(p.Name)}: ${tsType(p.Type)}`);
  }

  // QueryParams -> @Query("name") name: Type. (Ayni savunma: alan eksikse bos dizi.)
  for (const q of ep.QueryParams ?? []) {
    imports.add("Query", "@nestjs/common");
    const optional = q.Required ? "" : "?";
    params.push(`@Query(${JSON.stringify(q.Name)}) ${safeIdent(q.Name)}${optional}: ${tsType(q.Type)}`);
  }

  // RequestDTORef -> @Body() dto: <DTO>
  let bodyDtoClass: string | null = null;
  let injectsRawBody = false;
  if (ep.RequestDTORef) {
    imports.add("Body", "@nestjs/common");
    const dto = ctx.graph.resolveRef("DTO", ep.RequestDTORef);
    if (dto) {
      bodyDtoClass = pascalCase(dto.name);
      imports.add(bodyDtoClass, relativeImportPath(thisFile, importPathOf(filePathFor(dto, ctx.graph))));
      params.push(`@Body() dto: ${bodyDtoClass}`);
    } else {
      // Kayip ref: tipsiz body (THROW yok), TODO birak.
      params.push(`@Body() dto: unknown /* TODO: DTO '${ep.RequestDTORef}' not found */`);
    }
  } else if (WRITE_METHODS.has(ep.HttpMethod)) {
    // Govde-alan write endpoint'i (POST/PUT/PATCH) RequestDTORef WITHOUT: tipli DTO yok.
    // Eskiden hic body param baglanmazdi -> surgical fill body alanlarini (or. productId,
    // quantity) SERBEST VARIABLE sanip `this.svc.x(productId, quantity)` uretip TS2304
    // veriyordu. Genel `@Body() body: Record<string, unknown>` bagla: fill gercek (tipsiz)
    // body'den okur (`body.productId` -> unknown, derlenir) — uydurma degisken uretmez.
    // (Kontrat boslugu contract-lint Rule 1 ile ayrica uyarilir.)
    imports.add("Body", "@nestjs/common");
    params.push(`@Body() body: Record<string, unknown>`);
    injectsRawBody = true;
  }

  // ── REQUEST BAGLAMI / userId (Finding #8): RequiresAuth olan endpoint'lere
  //    @CurrentUser() user: AuthUser parametresi ekle. Boylece kimligi dogrulanmis
  //    kullanicinin id'si (user.id) surgical govdede ERISILEBILIR olur — imzada
  //    gectigi icin body icinden okunabilir. @CurrentUser, paylasimli bir param
  //    decorator'dur (shared/decorators/current-user.decorator); request.user'i
  //    cozer (AuthGuard onu yerlestirir). Param SON sirada gelir (decorator'lu
  //    @Param/@Query/@Body'den sonra) — okunakli + deterministik. ──
  let injectsCurrentUser = false;
  if (ep.RequiresAuth) {
    injectsCurrentUser = true;
    imports.add("CurrentUser", relativeImportPath(thisFile, "shared/decorators/current-user.decorator"));
    imports.addType("AuthUser", relativeImportPath(thisFile, "shared/decorators/current-user.decorator"));
    params.push(`@CurrentUser() user: AuthUser`);
  }

  // ── Donus tipi ──
  //  ResponseDTORef -> Promise<DTO>. LIST RETURN (Finding #7): koleksiyon
  //  donduren endpoint (GET + path-param NONE, ya da list/findAll/search/all
  //  semantigi) tekil DTO degil DTO[] doner.
  //  AUTH/LOGIN (Finding #8): ResponseDTORef WITHOUT bir login endpoint'i tutarli
  //  bir token zarfi (AuthResponse) doner — void degil.
  let returnInner = "void";
  // Cozulen yanit DTO'su: @ApiResponse({ type: ... }) calisma-zamani (value) referansi
  //  icin sinif adi + import yolu burada yakalanir.
  let responseDtoClass: string | null = null;
  let responseDtoImport: string | null = null;
  const collection = isCollectionEndpoint(ep);
  if (ep.ResponseDTORef) {
    const dto = ctx.graph.resolveRef("DTO", ep.ResponseDTORef);
    if (dto) {
      const dtoClass = pascalCase(dto.name);
      const dtoImport = relativeImportPath(thisFile, importPathOf(filePathFor(dto, ctx.graph)));
      imports.addType(dtoClass, dtoImport);
      returnInner = collection ? `${dtoClass}[]` : dtoClass;
      responseDtoClass = dtoClass;
      responseDtoImport = dtoImport;
    } else {
      returnInner = `unknown /* TODO: DTO '${ep.ResponseDTORef}' not found */`;
    }
  } else if (isLoginEndpoint(ep)) {
    // Login -> token: tutarli bir kimlik-dogrulama yaniti (accessToken tasir).
    imports.addType("AuthResponse", relativeImportPath(thisFile, "shared/decorators/current-user.decorator"));
    returnInner = "AuthResponse";
  }
  const returnType = `Promise<${returnInner}>`;

  // ── @nestjs/swagger dekoratorleri (kendini-belgeleyen uretilmis uygulama) ──
  //  @ApiBearerAuth() RequiresAuth oldugunda; @ApiOperation({ summary }) her
  //  endpoint'te; her StatusCode icin bir @ApiResponse. Yanit DTO'su <400 kodlarda
  //  `type:` ile referanslanir (collection ise isArray:true). Aciklama/ornekler
  //  varsa zenginlestirilmis doc'tan gelir; burada DETERMINISTIC ozet kullanilir.
  if (ep.RequiresAuth) {
    imports.add("ApiBearerAuth", "@nestjs/swagger");
    decoratorLines.push(`  @ApiBearerAuth()`);
  }
  imports.add("ApiOperation", "@nestjs/swagger");
  const summary = ep.Description ?? `${ep.HttpMethod} ${ep.Route}`;
  decoratorLines.push(`  @ApiOperation({ summary: ${JSON.stringify(summary)} })`);
  imports.add("ApiResponse", "@nestjs/swagger");
  const responseCodes = ep.StatusCodes.length > 0
    ? ep.StatusCodes
    : [{ Code: ep.HttpMethod === "POST" ? 201 : 200, Description: "OK" }];
  for (const sc of responseCodes) {
    const parts: string[] = [`status: ${sc.Code}`];
    if (sc.Description) parts.push(`description: ${JSON.stringify(sc.Description)}`);
    if (responseDtoClass && responseDtoImport && sc.Code < 400) {
      // @ApiResponse({ type: Dto }) DTO'yu calisma-zamani DEGER'i olarak kullanir
      //  -> type-only import yerine deger importuna yukselt (yoksa derlenmez).
      imports.add(responseDtoClass, responseDtoImport);
      parts.push(`type: ${responseDtoClass}`);
      if (collection) parts.push(`isArray: true`);
    }
    decoratorLines.push(`  @ApiResponse({ ${parts.join(", ")} })`);
  }

  // ── Metot adi: HTTP fiili + route + path param ──
  const methodName = deriveMethodName(ep);

  // ── Govde: surgical marker + NOT_IMPLEMENTED ──
  const delegate = services.length > 0 ? services[0].field : undefined;
  const descParts: string[] = [];
  if (ep.Description) descParts.push(ep.Description);
  descParts.push(`Handles the ${ep.HttpMethod} ${ep.Route} endpoint.`);
  if (delegate) descParts.push(`Delegation hint: this.${delegate}.<?>(...).`);
  if (bodyDtoClass) descParts.push(`Input DTO: ${bodyDtoClass}.`);
  if (injectsRawBody) descParts.push(`Request body available (untyped) as 'body' — read fields via body.<name> (no typed DTO).`);
  if (injectsCurrentUser) descParts.push(`Authenticated user available as 'user' (e.g. user.id).`);
  if (collection && ep.ResponseDTORef) descParts.push(`Returns a collection (array).`);

  const marker = surgicalMarker({
    nodeId: node.id,
    member: methodName,
    description: descParts.join("\n"),
    throws: undefined,
    deps: services.length > 0 ? services.map((s) => s.field) : undefined,
  });

  // TS: opsiyonel (`name?: T`) parametre, zorunlu parametreden FIRST gelemez (TS1016).
  // @Query opsiyonel olabilir ama @CurrentUser/@Param/@Body zorunlu — opsiyonelleri
  // sona, goreli sirayi koruyarak tasi (decorator baglamayi bozmaz: konum degil
  // decorator deger atar; surgical govde param'lari ada gore okur).
  const orderedParams = [
    ...params.filter((p) => !/\?:/.test(p)),
    ...params.filter((p) => /\?:/.test(p)),
  ];
  const paramList = orderedParams.length > 0 ? `\n    ${orderedParams.join(",\n    ")},\n  ` : "";

  const block: string[] = [];
  decoratorLines.forEach((d) => block.push(d));
  block.push(`  async ${methodName}(${paramList}): ${returnType} {`);
  for (const line of marker.split("\n")) block.push(`    ${line}`);
  block.push(`    ${notImplemented(className, methodName)}`);
  block.push(`  }`);
  return block.join("\n");
}

/* ── Route sirasi / koleksiyon / login sezgileri (DETERMINISTIC) ──────────── */

/** ROUTE SIRASI (Finding #6): NestJS rota'lari @Controller icindeki DEKLARASYON
 *  sirasiyla eslestirir. ":param" iceren bir rota, kendinden sonra gelen STATIC
 *  bir rota'yi (ayni fiilde) golgeler — or. @Get(":id") @Get("categories")'ten
 *  once gelirse "/categories" hicbir zaman calismaz.
 *
 *  Bu yuzden endpoint'leri STABLE bicimde yeniden siralariz: ":param"/"{param}"
 *  segmenti WITHOUT (statik) endpoint'ler FIRST, param icerenler AFTER. Esitlikte
 *  (ikisi de statik ya da ikisi de param) MEVCUT SIRA korunur (kullanici niyeti +
 *  determinizm). HTTP fiili karistirilmaz: param-iceren GET, statik POST'tan
 *  sonraya kayabilir ama bu Nest eslesmesini bozmaz (her fiil kendi icinde sirali
 *  kalir ve statik-once kurali tum fiiller icin guvenlidir).
 *
 *  Stable sort: her endpoint'i orijinal index'iyle etiketle, anahtar (statik=0,
 *  param=1) esitse index'le kir. */
function sortEndpointsForRouting(endpoints: readonly EndpointProps[]): EndpointProps[] {
  return endpoints
    .map((ep, index) => ({ ep, index, paramRank: hasRouteParam(ep.Route) ? 1 : 0 }))
    .sort((a, b) => (a.paramRank !== b.paramRank ? a.paramRank - b.paramRank : a.index - b.index))
    .map((x) => x.ep);
}

/** Bir route en az bir ":param" veya "{param}" segmenti iceriyor mu? */
function hasRouteParam(route: string): boolean {
  return route
    .split("/")
    .filter((s) => s.length > 0)
    .some((seg) => seg.startsWith(":") || (seg.startsWith("{") && seg.endsWith("}")));
}

/** LIST RETURN (Finding #7): endpoint bir COLLECTION mu donduruyor?
 *  Kurallar (deterministik, endpoint SEKLINDEN):
 *   - Route'un son literal segmenti list/findAll/all/search/findMany semantigi -> koleksiyon
 *     (path-param olsa bile, or. /:userId/list).
 *   - GET + hic path-param NONE (ne PathParams ne de route'ta ":param") -> koleksiyon
 *     (klasik REST liste: GET /products) — ANCAK son literal segment tekil/self
 *     semantigi (me/current/profile/...) ise SINGLE (GET /me bir kayit doner).
 *  PathParams olan bir GET (or. /:id) SINGLE kaydi doner -> koleksiyon NOT. */
function isCollectionEndpoint(ep: EndpointProps): boolean {
  // TEK-SOURCE: bildirilmis ReturnsCollection (true/false) route sezgisini OVERRIDES.
  // service.emitter ile ayni alan -> controller ve service imzalari garantili hizali.
  if (typeof ep.ReturnsCollection === "boolean") return ep.ReturnsCollection;
  if (ep.HttpMethod !== "GET") return false;
  // Acik liste-semantigi her zaman koleksiyon (path-param fark etmez).
  if (routeHasListSemantics(ep.Route)) return true;
  const hasPathParam = (ep.PathParams?.length ?? 0) > 0 || hasRouteParam(ep.Route);
  if (hasPathParam) return false;
  // path-param yok: tekil/self semantigi tasimadikca koleksiyon (REST liste).
  return !routeHasSingularSemantics(ep.Route);
}

/** Route'un son STATIC segmenti list/findAll/all/search/findMany gibi bir
 *  koleksiyon-semantigi tasiyor mu? (camelCase/kebab/snake bolunur.) Kelime kumesi
 *  cardinality.ts'te TEK SOURCE — service.emitter metot adi icin aynisini kullanir. */
function routeHasListSemantics(route: string): boolean {
  const last = lastLiteralSegment(route);
  if (!last) return false;
  return tokensHaveCollectionSemantics(splitWords(last));
}

/** Route'un son STATIC segmenti SINGLE/self bir kaynak mi? (me/self/current/
 *  profile/account/health/status/info/ping...) Bunlar path-param olmasa da
 *  tek bir kayit doner -> koleksiyon SAYILMAZ. */
function routeHasSingularSemantics(route: string): boolean {
  const last = lastLiteralSegment(route);
  if (!last) return false;
  const joined = splitWords(last).map((w) => w.toLowerCase()).join("");
  const SINGULAR_WORDS = new Set([
    "me", "self", "current", "profile", "account", "health", "status", "info", "ping",
  ]);
  return SINGULAR_WORDS.has(joined);
}

/** Route'un son STATIC (param WITHOUT) segmenti; yoksa undefined. */
function lastLiteralSegment(route: string): string | undefined {
  const segments = route
    .split("/")
    .filter((s) => s.length > 0 && !s.startsWith(":") && !(s.startsWith("{") && s.endsWith("}")));
  return segments[segments.length - 1];
}

/** AUTH/LOGIN (Finding #8): ResponseDTORef WITHOUT bir login endpoint'i mi?
 *  (POST + route literal'lerinden biri "login"/"signin"/"authenticate".) Boyle
 *  bir endpoint void degil tutarli bir token zarfi (AuthResponse) doner.
 *  EXPORTED: scaffold.emitter ayni kosulu kullanarak current-user.decorator
 *  dosyasini (AuthResponse'u tutan) emit edip etmeyecegine karar verir. */
export function isLoginEndpoint(ep: EndpointProps): boolean {
  if (ep.HttpMethod !== "POST") return false;
  const segments = ep.Route.split("/").filter((s) => s.length > 0 && !s.startsWith(":") && !s.startsWith("{"));
  const LOGIN_WORDS = new Set(["login", "signin", "authenticate", "token"]);
  for (const seg of segments) {
    const joined = splitWords(seg).map((w) => w.toLowerCase()).join("");
    if (LOGIN_WORDS.has(joined)) return true;
  }
  return false;
}

/* ── Isim/route yardimcilari (DETERMINISTIC) ─────────────────────────────── */

/** Metot adi: GET /users/:id -> getUserById; POST /users -> postUser.
 *  Fiil + route segmentleri (literal -> Pascal; ":param" -> "By Param"). */
function deriveMethodName(ep: EndpointProps): string {
  const verb = ep.HttpMethod.toLowerCase();
  const segments = ep.Route.split("/").filter((s) => s.length > 0);
  const words: string[] = [];
  for (const seg of segments) {
    if (seg.startsWith(":")) {
      words.push("By");
      words.push(...splitWords(seg.slice(1)).map(cap));
    } else if (seg.startsWith("{") && seg.endsWith("}")) {
      words.push("By");
      words.push(...splitWords(seg.slice(1, -1)).map(cap));
    } else {
      words.push(...splitWords(seg).map(cap));
    }
  }
  const suffix = words.join("");
  const name = `${verb}${suffix}`;
  return name.length > 0 ? name : verb;
}

/** Route segmentindeki ":id" / "{id}" -> ":id" Nest bicimine normalize eder,
 *  bas/son "/" temizler. */
function normalizeRoute(route: string): string {
  return route
    .split("/")
    .filter((s) => s.length > 0)
    .map((seg) =>
      seg.startsWith("{") && seg.endsWith("}") ? `:${seg.slice(1, -1)}` : seg,
    )
    .join("/");
}

/** Iki route parcasini "/" ile birlestirir (boslari eler). */
function joinRoutes(a: string, b: string): string {
  return [a, b].filter((s) => s.length > 0).join("/");
}

/** @Controller route hesabi (DOUBLE-PREFIX FIX).
 *  Version yoksa -> baseRoute. Version varsa ve baseRoute o version'i bir PATH
 *  SEGMENTI olarak zaten iceriyorsa (or. base "api/v1/auth", version "v1") ->
 *  baseRoute oldugu gibi (tekrar onekleme). Aksi halde version onekle. */
function computeControllerRoute(rawVersion: string | undefined, baseRoute: string): string {
  const version = rawVersion ? normalizeRoute(rawVersion) : "";
  if (version.length === 0) return baseRoute;
  const baseSegments = baseRoute.split("/").filter((s) => s.length > 0);
  const versionSegments = version.split("/").filter((s) => s.length > 0);
  // version'in TUM segmentleri baseRoute'ta zaten varsa -> onekleme.
  const alreadyHasVersion = versionSegments.every((v) => baseSegments.includes(v));
  if (alreadyHasVersion) return baseRoute;
  return joinRoutes(version, baseRoute);
}

/** Metot dekoratorune giden route argumani. Kok ("/" veya bos) -> argumansiz. */
function methodRouteArg(route: string): string {
  const norm = normalizeRoute(route);
  return norm.length > 0 ? JSON.stringify(norm) : "";
}

/** Param adini gecerli TS tanimlayicisina cevirir (camelCase, deterministik). */
function safeIdent(raw: string): string {
  const c = camelCase(raw);
  if (c.length === 0) return "_param";
  return /^[0-9]/.test(c) ? `_${c}` : c;
}

/** Path/Query param tipini GECERLI TS'e normalize eder (uuid/int/long/datetime
 *  vb. -> string/number/Date), model.emitter/dto.emitter ile ayni esleme
 *  (scalarTsType). Bilinmeyen tip oldugu gibi gecer; bos -> "string". */
function tsType(raw: string): string {
  return scalarTsType(raw);
}

function cap(w: string): string {
  return w.length === 0 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase();
}

/* EmitterContext'i import etmeden tip yakalamak icin yerel alias (types.ts'ten). */
type EmitterContext = Parameters<NodeEmitter>[1];
