import { describe, it, expect } from "vitest";
import { emitSurgicalPlan } from "./surgical-plan.emitter";
import { buildCodeGraph } from "../../ir";
import { surgicalMarker, notImplemented } from "../../surgical";
import type { GeneratedFile } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";

/* ────────────────────────────────────────────────────────────────────────
 * surgical-plan.emitter.spec.ts — SURGICAL_PLAN.md doğrulaması.
 *
 * (1) MD iki bölüm + kapanış talimatı içerir, İngilizcedir.
 * (2) Üretilen .ts dosyalarındaki "@solarch:surgical" marker'ları taranır:
 *     dosya yolu + imza + throws/deps + "Implement: ..." maddesi listelenir.
 * (3) SAF + DETERMİNİSTİK: aynı girdi -> byte-identical MD.
 * ──────────────────────────────────────────────────────────────────────── */

const PROJECT = "00000000-0000-4000-8000-000000000000";
const TAB = "22222222-2222-4222-8222-222222222222";

function node(type: StoredNode["type"], id: string, properties: Record<string, unknown>): StoredNode {
  return {
    id,
    type,
    projectId: PROJECT,
    positionX: 0,
    positionY: 0,
    homeTabId: TAB,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    properties,
  };
}

/** Bir surgical metot gövdesi içeren TS dosyası (gerçek emitter çıktısına benzer). */
function tsFileWithMarker(
  path: string,
  nodeId: string,
  signature: string,
  member: string,
  opts: { description?: string; throws?: string[]; deps?: string[] } = {},
): GeneratedFile {
  const marker = surgicalMarker({ nodeId, member, ...opts });
  const lines: string[] = [];
  lines.push("@Injectable()");
  lines.push("export class Demo {");
  lines.push(`  ${signature}`);
  for (const ml of marker.split("\n")) lines.push(`    ${ml}`);
  lines.push(`    ${notImplemented("Demo", member)}`);
  lines.push("  }");
  lines.push("}");
  const content = lines.join("\n") + "\n";
  return {
    path,
    content,
    language: "typescript",
    surgicalMarkers: (content.match(/@solarch:surgical/g) ?? []).length,
  };
}

const SVC = "10000000-0000-4000-8000-000000000001";

/** Fixture graph: tek "users" feature'ı (controller + service) -> feature listesi. */
function fixtureGraph() {
  const svc = node("Service", SVC, { ServiceName: "UsersService", Description: "x", Methods: [], Dependencies: [] });
  const ctrl = node("Controller", "10000000-0000-4000-8000-000000000002", {
    ControllerName: "UsersController",
    Description: "x",
    BaseRoute: "users",
    Endpoints: [],
  });
  return buildCodeGraph([svc, ctrl], []);
}

describe("emitSurgicalPlan", () => {
  it("SURGICAL_PLAN.md üretir (kök yol, markdown, surgicalMarkers 0)", () => {
    const file = emitSurgicalPlan([], fixtureGraph());
    expect(file.path).toBe("SURGICAL_PLAN.md");
    expect(file.language).toBe("markdown");
    // MD prose marker ADINI anabilir ama bir surgical GÖVDE değildir; emitter
    // surgicalMarkers'ı 0'a sabitler -> aggregate surgicalMarkerCount bozulmaz.
    expect(file.surgicalMarkers).toBe(0);
    expect(file.content.endsWith("\n")).toBe(true);
  });

  it("iki bölüm + kapanış talimatı içerir (İngilizce prompt)", () => {
    const file = emitSurgicalPlan([], fixtureGraph());
    expect(file.content).toContain("# Surgical Implementation Plan");
    expect(file.content).toContain("## 1. Codebase introduction");
    expect(file.content).toContain("## 2. Surgical implementation plan");
    expect(file.content).toContain("## Instructions");
    // Codebase tanıtımı: NestJS + Solarch + mimari.
    expect(file.content).toContain("NestJS");
    expect(file.content).toContain("Solarch");
    expect(file.content).toContain("CoreModule");
    expect(file.content).toContain("shared/");
    // Kapanış: yalnız işaretli gövdeleri doldur, yapıyı değiştirme.
    expect(file.content).toContain("Do NOT change any signature");
    expect(file.content).toContain("Do NOT edit any other code");
    // İngilizce (Türkçe değil) — kullanıcıya yapıştırılır.
    expect(file.content).not.toMatch(/Yalnız|gövde|değiştirme/);
  });

  it("feature listesini graph'tan kurar", () => {
    const file = emitSurgicalPlan([], fixtureGraph());
    expect(file.content).toContain("Features (1)");
    expect(file.content).toContain("`users`");
  });

  it("marker tarar: dosya yolu + imza + Implement + throws + deps listelenir", () => {
    const files = [
      tsFileWithMarker(
        "src/users/users.service.ts",
        SVC,
        "async create(dto: CreateUserDto): Promise<UserDto> {",
        "create",
        {
          description: "Create a new user and persist it.",
          throws: ["UserNotFoundException"],
          deps: ["this.userRepository"],
        },
      ),
    ];
    const file = emitSurgicalPlan(files, fixtureGraph());

    // Dosyaya göre grupli başlık.
    expect(file.content).toContain("### `src/users/users.service.ts`");
    // İmza (marker'ın üst satırı) listelenir.
    expect(file.content).toContain("`async create(dto: CreateUserDto): Promise<UserDto> {`");
    // Description -> Implement maddesi.
    expect(file.content).toContain("Implement: Create a new user and persist it.");
    // throws + deps.
    expect(file.content).toContain("Throws: UserNotFoundException");
    expect(file.content).toContain("Available dependencies: this.userRepository");
    // Sayaç metni (1 gövde).
    expect(file.content).toContain("**1** surgical method body");
  });

  it("çok-satırlı imzayı (controller @Body) tek satıra birleştirir", () => {
    // NestJS controller: imza @Body() parametresiyle birden çok satıra yayılır,
    // marker'ın hemen üstündeki satır yalnız KAPANIŞTIR (`): Promise<void> {`).
    const content =
      [
        "@Controller()",
        "export class UsersController {",
        "  @Post()",
        "  async post(",
        "    @Body() dto: CreateUserDto,",
        "  ): Promise<void> {",
        "    // @solarch:surgical id=n1#post",
        "    // Handles the POST / endpoint.",
        '    throw new Error("NOT_IMPLEMENTED: UsersController.post");',
        "  }",
        "}",
      ].join("\n") + "\n";
    const files: GeneratedFile[] = [
      { path: "src/users/users.controller.ts", content, language: "typescript", surgicalMarkers: 1 },
    ];
    const file = emitSurgicalPlan(files, fixtureGraph());
    // İmza tam: metot adı + parametreler + dönüş tipi tek satırda birleşir.
    expect(file.content).toContain("`async post( @Body() dto: CreateUserDto, ): Promise<void> {`");
    // Sadece kapanış parçası ("): Promise<void> {") TEK BAŞINA listelenmemeli.
    expect(file.content).not.toContain("**`): Promise<void> {`**");
  });

  it("description YOKSA nötr Implement ipucu üretir", () => {
    const files = [tsFileWithMarker("src/users/users.service.ts", SVC, "list(): User[] {", "list")];
    const file = emitSurgicalPlan(files, fixtureGraph());
    expect(file.content).toContain("Implement: the body of `list`");
  });

  it("birden çok marker -> dosya/üye sırasında deterministik gruplama", () => {
    const files: GeneratedFile[] = [
      tsFileWithMarker("src/users/user.repository.ts", "n2", "findByEmail(email: string): Promise<User> {", "findByEmail"),
      tsFileWithMarker("src/users/users.service.ts", SVC, "create(): void {", "create"),
    ];
    const file = emitSurgicalPlan(files, fixtureGraph());
    // İki dosya da bölümlenir; sayım 2.
    expect(file.content).toContain("### `src/users/user.repository.ts`");
    expect(file.content).toContain("### `src/users/users.service.ts`");
    expect(file.content).toContain("**2** surgical method bodies");
  });

  it("marker yoksa: implement edilecek bir şey olmadığını bildirir", () => {
    const files = [
      { path: "src/main.ts", content: "console.log('x');\n", language: "typescript", surgicalMarkers: 0 } as GeneratedFile,
    ];
    const file = emitSurgicalPlan(files, fixtureGraph());
    expect(file.content).toContain("No `@solarch:surgical` markers were found");
    expect(file.content).toContain("**0** surgical method bodies");
  });

  it("SQL/JSON/markdown dosyalarını taramaz (yalnız typescript)", () => {
    const files: GeneratedFile[] = [
      { path: "migrations/001_create_users.sql", content: "-- @solarch:surgical id=x#y\n", language: "sql", surgicalMarkers: 0 },
      { path: "package.json", content: "{}\n", language: "json", surgicalMarkers: 0 },
    ];
    const file = emitSurgicalPlan(files, fixtureGraph());
    // SQL içindeki sahte marker taranmaz -> "nothing to implement".
    expect(file.content).toContain("No `@solarch:surgical` markers were found");
  });

  it("DETERMİNİZM: aynı girdi -> byte-identical MD", () => {
    const build = () =>
      emitSurgicalPlan(
        [
          tsFileWithMarker("src/users/users.service.ts", SVC, "create(): void {", "create", {
            description: "do it",
            deps: ["this.repo"],
          }),
        ],
        fixtureGraph(),
      ).content;
    expect(build()).toBe(build());
  });
});
