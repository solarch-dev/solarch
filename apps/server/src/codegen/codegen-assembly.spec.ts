import { describe, it, expect } from "vitest";
import { assembleRealisticFixture, assembleRealisticProject } from "./__fixtures__/load";
import type { GeneratedFile } from "./types";

/* ────────────────────────────────────────────────────────────────────────
 * codegen-assembly.spec.ts — DİKİŞ DOĞRULAMA GEÇİDİ (hızlı katman, npm'siz).
 *
 * Gerçekçi bir graf (61 node / 82 edge — restaurant uygulaması) BİR KEZ assemble
 * edilir; çıktının üstünde EMITTER'LAR-ARASI tutarlılık (seam) invariant'ları
 * doğrulanır. Tek-emitter golden testleri bu dikiş hatalarını YAKALAYAMAZ (hatalar
 * emitter'ların ARASINDA yaşar); bu test onları yakalar.
 *
 * NEDEN tsc DEĞİL (burada): iki kök bug tsc-ile-iskelet'te GÖRÜNMEZ —
 *   - PK casing ({ Id: id }) `as FindOptionsWhere` cast'iyle gizli (iskelet derlenir),
 *   - kardinalite (tekil vs dizi) yalnız FILL sonrası patlar (iskelet gövdesi throw).
 * Bu yüzden bunlar YAPISAL seam-assertion'larıyla kilitlenir (deterministik, hızlı).
 * Bütün-proje tsc "compiles out of the box" garantisi AYRI geçittir
 * (codegen-tsc.gate.test.ts + `pnpm test:codegen-gate`).
 * ──────────────────────────────────────────────────────────────────────── */

const tsFiles = (files: GeneratedFile[]) => files.filter((f) => f.language === "typescript");

describe("codegen assembly seam (gerçekçi graf)", () => {
  const files = assembleRealisticFixture();

  it("assemble gerçekçi grafı üretir (feature dosyaları + migration'lar)", () => {
    expect(files.length).toBeGreaterThan(50);
    // Beklenen feature'lar üretildi (restaurant/order/... repository'leri).
    const repos = files.filter((f) => f.path.endsWith(".repository.ts"));
    expect(repos.length).toBeGreaterThanOrEqual(5);
  });

  /* ── PK DİKİŞİ: findById key'i entity property'siyle HİZALI ──────────────
   * Bug: graf PK'yı "Id" (büyük) verir; entity property tsPropName ile "id" olur;
   * repository ham "Id" kullanırsa findById var olmayan kolona sorgu atar (cast gizler,
   * runtime patlar). Fix sonrası HİÇBİR repo capital-first key kullanmamalı + her
   * findById key'i kendi entity'sinin PK property'siyle birebir eşleşmeli. */
  it("hiçbir repository findById'i capital-first PK key kullanmaz ({ Id: id } regresyonu)", () => {
    for (const f of tsFiles(files)) {
      // findById where: { Id: ... } gibi büyük-harfle başlayan key = casing dikiş hatası.
      expect(f.content, `${f.path} capital-first PK where key taşıyor`).not.toMatch(
        /where:\s*\{\s*[A-Z]/,
      );
    }
  });

  it("her repository findById key'i, eşlenen entity'nin PK property adıyla birebir eşleşir", () => {
    // Entity PK property adlarını (class -> pk) topla: @PrimaryGeneratedColumn'ı izleyen satır.
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
      if (!entity || !key || entity === "any") continue; // kayıp-entity edge-case'i atla
      const expected = pkByEntity.get(entity);
      if (!expected) continue; // sentetik/eşlenmemiş entity — bu testte atla
      expect(key, `${f.path}: findById key '${key}' != entity '${entity}' PK '${expected}'`).toBe(
        expected,
      );
    }
  });

  /* ── KARDİNALİTE DİKİŞİ: controller koleksiyon dönüşü ↔ service koleksiyon dönüşü
   * Bug: controller route'tan "koleksiyon" tahmin edip DTO[] basar ama service tekil
   * kalır -> fill sonrası `return result` (dizi) derlenmez. Fix sonrası koleksiyon
   * operasyonlarında her iki uç da DTO[] döner. Fixture'da RestaurantService.GetAll/
   * Search koleksiyondur (graf ReturnType:"array"); ikisi de RestaurantResponse[] olmalı. */
  it("koleksiyon service metotları DTO[] döner (RestaurantService GetAll/Search)", () => {
    const svc = files.find((f) => f.path.endsWith("restaurant/restaurant.service.ts"));
    expect(svc).toBeDefined();
    // NOT: GetById/Create/Update meşru olarak TEKİL RestaurantResponse döner — yani
    // tekil dönüşün VARLIĞI hata değil. Dikiş hatası, KOLEKSİYON operasyonunun (GetAll/
    // Search) tekil kalmasıydı; bu yüzden yalnız onların DTO[] döndüğünü doğrularız.
    expect(svc!.content).toMatch(/async GetAll\([^)]*\): Promise<RestaurantResponse\[\]>/);
    expect(svc!.content).toMatch(/async Search\([^)]*\): Promise<RestaurantResponse\[\]>/);
  });

  it("controller koleksiyon endpoint'i ile service AYNI DTO[] kardinalitesinde (dikiş hizalı)", () => {
    const ctrl = files.find((f) => f.path.endsWith("restaurant/restaurant.controller.ts"));
    const svc = files.find((f) => f.path.endsWith("restaurant/restaurant.service.ts"));
    expect(ctrl).toBeDefined();
    expect(svc).toBeDefined();
    // Controller en az bir koleksiyon dönüşü taşır...
    expect(ctrl!.content).toMatch(/Promise<RestaurantResponse\[\]>/);
    // ...ve service de koleksiyon döndürür -> iki uç UYUMLU (tekil/dizi uyumsuzluğu yok).
    expect(svc!.content).toMatch(/Promise<RestaurantResponse\[\]>/);
  });

  /* ── ENUM DİKİŞİ: entity (varchar) ↔ migration (VARCHAR + CHECK) ──────────
   * #56: eskiden entity @Column({type:"enum"}) ama migration TEXT -> tutarsız. Karar
   * varchar+CHECK: hiçbir entity native enum kolonu üretmez; migration enum kolonlarını
   * VARCHAR + CHECK ile kısıtlar (CREATE TYPE yok). Fixture'da enum kolonları var. */
  it("hiçbir entity native enum kolonu (type:\"enum\") üretmez (#56 regresyonu)", () => {
    for (const f of tsFiles(files)) {
      if (!f.path.includes("/entities/")) continue;
      expect(f.content, `${f.path} native enum kolonu taşıyor`).not.toContain('type: "enum"');
    }
  });

  it("migration enum kolonlarını VARCHAR + CHECK ile kısıtlar (CREATE TYPE yok)", () => {
    const allSql = files.filter((f) => f.language === "sql").map((f) => f.content).join("\n");
    // Native Postgres enum tipi üretilmez (diyagram evrilince migration kâbusu olmaz).
    expect(allSql).not.toContain("CREATE TYPE");
    // Fixture'da enum kolonu olduğundan en az bir CHECK ... IN (...) bulunmalı.
    expect(allSql).toMatch(/CHECK \("[a-z_]+" IN \('/);
  });

  /* ── RBAC DİKİŞİ: @Roles ↔ RolesGuard (#39) ──────────────────────────────
   * Eskiden @Roles metadata yazılıyordu ama OKUYAN guard yoktu (ölü RBAC). Artık
   * gerçek RolesGuard üretilir (ROLES_KEY'i Reflector ile okur) ve @Roles kullanan
   * her controller aynı route'a RolesGuard'ı da bağlar. Fixture'da roles-li endpoint var. */
  it("RolesGuard üretilir ve @Roles olan her controller'a wire edilir (ölü RBAC değil)", () => {
    const guard = files.find((f) => f.path.endsWith("shared/guards/roles.guard.ts"));
    expect(guard, "roles.guard.ts üretilmedi").toBeDefined();
    expect(guard!.content).toContain("ROLES_KEY");
    expect(guard!.content).toContain("Reflector");
    // @Roles kullanan her controller, RolesGuard'ı da import edip @UseGuards'a koymalı.
    let checked = 0;
    for (const f of tsFiles(files)) {
      if (!f.path.endsWith(".controller.ts") || !f.content.includes("@Roles(")) continue;
      checked++;
      expect(f.content, `${f.path}: @Roles var ama RolesGuard wire edilmemiş`).toContain("RolesGuard");
    }
    expect(checked, "fixture'da @Roles kullanan controller bulunmadı").toBeGreaterThan(0);
  });

  /* ── CONTRACT-LINT: gövde-alan write endpoint'i input DTO'su olmadan ──────
   * Emitter graf'ta RequestDTORef yoksa @Body üretmez (doğru); eksik kontrat
   * emitter'da uydurulmaz, codegen UYARISI olarak yüzeye çıkar (canvas işaretler).
   * Fixture'da RequestDTORef'siz PATCH /{id}/status endpoint'leri var. */
  it("contract-lint: gövdesiz write endpoint için codegen warning üretilir (#@Body)", () => {
    const project = assembleRealisticProject();
    const bodyWarnings = project.warnings.filter((w) => /has no request body DTO/.test(w));
    expect(bodyWarnings.length, "gövdesiz write endpoint uyarısı bekleniyordu").toBeGreaterThan(0);
  });

  /* ── STATE MACHINE DİKİŞİ (L2): geçişli enum -> guard + servis grounding ──
   * Fixture'da OrderStatus.Transitions var -> enum dosyası assert<Enum>Transition
   * guard'ı içerir; UpdateStatus'lu OrderService bu guard'ı import eder (AI fill'i
   * illegal durum geçişini reddetsin diye). */
  it("geçişli enum assert guard'ı üretir + status servisi import eder (L2)", () => {
    const enumFile = files.find((f) => f.path.endsWith("order-status.enum.ts"));
    expect(enumFile, "order-status.enum.ts bulunamadı").toBeDefined();
    expect(enumFile!.content).toContain("ORDER_STATUS_TRANSITIONS");
    expect(enumFile!.content).toContain("export function assertOrderStatusTransition");
    const orderSvc = files.find((f) => f.path.endsWith("order/order.service.ts"));
    expect(orderSvc, "order.service.ts bulunamadı").toBeDefined();
    expect(orderSvc!.content).toContain("assertOrderStatusTransition");
  });
});
