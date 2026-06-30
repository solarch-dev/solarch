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

// Regression: AI agent kept getting ERR_NOT_WHITELISTED on every create_edge because grounding
// (ORPHAN_HINTS/STREAMING/prompt) made passive nodes the SOURCE — whitelist only accepts
// them as TARGET. These tests pin grounding direction to whitelist.
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
  ])("correct direction is legal: %s -%s-> %s", (s, e, t) => expect(isLegal(s, e, t)).toBe(true));

  it.each([
    ["DTO", "USES", "Controller"],
    ["Enum", "USES", "Table"],
    ["Exception", "THROWS", "Service"],
    ["EnvironmentVariable", "READS_CONFIG", "Service"],
    ["Cache", "CACHES_IN", "Service"],
  ])("reversed direction (old bug) is illegal: %s -%s-> %s", (s, e, t) => expect(isLegal(s, e, t)).toBe(false));
});

describe("system prompt grounding (agent-stuck regression)", () => {
  const p = buildSystemPrompt(emptyGraph as any);
  it("embeds the real whitelist matrix", () => {
    expect(p).toContain("LEGAL CONNECTIONS");
    expect(p).toContain("Controller:");
    expect(p).toContain("CALLS → Service");
  });
  it("names atomic tools instead of apply_architecture_graph", () => {
    expect(p).toContain("create_node");
    expect(p).toContain("create_edge");
    expect(p).not.toContain("apply_architecture_graph");
  });
});

describe("buildSystemPrompt patterns", () => {
  it("omits REFERENCE PATTERNS section when no patterns", () => {
    expect(buildSystemPrompt(emptyGraph as any)).not.toContain("REFERENCE PATTERNS");
  });

  it("injects name + score + structure when patterns present", () => {
    const hits = [
      {
        score: 0.88,
        pattern: {
          name: "Layered CRUD",
          description: "description",
          graph: { nodes: [{ tempId: "t", type: "Controller", properties: {} }], edges: [] },
        },
      },
    ];
    const p = buildSystemPrompt(emptyGraph as any, hits as any);
    expect(p).toContain("REFERENCE PATTERNS");
    expect(p).toContain("Layered CRUD");
    expect(p).toContain("0.88");
    expect(p).toContain("Controller");
  });
});
