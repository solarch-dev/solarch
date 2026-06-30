import { describe, it, expect } from "vitest";
import { assembleRealisticFixture, assembleRealisticProject } from "./__fixtures__/load";
import type { GeneratedFile } from "./types";

/* ────────────────────────────────────────────────────────────────────────
 * codegen-assembly.spec.ts — SEAM VALIDATION GATE (fast layer, no npm).
 *
 * Realistic graph (61 node / 82 edge — restaurant app) assembled ONCE
 * then EMITTER-INTER seam consistency invariants verified on output
 * Single-emitter golden tests CANNOT catch these seam bugs (bugs live
 * BETWEEN emitters); this test catches them.
 *
 * WHY no tsc (here): two root bugs do NOT appear in tsc-on-skeleton —
 *   - PK casing ({ Id: id }) `as FindOptionsWhere` cast'iyle gizli (iskelet derlenir),
 *   - cardinality (single vs array) only fails after FILL (skeleton body throws).
 * So locked via STRUCTURAL seam assertions (deterministic, fast).
 * Whole-project tsc "compiles out of the box" guarantee is SEPARATE gate
 * (codegen-tsc.gate.test.ts + `pnpm test:codegen-gate`).
 * ──────────────────────────────────────────────────────────────────────── */

const tsFiles = (files: GeneratedFile[]) => files.filter((f) => f.language === "typescript");

describe("codegen assembly seam (realistic graph)", () => {
  const files = assembleRealisticFixture();

  it("assemble generates realistic graph (feature files + migrations)", () => {
    expect(files.length).toBeGreaterThan(50);
    // Expected features generated (restaurant/order/... repositories).
    const repos = files.filter((f) => f.path.endsWith(".repository.ts"));
    expect(repos.length).toBeGreaterThanOrEqual(5);
  });

  /* ── PK SEAM: findById key ALIGNED with entity property ──────────────
   * Bug: graph gives PK as "Id" (capital); entity property becomes "id" via tsPropName;
   * if repository uses raw "Id", findById queries nonexistent column (cast hides,
   * runtime fails). After fix NO repo should use capital-first key + each
   * findById key must exactly match its entity PK property. */
  it("no repository findById uses capital-first PK key ({ Id: id } regression)", () => {
    for (const f of tsFiles(files)) {
      // where key starting with capital like findById { Id: ... } = casing seam bug.
      expect(f.content, `${f.path} carries capital-first PK where key`).not.toMatch(
        /where:\s*\{\s*[A-Z]/,
      );
    }
  });

  it("each repository findById key exactly matches mapped entity PK property name", () => {
    // Collect entity PK property names (class -> pk): line after @PrimaryGeneratedColumn.
    const pkByEntity = new Map<string, string>();
    for (const f of tsFiles(files)) {
      if (!f.path.includes("/entities/")) continue;
      const cls = /export class (\w+)/.exec(f.content)?.[1];
      const pkLine = /@PrimaryGeneratedColumn\([^)]*\)\s*\n\s*(\w+)/.exec(f.content)?.[1];
      if (cls && pkLine) pkByEntity.set(cls, pkLine);
    }
    expect(pkByEntity.size).toBeGreaterThan(0);

    for (const f of tsFiles(files)) {
      if (!f.path.endsWith(".repository.ts")) continue;
      const entity = /Repository<(\w+)>/.exec(f.content)?.[1];
      const key = /where:\s*\{\s*(\w+): id\b/.exec(f.content)?.[1];
      if (!entity || !key || entity === "any") continue; // skip missing-entity edge case
      const expected = pkByEntity.get(entity);
      if (!expected) continue; // synthetic/unmapped entity — skip in this test
      expect(key, `${f.path}: findById key '${key}' != entity '${entity}' PK '${expected}'`).toBe(
        expected,
      );
    }
  });

  /* ── CARDINALITY SEAM: controller collection return <-> service collection return
   * Bug: controller route'tan "koleksiyon" tahmin edip DTO[] basar ama service tekil
   * stays -> after fill `return result` (array) won't compile. After fix collection
   * operations return DTO[] on both ends. Fixture has RestaurantService.GetAll/
   * Search as collection (graph ReturnType:"array"); both should be RestaurantResponse[]. */
  it("collection service methods return DTO[] (RestaurantService GetAll/Search)", () => {
    const svc = files.find((f) => f.path.endsWith("restaurant/restaurant.service.ts"));
    expect(svc).toBeDefined();
    // NOTE: GetById/Create/Update legitimately return SINGLE RestaurantResponse —
    // single return EXISTENCE is not a bug. Seam bug was COLLECTION operation (GetAll/
    // Search) staying single; so we only verify they return DTO[].
    expect(svc!.content).toMatch(/async GetAll\([^)]*\): Promise<RestaurantResponse\[\]>/);
    expect(svc!.content).toMatch(/async Search\([^)]*\): Promise<RestaurantResponse\[\]>/);
  });

  it("controller collection endpoint and service SAME DTO[] cardinality (seam aligned)", () => {
    const ctrl = files.find((f) => f.path.endsWith("restaurant/restaurant.controller.ts"));
    const svc = files.find((f) => f.path.endsWith("restaurant/restaurant.service.ts"));
    expect(ctrl).toBeDefined();
    expect(svc).toBeDefined();
    // Controller carries at least one collection return...
    expect(ctrl!.content).toMatch(/Promise<RestaurantResponse\[\]>/);
    // ...and service also returns collection -> both ends COMPATIBLE (no single/array mismatch).
    expect(svc!.content).toMatch(/Promise<RestaurantResponse\[\]>/);
  });

  /* ── ENUM DIKISI: entity (varchar) ↔ migration (VARCHAR + CHECK) ──────────
   * #56: eskiden entity @Column({type:"enum"}) ama migration TEXT -> tutarsiz. Karar
   * varchar+CHECK: hicbir entity native enum kolonu uretmez; migration enum kolonlarini
   * VARCHAR + CHECK ile kisitlar (CREATE TYPE yok). Fixture'da enum kolonlari var. */
  it("hicbir entity native enum kolonu (type:\"enum\") uretmez (#56 regresyonu)", () => {
    for (const f of tsFiles(files)) {
      if (!f.path.includes("/entities/")) continue;
      expect(f.content, `${f.path} carries native enum column`).not.toContain('type: "enum"');
    }
  });

  it("migration enum kolonlarini VARCHAR + CHECK ile kisitlar (CREATE TYPE yok)", () => {
    const allSql = files.filter((f) => f.language === "sql").map((f) => f.content).join("\n");
    // Native Postgres enum tipi uretilmez (diyagram evrilince migration kâbusu olmaz).
    expect(allSql).not.toContain("CREATE TYPE");
    // Fixture'da enum kolonu oldugundan en az bir CHECK ... IN (...) bulunmali.
    expect(allSql).toMatch(/CHECK \("[a-z_]+" IN \('/);
  });

  /* ── RBAC DIKISI: @Roles ↔ RolesGuard (#39) ──────────────────────────────
   * Eskiden @Roles metadata yaziliyordu ama OKUYAN guard yoktu (olu RBAC). Artik
   * gercek RolesGuard uretilir (ROLES_KEY'i Reflector ile okur) ve @Roles kullanan
   * her controller ayni route'a RolesGuard'i da baglar. Fixture'da roles-li endpoint var. */
  it("RolesGuard uretilir ve @Roles olan her controller'a wire edilir (olu RBAC degil)", () => {
    const guard = files.find((f) => f.path.endsWith("shared/guards/roles.guard.ts"));
    expect(guard, "roles.guard.ts was not generated").toBeDefined();
    expect(guard!.content).toContain("ROLES_KEY");
    expect(guard!.content).toContain("Reflector");
    // @Roles kullanan her controller, RolesGuard'i da import edip @UseGuards'a koymali.
    let checked = 0;
    for (const f of tsFiles(files)) {
      if (!f.path.endsWith(".controller.ts") || !f.content.includes("@Roles(")) continue;
      checked++;
      expect(f.content, `${f.path}: has @Roles but RolesGuard not wired`).toContain("RolesGuard");
    }
    expect(checked, "no controller using @Roles found in fixture").toBeGreaterThan(0);
  });

  /* ── CONTRACT-LINT: govde-alan write endpoint'i input DTO'su olmadan ──────
   * Emitter graf'ta RequestDTORef yoksa @Body uretmez (dogru); eksik kontrat
   * emitter'da uydurulmaz, codegen UYARISI olarak yuzeye cikar (canvas isaretler).
   * Fixture'da RequestDTORef'siz PATCH /{id}/status endpoint'leri var. */
  it("contract-lint: govdesiz write endpoint icin codegen warning uretilir (#@Body)", () => {
    const project = assembleRealisticProject();
    const bodyWarnings = project.warnings.filter((w) => /has no request body DTO/.test(w));
    expect(bodyWarnings.length, "expected body-less write endpoint warning").toBeGreaterThan(0);
  });

  /* ── STATE MACHINE DIKISI (L2): gecisli enum -> guard + servis grounding ──
   * Fixture'da OrderStatus.Transitions var -> enum dosyasi assert<Enum>Transition
   * guard'i icerir; UpdateStatus'lu OrderService bu guard'i import eder (AI fill'i
   * illegal durum gecisini reddetsin diye). */
  it("gecisli enum assert guard'i uretir + status servisi import eder (L2)", () => {
    const enumFile = files.find((f) => f.path.endsWith("order-status.enum.ts"));
    expect(enumFile, "order-status.enum.ts not found").toBeDefined();
    expect(enumFile!.content).toContain("ORDER_STATUS_TRANSITIONS");
    expect(enumFile!.content).toContain("export function assertOrderStatusTransition");
    const orderSvc = files.find((f) => f.path.endsWith("order/order.service.ts"));
    expect(orderSvc, "order.service.ts not found").toBeDefined();
    expect(orderSvc!.content).toContain("assertOrderStatusTransition");
  });
});
