import { describe, it, expect } from "vitest";
import { emitSurgicalPlan } from "./surgical-plan.emitter";
import { buildCodeGraph } from "../../ir";
import { surgicalMarker, notImplemented } from "../../surgical";
import type { GeneratedFile } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";

/* ────────────────────────────────────────────────────────────────────────
 * surgical-plan.emitter.spec.ts — SURGICAL_PLAN.md dogrulamasi.
 *
 * (1) MD iki bolum + kapanis talimati icerir, Ingilizcedir.
 * (2) Uretilen .ts dosyalarindaki "@solarch:surgical" marker'lari taranir:
 *     dosya yolu + imza + throws/deps + "Implement: ..." maddesi listelenir.
 * (3) SAF + DETERMINISTIC: ayni girdi -> byte-identical MD.
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

/** Bir surgical metot govdesi iceren TS dosyasi (gercek emitter ciktisina benzer). */
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

/** Fixture graph: tek "users" feature'i (controller + service) -> feature listesi. */
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
  it("SURGICAL_PLAN.md uretir (kok yol, markdown, surgicalMarkers 0)", () => {
    const file = emitSurgicalPlan([], fixtureGraph());
    expect(file.path).toBe("SURGICAL_PLAN.md");
    expect(file.language).toBe("markdown");
    // MD prose marker ADINI anabilir ama bir surgical BODY degildir; emitter
    // surgicalMarkers'i 0'a sabitler -> aggregate surgicalMarkerCount bozulmaz.
    expect(file.surgicalMarkers).toBe(0);
    expect(file.content.endsWith("\n")).toBe(true);
  });

  it("iki bolum + kapanis talimati icerir (Ingilizce prompt)", () => {
    const file = emitSurgicalPlan([], fixtureGraph());
    expect(file.content).toContain("# Surgical Implementation Plan");
    expect(file.content).toContain("## 1. Codebase introduction");
    expect(file.content).toContain("## 2. Surgical implementation plan");
    expect(file.content).toContain("## Instructions");
    // Codebase tanitimi: NestJS + Solarch + mimari.
    expect(file.content).toContain("NestJS");
    expect(file.content).toContain("Solarch");
    expect(file.content).toContain("CoreModule");
    expect(file.content).toContain("shared/");
    // Kapanis: yalniz isaretli govdeleri doldur, yapiyi degistirme.
    expect(file.content).toContain("Do NOT change any signature");
    expect(file.content).toContain("Do NOT edit any other code");
    // English only (not Turkish) — pasted to user.
    const turkishChars = /[\u011F\u00FC\u015F\u0131\u00F6\u00E7\u011E\u00DC\u015E\u0130\u00D6\u00C7]/;
    expect(file.content).not.toMatch(turkishChars);
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

    // Dosyaya gore grupli baslik.
    expect(file.content).toContain("### `src/users/users.service.ts`");
    // Imza (marker'in ust satiri) listelenir.
    expect(file.content).toContain("`async create(dto: CreateUserDto): Promise<UserDto> {`");
    // Description -> Implement maddesi.
    expect(file.content).toContain("Implement: Create a new user and persist it.");
    // throws + deps.
    expect(file.content).toContain("Throws: UserNotFoundException");
    expect(file.content).toContain("Available dependencies: this.userRepository");
    // Sayac metni (1 govde).
    expect(file.content).toContain("**1** surgical method body");
  });

  it("cok-satirli imzayi (controller @Body) tek satira birlestirir", () => {
    // NestJS controller: imza @Body() parametresiyle birden multilinea yayilir,
    // marker'in hemen ustundeki satir yalniz KAPANISTIR (`): Promise<void> {`).
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
    // Imza tam: metot adi + parametreler + donus tipi tek satirda birlesir.
    expect(file.content).toContain("`async post( @Body() dto: CreateUserDto, ): Promise<void> {`");
    // Sadece kapanis parcasi ("): Promise<void> {") TEK BASINA listelenmemeli.
    expect(file.content).not.toContain("**`): Promise<void> {`**");
  });

  it("description NONESA notr Implement ipucu uretir", () => {
    const files = [tsFileWithMarker("src/users/users.service.ts", SVC, "list(): User[] {", "list")];
    const file = emitSurgicalPlan(files, fixtureGraph());
    expect(file.content).toContain("Implement: the body of `list`");
  });

  it("birden cok marker -> dosya/uye sirasinda deterministik gruplama", () => {
    const files: GeneratedFile[] = [
      tsFileWithMarker("src/users/user.repository.ts", "n2", "findByEmail(email: string): Promise<User> {", "findByEmail"),
      tsFileWithMarker("src/users/users.service.ts", SVC, "create(): void {", "create"),
    ];
    const file = emitSurgicalPlan(files, fixtureGraph());
    // Iki dosya da bolumlenir; sayim 2.
    expect(file.content).toContain("### `src/users/user.repository.ts`");
    expect(file.content).toContain("### `src/users/users.service.ts`");
    expect(file.content).toContain("**2** surgical method bodies");
  });

  it("marker yoksa: implement edilecek bir sey olmadigini bildirir", () => {
    const files = [
      { path: "src/main.ts", content: "console.log('x');\n", language: "typescript", surgicalMarkers: 0 } as GeneratedFile,
    ];
    const file = emitSurgicalPlan(files, fixtureGraph());
    expect(file.content).toContain("No `@solarch:surgical` markers were found");
    expect(file.content).toContain("**0** surgical method bodies");
  });

  it("SQL/JSON/markdown dosyalarini taramaz (yalniz typescript)", () => {
    const files: GeneratedFile[] = [
      { path: "migrations/001_create_users.sql", content: "-- @solarch:surgical id=x#y\n", language: "sql", surgicalMarkers: 0 },
      { path: "package.json", content: "{}\n", language: "json", surgicalMarkers: 0 },
    ];
    const file = emitSurgicalPlan(files, fixtureGraph());
    // SQL icindeki sahte marker taranmaz -> "nothing to implement".
    expect(file.content).toContain("No `@solarch:surgical` markers were found");
  });

  it("DETERMINISM: ayni girdi -> byte-identical MD", () => {
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
