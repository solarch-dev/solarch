import { propsOf, type CodeGraph } from "./ir";

/* ────────────────────────────────────────────────────────────────────────
 * contract-lint.ts — DIYAGRAM-ANI KONTRAT DENETIMI.
 *
 * Graf'in YAPISAL eksiklerini codegen uyarisina cevirir: uretim BASARILI olur ama
 * kullaniciya bildirilir (GeneratedProject.warnings -> canvas bunlari isaretler).
 * Felsefe: emitter graf ne diyorsa onu uretir; eksik bir kontrati emitter'da
 * "uydurmak" yerine burada YUKSEK SESLE yakala (L1 Contract-Compiler'in cekirdegi).
 *
 * Simdiki kural:
 *   - Govde-alan write endpoint'i (POST/PUT/PATCH) bir input DTO'su (RequestDTORef)
 *     WITHOUT -> @Body uretilemez, istek govdesi sessizce yok sayilir. (surgical-output
 *     bug'i: category POST / order PATCH'te @Body yoktu, AI placeholder uydurdu.)
 *
 * SAF + DETERMINISTIC: yalniz graf okumasi, sirali cikti, yan etki yok.
 * ──────────────────────────────────────────────────────────────────────── */

/** Bir istek govdesi (body) bekleyebilen HTTP fiilleri. GET/DELETE govdesizdir. */
const WRITE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH"]);

/** Graf uzerinde kontrat denetimi kosar; bulunan ihlalleri sirali uyari listesi
 *  olarak dondurur (ihlal yoksa bos dizi). codegen.service.assemble bunu
 *  graph.warnings() ile birlestirir. */
export function lintContracts(graph: CodeGraph): string[] {
  const warnings: string[] = [];
  for (const ctrl of graph.allOf("Controller")) {
    const props = propsOf<"Controller">(ctrl);
    for (const ep of props.Endpoints ?? []) {
      // Kural 1: govde-alan write endpoint'i (POST/PUT/PATCH) input DTO'su olmadan.
      if (WRITE_METHODS.has(ep.HttpMethod) && !ep.RequestDTORef) {
        warnings.push(
          `${ctrl.name}: ${ep.HttpMethod} ${ep.Route} has no request body DTO ` +
            `(RequestDTORef) — the request body is ignored. Connect an input DTO to this endpoint.`,
        );
      }
      // Kural 2: rol gerektiren ama auth gerektirmeyen endpoint. RolesGuard
      // request.user.role'e bakar; AuthGuard (authentication) yoksa request.user
      // set edilmez -> RolesGuard her istegi reddeder -> endpoint ERISILEMEZ.
      if ((ep.RequiredRoles?.length ?? 0) > 0 && !ep.RequiresAuth) {
        warnings.push(
          `${ctrl.name}: ${ep.HttpMethod} ${ep.Route} requires roles but not authentication ` +
            `(RequiresAuth=false) — roles cannot be enforced without an authenticated user; the ` +
            `endpoint becomes unreachable. Enable authentication on this endpoint.`,
        );
      }

      // Kural 3: route ":param"'i eslesen PathParam'siz. Emitter @Param("x")'i
      // PathParams'tan uretir; route ":x" ama PathParam yoksa handler x'i OKUYAMAZ.
      const declaredParams = new Set((ep.PathParams ?? []).map((p) => p.Name));
      for (const rp of routeParamNames(ep.Route)) {
        if (!declaredParams.has(rp)) {
          warnings.push(
            `${ctrl.name}: ${ep.HttpMethod} ${ep.Route} declares a route parameter ":${rp}" ` +
              `with no matching PathParam — the handler cannot read it. Add a path parameter "${rp}".`,
          );
        }
      }

      // Kural 4: DANGLING DTO ref — RequestDTORef/ResponseDTORef bir DTO node'una
      // cozulmuyor -> emitter `unknown /* TODO */` uretir; baglanti eksik/yanlis.
      const dtoRefs: ReadonlyArray<readonly [string, string | undefined]> = [
        ["request", ep.RequestDTORef],
        ["response", ep.ResponseDTORef],
      ];
      for (const [kind, ref] of dtoRefs) {
        if (ref && !graph.resolveRef("DTO", ref)) {
          warnings.push(
            `${ctrl.name}: ${ep.HttpMethod} ${ep.Route} ${kind} DTO "${ref}" does not exist — ` +
              `no DTO node resolves it. Add the DTO or fix the reference.`,
          );
        }
      }
    }
  }

  // Kural 5: DANGLING entity/dependency ref'leri (kopuk baglantilar). Emitter bunlari
  // tolere eder (Repository<any> / import'suz inject) ama graf baglantisi eksik/yanlis.
  for (const repo of graph.allOf("Repository")) {
    const ref = propsOf<"Repository">(repo).EntityReference;
    if (ref && !graph.resolveRef(["Model", "Table"], ref)) {
      warnings.push(
        `${repo.name}: entity reference "${ref}" does not resolve to a Model or Table — ` +
          `the repository falls back to Repository<any>. Fix the entity reference.`,
      );
    }
  }
  for (const svc of graph.allOf("Service")) {
    for (const dep of propsOf<"Service">(svc).Dependencies ?? []) {
      if (!graph.resolveRef(dep.Kind, dep.Ref)) {
        warnings.push(
          `${svc.name}: dependency "${dep.Ref}" (${dep.Kind}) does not resolve to a node — ` +
            `it is injected without a valid import. Fix the dependency reference.`,
        );
      }
    }
  }

  // Kural 6: NULLABILITY uyumsuzlugu — bir DTO ZORUNLU alani (IsRequired), ayni-isimli entity
  // tablosunda NULLABLE bir kolondan (IsNotNull=false) besleniyor. Codegen ikisini de sadik
  // uretir (entity `x?: T`, dto `x: T`); fill nullable kaynagi zorunlu hedefe KOPRULEMEK zorunda
  // (default/throw) yoksa TS2322. Surgical AI bunu artik kopruler, ama celiskiyi KAYNAGINDA
  // (diyagramda) yakala. Eslestirme isim-bazli (VideoDTO → Videos tablosu) → yalniz aday tablo
  // VE ayni-isimli kolon varken uyarir (dar, dusuk false-positive). Uyari bloklamaz.
  for (const dto of graph.allOf("DTO")) {
    const entityName = dto.name.replace(/(DTO|Dto)$/, "");
    if (entityName.length === 0) continue;
    const table = findEntityTable(graph, entityName);
    if (!table) continue;
    const cols = new Map((propsOf<"Table">(table).Columns ?? []).map((c) => [c.Name.toLowerCase(), c]));
    for (const f of propsOf<"DTO">(dto).Fields ?? []) {
      if (!f.IsRequired) continue;
      const col = cols.get(f.Name.toLowerCase());
      if (col && col.IsNotNull === false) {
        warnings.push(
          `${dto.name}.${f.Name} is required but its source column ${table.name}.${col.Name} is nullable — ` +
            `the generated code maps a nullable value into a required field (the fill bridges it with a default or ` +
            `throw). To remove the friction, make the column NOT NULL or the DTO field optional.`,
        );
      }
    }
  }

  return warnings.sort();
}

/** Bir entity ADI icin (VideoDTO'dan turetilmis "Video") eslesen Table node'unu bulur:
 *  dogrudan / tekil↔cogul (Video↔Videos, -ies/-y) eslesmesi, buyuk-kucuk harf duyarsiz.
 *  Aday yoksa null → DTO entity-bagli degil (request/aggregate DTO'su) → lint atlar.
 *  Donus tipi cikarimla (CodeNode | null) — ir.ts CodeNode'u export etmez. */
function findEntityTable(graph: CodeGraph, entityName: string) {
  const en = entityName.toLowerCase();
  const variants = new Set([en, en + "s", en + "es", en.replace(/y$/, "ies")]);
  if (en.endsWith("s")) variants.add(en.slice(0, -1));
  if (en.endsWith("ies")) variants.add(en.slice(0, -3) + "y");
  for (const t of graph.allOf("Table")) {
    if (variants.has(t.name.toLowerCase())) return t;
  }
  return null;
}

/** Bir route'taki parametre adlari: ":id" / "{id}" segmentlerinden ad'lari cikarir. */
function routeParamNames(route: string): string[] {
  return route
    .split("/")
    .filter((s) => s.length > 0)
    .flatMap((seg) => {
      if (seg.startsWith(":")) return [seg.slice(1)];
      if (seg.startsWith("{") && seg.endsWith("}")) return [seg.slice(1, -1)];
      return [];
    });
}
