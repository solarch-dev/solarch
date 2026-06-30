/* ────────────────────────────────────────────────────────────────────────
 * codegen.version.ts — SINGLE SOURCE for Constructor version.
 *
 * CODEGEN_VERSION increments +1 on each major (output/scaffold-changing) Constructor
 * improvement. Integer (not semver) — answers "which generation of Constructor
 * produced the code the user has".
 *
 *   v1 -> first major improvement when this file was added (legacy scaffold).
 *   v2 -> Architecture-aware feature layout + feature-module synthesis + entity synthesis
 *         + migration runner + service-spec scaffold.
 *   v3 -> v2 + SURGICAL_PLAN.md added (scans ALL markers after assembly,
 *         English prompt pasteable to AI).
 *   v4 -> Phase 4 DEEP-VALIDATION: real compile with realistic graphs +
 *         migration/boot verified. current-user.decorator synthesis (RequiresAuth /
 *         login endpoint resolves AuthUser/AuthResponse imports) + @OneToMany
 *         relations use definite-assignment "!" instead of array initializer (= [])
 *         (TypeORM InitializedRelationError fix -> migration/boot now passes).
 *   v5 -> previous (CURRENT at time). QUICK-WIN #2 + #7.
 *         #2 LIST-RETURN ALIGNMENT: when service method has raw ReturnType="XDto[]" + filled
 *         ReturnDtoRef, now PRESERVES raw Type's array/wrapper suffix
 *         (applyTypeWrapper) -> service returns Promise<XDto[]>, SAME signature as
 *         related controller (previously fell back to bare XDto when DtoRef set -> mismatch).
 *         #7 CROSS-FEATURE INFRA SINGLETON: Cache/ExternalService injected from multiple
 *         features (e.g. PaymentGateway) now lives in ONE OWNER feature's
 *         providers/exports; other injecting features import owner's module
 *         (dependsOn) -> ONE instance at boot (previously separate provider per injecting
 *         module -> multiple instances -> broken singleton).
 *         EXTRA (from boot validation): repository CustomQuery param/return types with
 *         generic SQL ENUM/JSON (no EnumRef) now normalize to string/Record<string, unknown>
 *         (scalarTsType) -> bare `ENUM`/`JSON` TS2304 fixed.
 *   v6 -> current (CURRENT). SELF-DOCUMENTING APP: controllers carry @ApiTags/
 *         @ApiOperation/@ApiResponse/@ApiBearerAuth, DTO fields @ApiProperty;
 *         main.ts sets up OpenAPI doc via @nestjs/swagger and interactive Scalar reference
 *         at /docs via @scalar/nestjs-api-reference. Separate DOCS_CORS_ORIGIN
 *         flag allows Scalar "try it" origin WITHOUT loosening prod CORS_ORIGIN.
 *         package.json adds @nestjs/swagger + @scalar/nestjs-api-reference.
 *
 * Stamping: after each successful POST /projects/:id/codegen, project node gets
 * codegenVersion = CODEGEN_VERSION. GET .../codegen/status compares stamp to
 * CURRENT (updateAvailable). GeneratedProject.summary.version is also
 * this constant -> every output tagged with its generation.
 * ──────────────────────────────────────────────────────────────────────── */

/** Current Constructor version (CURRENT). Single source — do not hardcode elsewhere. */
export const CODEGEN_VERSION = 6;
