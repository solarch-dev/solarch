import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictException } from "@nestjs/common";

// LLM factory mock — scripted AIMessage queue (each invoke returns the next item).
// If an Error instance is returned, invoke throws (exception scenario).
const h = vi.hoisted(() => ({ responses: [] as any[], idx: 0, onInvoke: null as null | (() => void), sawContractCheck: false }));

vi.mock("./providers/llm.factory", () => ({
  isGenerationConfigured: () => true,
  getGenerationChat: () => ({
    bindTools: () => ({
      invoke: async (messages: any) => {
        h.onInvoke?.();
        for (const m of messages ?? []) {
          if (typeof m?.content === "string" && m.content.includes("CONTRACT_CHECK")) h.sawContractCheck = true;
        }
        const r = h.responses[h.idx] ?? { content: "", tool_calls: [] };
        h.idx++;
        if (r instanceof Error) throw r;
        return r;
      },
    }),
  }),
}));

import { AiService } from "./ai.service";

const projectId = "550e8400-e29b-41d4-a716-446655440001";
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";

const aiMsg = (toolCalls: any[] = [], content = "") => ({ content, tool_calls: toolCalls });
const nodeCall = (type: string, props: Record<string, unknown>) => ({ id: "tc", name: "create_node", args: { type, properties: props } });
const edgeCall = (s: string, t: string) => ({ id: "te", name: "create_edge", args: { sourceNodeId: s, targetNodeId: t, kind: "USES" } });

function makeService() {
  const ids = [A, B, C];
  let createIdx = 0;
  const nodes = {
    create: vi.fn(async (_p: string, input: any) => ({ id: ids[createIdx++], type: input.type, properties: input.properties })),
    delete: vi.fn(async () => true),
    list: vi.fn(async () => [] as any[]), // contract-check (default: no gaps)
  };
  const edges = {
    create: vi.fn(async (_p: string, input: any) => ({ id: "edge-1", sourceNodeId: input.sourceNodeId, targetNodeId: input.targetNodeId, kind: input.kind, properties: input.properties })),
    list: vi.fn(async () => [] as any[]),
  };
  const projectsRepo = { exists: vi.fn(async () => true), getGraph: vi.fn(async () => ({ nodes: [], edges: [] })) };
  const patterns = { search: vi.fn(async () => []) };
  const tabs = { ensureDefault: vi.fn(async () => ({ id: "tab-1" })) };
  const service = new AiService(projectsRepo as any, {} as any, patterns as any, nodes as any, edges as any, tabs as any);
  return { service, nodes, edges };
}

async function collect(gen: AsyncGenerator<any>) {
  const out: any[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const input = { message: "build", history: [], mode: "agent" as const, continueRun: false };

describe("AiService.chatStreamAgent — orphan rollback", () => {
  beforeEach(() => { h.responses = []; h.idx = 0; h.onInvoke = null; h.sawContractCheck = false; });

  it("after correction limit orphan node is removed, connected ones preserved", async () => {
    // turn1: create A,B · turn2: A→B edge + C(orphan) · turn3-5: no tools (done + 2 corrections)
    h.responses = [
      aiMsg([nodeCall("Service", { ServiceName: "A" }), nodeCall("Service", { ServiceName: "B" })]),
      aiMsg([edgeCall(A, B), nodeCall("Service", { ServiceName: "C" })]),
      aiMsg([]), aiMsg([]), aiMsg([], "done"),
    ];
    const { service, nodes } = makeService();
    const ev = await collect(service.chatStream(projectId, input));

    // C deleted (orphan), A/B kept
    expect(nodes.delete).toHaveBeenCalledTimes(1);
    expect(nodes.delete).toHaveBeenCalledWith(projectId, C);
    const removed = ev.filter((e) => e.type === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].data.id).toBe(C);
    const done = ev.find((e) => e.type === "done");
    expect(done.counts.nodes).toBe(2); // A,B remain
  });

  it("on exception, orphan created so far is cleaned up + error event flows", async () => {
    h.responses = [aiMsg([nodeCall("Service", { ServiceName: "A" })]), new Error("llm crashed")];
    const { service, nodes } = makeService();
    const ev = await collect(service.chatStream(projectId, input));

    expect(nodes.delete).toHaveBeenCalledWith(projectId, A);
    expect(ev.some((e) => e.type === "removed" && e.data.id === A)).toBe(true);
    expect(ev.some((e) => e.type === "error" && e.code === "ERR_AI_GENERATION_FAILED")).toBe(true);
  });

  it("on abort no rollback (partial graph stays saved — current contract)", async () => {
    const ac = new AbortController();
    ac.abort(); // cancel from the start
    h.responses = [aiMsg([nodeCall("Service", { ServiceName: "A" })])];
    const { service, nodes } = makeService();
    const ev = await collect(service.chatStream(projectId, input, ac.signal));

    expect(nodes.delete).not.toHaveBeenCalled();
    expect(ev.some((e) => e.type === "removed")).toBe(false);
    expect(ev.some((e) => e.type === "error")).toBe(false); // silent return
  });

  it("step limit (MAX_TURNS) → paused event; orphan NOT cleaned (preserved for Continue)", async () => {
    // Each turn creates a valid node (success → breaker not triggered) + never stops →
    // runs until MAX_TURNS (env default 120) → paused (not error/done).
    let n = 0;
    h.responses = Array.from({ length: 130 }, () => aiMsg([nodeCall("Service", { ServiceName: "S" })]));
    const { service, nodes } = makeService();
    nodes.create.mockImplementation(async (_p: string, inp: any) => ({ id: "n" + n++, type: inp.type, properties: inp.properties }));
    const ev = await collect(service.chatStream(projectId, input));

    const paused = ev.find((e) => e.type === "paused");
    expect(paused).toBeTruthy();
    expect(paused.code).toBe("MAX_TURNS_REACHED");
    // Orphan NOT cleaned — partial architecture preserved for Continue.
    expect(nodes.delete).not.toHaveBeenCalled();
    expect(ev.some((e) => e.type === "removed")).toBe(false);
    expect(ev.some((e) => e.type === "error")).toBe(false);
    expect(ev.some((e) => e.type === "done")).toBe(false);
  }, 20_000);

  it("circuit breaker: repeated illegal edge does not thrash until MAX_TURNS", async () => {
    // turn1: create A,B · turn2+: same A→B edge (illegal) 30 times. Without breaker
    // would thrash 30+ turns; breaker should stop after ~8 consecutive failures.
    h.responses = [
      aiMsg([nodeCall("Service", { ServiceName: "A" }), nodeCall("Service", { ServiceName: "B" })]),
      ...Array.from({ length: 30 }, () => aiMsg([edgeCall(A, B)])),
    ];
    const { service, nodes, edges } = makeService();
    edges.create.mockRejectedValue(new ConflictException({ code: "ERR_NOT_WHITELISTED", message: "not allowed" }));
    const ev = await collect(service.chatStream(projectId, input));

    // Stopped early: well before 30 illegal turns (A,B turn + ~8 consecutive failures).
    expect(h.idx).toBeLessThanOrEqual(10);
    // Same edge hit DB only ONCE; rest short-circuited (token savings).
    expect(edges.create).toHaveBeenCalledTimes(1);
    // Graceful done (not ERR_MAX_TURNS error).
    const done = ev.find((e) => e.type === "done");
    expect(done).toBeTruthy();
    expect(done.message).toContain("violate the architecture rules");
    expect(ev.some((e) => e.type === "error" && e.code === "ERR_MAX_TURNS")).toBe(false);
    // A,B could not connect → orphans cleaned up.
    expect(ev.filter((e) => e.type === "removed")).toHaveLength(2);
    expect(nodes.delete).toHaveBeenCalledTimes(2);
  });

  it("contract-check: body-field endpoint without input DTO → CONTRACT_CHECK fed back to LLM", async () => {
    // Graph produced by diagram-AI: Controller with POST endpoint without RequestDTORef
    // (lintContracts Rule 1 gap). When LLM says "done", contract-check triggers feedback.
    const ctrlNode = {
      id: "c1", type: "Controller",
      properties: {
        ControllerName: "OrderController", Description: "order", BaseRoute: "orders",
        Endpoints: [{ HttpMethod: "POST", Route: "/", RequiresAuth: false, RequiredRoles: [], PathParams: [], QueryParams: [], StatusCodes: [], MiddlewareRefs: [] }],
      },
    };
    // LLM calls no tools (immediate done) → no orphan → contract-check; gap always present (LLM does not fix in sim).
    h.responses = [aiMsg([], "done"), aiMsg([], "retry"), aiMsg([], "done")];
    const { service, nodes } = makeService();
    nodes.list.mockResolvedValue([ctrlNode] as any);
    await collect(service.chatStream(projectId, input));
    expect(h.sawContractCheck).toBe(true); // contract gap reported to LLM at generation time
  });

  it("contract-check: graph complete (no gaps) → no CONTRACT_CHECK feedback", async () => {
    h.responses = [aiMsg([], "done")];
    const { service } = makeService(); // nodes.list default [] → no gaps
    await collect(service.chatStream(projectId, input));
    expect(h.sawContractCheck).toBe(false);
  });

  it("if backend closes (Pool is closed) → stop immediately, no LLM correction turn, no cleanup", async () => {
    // turn1: create A (success) · turn2: create B → DB pool closed (hot-reload/SIGTERM).
    // Old error classification would treat as ERR_INTERNAL and thrash 8+ "fix" turns.
    h.responses = [
      aiMsg([nodeCall("Service", { ServiceName: "A" })]),
      ...Array.from({ length: 20 }, () => aiMsg([nodeCall("Service", { ServiceName: "B" })])),
    ];
    const { service, nodes } = makeService();
    let call = 0;
    nodes.create.mockImplementation(async (_p: string, inp: any) => {
      call++;
      if (call >= 2) throw new Error("Pool is closed, it is no more able to serve requests.");
      return { id: A, type: inp.type, properties: inp.properties };
    });
    const ev = await collect(service.chatStream(projectId, input));

    // Stopped immediately: no thrash (only 2 LLM turns — A success + B closed pool).
    expect(h.idx).toBeLessThanOrEqual(2);
    // Cleanup futile (pool closed) → NOT attempted.
    expect(nodes.delete).not.toHaveBeenCalled();
    expect(ev.some((e) => e.type === "removed")).toBe(false);
    // Clear terminal signal — not ERR_INTERNAL/ERR_AI_GENERATION_FAILED.
    expect(ev.some((e) => e.type === "error" && e.code === "ERR_BACKEND_UNAVAILABLE")).toBe(true);
  });

  it("if delete throws during cleanup stream still emits error event without crashing", async () => {
    h.responses = [aiMsg([nodeCall("Service", { ServiceName: "A" })]), new Error("boom")];
    const { service, nodes } = makeService();
    nodes.delete.mockRejectedValueOnce(new Error("delete db error"));
    const ev = await collect(service.chatStream(projectId, input));
    // delete failed but error event still arrived (each delete in its own try/catch)
    expect(ev.some((e) => e.type === "error" && e.code === "ERR_AI_GENERATION_FAILED")).toBe(true);
  });
});
