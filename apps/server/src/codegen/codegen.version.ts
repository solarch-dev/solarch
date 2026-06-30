/* ────────────────────────────────────────────────────────────────────────
 * codegen.version.ts — Constructor sürümünün TEK KAYNAĞI.
 *
 * CODEGEN_VERSION her büyük (çıktıyı/iskeleti değiştiren) Constructor iyileştirmesinde
 * +1 artar. Tam sayıdır (semver değil) — "kullanıcının elindeki kod hangi nesil
 * Constructor'dan üretildi" sorusunu yanıtlar.
 *
 *   v1 -> bu dosyanın eklendiği büyük iyileştirme ÖNCESİ (eski iskelet).
 *   v2 -> Mimari-farkında feature layout + feature-module sentezi + entity sentezi
 *         + migration runner + service-spec iskeleti.
 *   v3 -> v2 + SURGICAL_PLAN.md eklendi (montaj sonrası TÜM marker'ları tarayan,
 *         AI'a yapıştırılabilen İngilizce prompt).
 *   v4 -> Faz 4 DERİN-DOĞRULUK: gerçekçi grafla gerçek derleme +
 *         migration/boot doğrulandı. current-user.decorator sentezi (RequiresAuth /
 *         login endpoint AuthUser/AuthResponse import'larını çözer) + @OneToMany
 *         ilişkilerinde dizi initializer'ı (= []) yerine definite-assignment "!"
 *         (TypeORM InitializedRelationError düzeltmesi -> migration/boot artık geçer).
 *   v5 -> mevcut (CURRENT). HIZLI-KAZANIM #2 + #7.
 *         #2 LİSTE-DÖNÜŞ HİZASI: service metodu ham ReturnType="XDto[]" + ReturnDtoRef
 *         dolu olduğunda artık ham Type'ın dizi/sarmalayıcı son-ekini KORUR
 *         (applyTypeWrapper) -> service Promise<XDto[]> döner, ilgili controller ile
 *         AYNI imza (eskiden DtoRef varsa çıplak XDto'ya düşüyordu -> uyumsuz).
 *         #7 CROSS-FEATURE INFRA SINGLETON: çoklu feature'ca enjekte edilen bir
 *         Cache/ExternalService (ör. PaymentGateway) artık TEK SAHİP feature'ın
 *         providers/exports'unda; diğer enjekte eden feature'lar sahibin module'ünü
 *         import eder (dependsOn) -> bootta TEK örnek (eskiden her enjekte eden
 *         module'de ayrı provider -> çoklu örnek -> singleton kırık).
 *         EK (boot doğrulamasında çıkan): repository CustomQuery param/return tipinde
 *         generic SQL ENUM/JSON (EnumRef'siz) artık string/Record<string, unknown>'a
 *         normalize edilir (scalarTsType) -> bare `ENUM`/`JSON` TS2304'ü giderildi.
 *   v6 -> mevcut (CURRENT). KENDİNİ-BELGELEYEN UYGULAMA: controller'lar @ApiTags/
 *         @ApiOperation/@ApiResponse/@ApiBearerAuth, DTO alanları @ApiProperty taşır;
 *         main.ts @nestjs/swagger ile OpenAPI dokümanı kurar ve @scalar/nestjs-api-reference
 *         ile /docs altında interaktif Scalar referansı sunar. Ayrı DOCS_CORS_ORIGIN
 *         bayrağı, Scalar "try it" origin'ine prod CORS_ORIGIN'i GEVŞETMEDEN izin verir.
 *         package.json'a @nestjs/swagger + @scalar/nestjs-api-reference eklendi.
 *
 * Damgalama: başarılı her POST /projects/:id/codegen sonrası proje node'una
 * codegenVersion = CODEGEN_VERSION yazılır. GET .../codegen/status bu damgayı
 * CURRENT ile kıyaslar (updateAvailable). GeneratedProject.summary.version da
 * bu sabittir -> üretilen her çıktı kendi nesli ile etiketlenir.
 * ──────────────────────────────────────────────────────────────────────── */

/** Mevcut Constructor sürümü (CURRENT). Tek kaynak — başka yerde sabit yazma. */
export const CODEGEN_VERSION = 6;
