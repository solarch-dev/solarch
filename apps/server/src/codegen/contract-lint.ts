import { propsOf, type CodeGraph } from "./ir";

/* ────────────────────────────────────────────────────────────────────────
 * contract-lint.ts — DİYAGRAM-ANI KONTRAT DENETİMİ.
 *
 * Graf'ın YAPISAL eksiklerini codegen uyarısına çevirir: üretim BAŞARILI olur ama
 * kullanıcıya bildirilir (GeneratedProject.warnings -> canvas bunları işaretler).
 * Felsefe: emitter graf ne diyorsa onu üretir; eksik bir kontratı emitter'da
 * "uydurmak" yerine burada YÜKSEK SESLE yakala (L1 Contract-Compiler'ın çekirdeği).
 *
 * Şimdiki kural:
 *   - Gövde-alan write endpoint'i (POST/PUT/PATCH) bir input DTO'su (RequestDTORef)
 *     OLMADAN -> @Body üretilemez, istek gövdesi sessizce yok sayılır. (surgical-output
 *     bug'ı: category POST / order PATCH'te @Body yoktu, AI placeholder uydurdu.)
 *
 * SAF + DETERMİNİSTİK: yalnız graf okuması, sıralı çıktı, yan etki yok.
 * ──────────────────────────────────────────────────────────────────────── */

/** Bir istek gövdesi (body) bekleyebilen HTTP fiilleri. GET/DELETE gövdesizdir. */
const WRITE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH"]);

/** Graf üzerinde kontrat denetimi koşar; bulunan ihlalleri sıralı uyarı listesi
 *  olarak döndürür (ihlal yoksa boş dizi). codegen.service.assemble bunu
 *  graph.warnings() ile birleştirir. */
export function lintContracts(graph: CodeGraph): string[] {
  const warnings: string[] = [];
  for (const ctrl of graph.allOf("Controller")) {
    const props = propsOf<"Controller">(ctrl);
    for (const ep of props.Endpoints ?? []) {
      // Kural 1: gövde-alan write endpoint'i (POST/PUT/PATCH) input DTO'su olmadan.
      if (WRITE_METHODS.has(ep.HttpMethod) && !ep.RequestDTORef) {
        warnings.push(
          `${ctrl.name}: ${ep.HttpMethod} ${ep.Route} has no request body DTO ` +
            `(RequestDTORef) — the request body is ignored. Connect an input DTO to this endpoint.`,
        );
      }
      // Kural 2: rol gerektiren ama auth gerektirmeyen endpoint. RolesGuard
      // request.user.role'e bakar; AuthGuard (authentication) yoksa request.user
      // set edilmez -> RolesGuard her isteği reddeder -> endpoint ERİŞİLEMEZ.
      if ((ep.RequiredRoles?.length ?? 0) > 0 && !ep.RequiresAuth) {
        warnings.push(
          `${ctrl.name}: ${ep.HttpMethod} ${ep.Route} requires roles but not authentication ` +
            `(RequiresAuth=false) — roles cannot be enforced without an authenticated user; the ` +
            `endpoint becomes unreachable. Enable authentication on this endpoint.`,
        );
      }

      // Kural 3: route ":param"'ı eşleşen PathParam'sız. Emitter @Param("x")'i
      // PathParams'tan üretir; route ":x" ama PathParam yoksa handler x'i OKUYAMAZ.
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
      // çözülmüyor -> emitter `unknown /* TODO */` üretir; bağlantı eksik/yanlış.
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

  // Kural 5: DANGLING entity/dependency ref'leri (kopuk bağlantılar). Emitter bunları
  // tolere eder (Repository<any> / import'suz inject) ama graf bağlantısı eksik/yanlış.
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

  // Kural 6: NULLABILITY uyumsuzluğu — bir DTO ZORUNLU alanı (IsRequired), aynı-isimli entity
  // tablosunda NULLABLE bir kolondan (IsNotNull=false) besleniyor. Codegen ikisini de sadık
  // üretir (entity `x?: T`, dto `x: T`); fill nullable kaynağı zorunlu hedefe KÖPRÜLEMEK zorunda
  // (default/throw) yoksa TS2322. Surgical AI bunu artık köprüler, ama çelişkiyi KAYNAĞINDA
  // (diyagramda) yakala. Eşleştirme isim-bazlı (VideoDTO → Videos tablosu) → yalnız aday tablo
  // VE aynı-isimli kolon varken uyarır (dar, düşük false-positive). Uyarı bloklamaz.
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

/** Bir entity ADI için (VideoDTO'dan türetilmiş "Video") eşleşen Table node'unu bulur:
 *  doğrudan / tekil↔çoğul (Video↔Videos, -ies/-y) eşleşmesi, büyük-küçük harf duyarsız.
 *  Aday yoksa null → DTO entity-bağlı değil (request/aggregate DTO'su) → lint atlar.
 *  Dönüş tipi çıkarımla (CodeNode | null) — ir.ts CodeNode'u export etmez. */
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

/** Bir route'taki parametre adları: ":id" / "{id}" segmentlerinden ad'ları çıkarır. */
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
