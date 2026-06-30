import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt";
import { WHITELIST } from "../../rules/registry/whitelist";

const emptyGraph = { project: {} as any, nodes: [], edges: [], counts: { nodes: 0, edges: 0 } };

function isLegal(source: string, edge: string, target: string): boolean {
  return WHITELIST.some((r) => {
    const ss = Array.isArray(r.source) ? r.source : [r.source];
    const tt = Array.isArray(r.target) ? r.target : [r.target];
    return ss.includes(source as never) && r.edge === edge && tt.includes(target as never);
  });
}

// Regresyon: AI ajanı her create_edge'de ERR_NOT_WHITELISTED alıyordu çünkü grounding
// (ORPHAN_HINTS/STREAMING/prompt) pasif node'ları KAYNAK yaptırıyordu — whitelist ise
// onları yalnız HEDEF kabul ediyor. Bu testler grounding'in yönünü whitelist'e pinler.
describe("AI grounding direction == whitelist (agent-stuck regression)", () => {
  it.each([
    ["Controller", "USES", "DTO"],
    ["Service", "USES", "DTO"],
    ["Model", "USES", "Enum"],
    ["Service", "THROWS", "Exception"],
    ["Service", "READS_CONFIG", "EnvironmentVariable"],
    ["Service", "CACHES_IN", "Cache"],
    ["Repository", "QUERIES", "View"],
    ["FrontendApp", "HAS", "UIComponent"],
    ["Middleware", "ROUTES_TO", "Controller"],
    ["Service", "CALLS", "Repository"],
  ])("DOĞRU yön legal: %s -%s-> %s", (s, e, t) => expect(isLegal(s, e, t)).toBe(true));

  it.each([
    ["DTO", "USES", "Controller"],
    ["Enum", "USES", "Table"],
    ["Exception", "THROWS", "Service"],
    ["EnvironmentVariable", "READS_CONFIG", "Service"],
    ["Cache", "CACHES_IN", "Service"],
  ])("TERS yön (eski bug) illegal: %s -%s-> %s", (s, e, t) => expect(isLegal(s, e, t)).toBe(false));
});

describe("system prompt grounding (agent-stuck regression)", () => {
  const p = buildSystemPrompt(emptyGraph as any);
  it("gerçek whitelist matrisini gömer", () => {
    expect(p).toContain("YASAL BAĞLANTILAR");
    expect(p).toContain("Controller:");
    expect(p).toContain("CALLS → Service");
  });
  it("bağlı OLMAYAN apply_architecture_graph yerine atomic araçları söyler", () => {
    expect(p).toContain("create_node");
    expect(p).toContain("create_edge");
    expect(p).not.toContain("apply_architecture_graph");
  });
});

describe("buildSystemPrompt patterns", () => {
  it("pattern yoksa REFERANS DESENLER bölümü yok", () => {
    expect(buildSystemPrompt(emptyGraph as any)).not.toContain("REFERANS DESENLER");
  });

  it("pattern varsa isim + skor + yapı enjekte eder", () => {
    const hits = [
      {
        score: 0.88,
        pattern: {
          name: "Katmanlı CRUD",
          description: "açıklama",
          graph: { nodes: [{ tempId: "t", type: "Controller", properties: {} }], edges: [] },
        },
      },
    ];
    const p = buildSystemPrompt(emptyGraph as any, hits as any);
    expect(p).toContain("REFERANS DESENLER");
    expect(p).toContain("Katmanlı CRUD");
    expect(p).toContain("0.88");
    expect(p).toContain("Controller");
  });
});
