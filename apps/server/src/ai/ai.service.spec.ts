import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictException } from "@nestjs/common";

// LLM factory mock — scriptli AIMessage dizisi (her invoke sıradakini döner).
// Error instance dönerse invoke throw eder (exception senaryosu).
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
    list: vi.fn(async () => [] as any[]), // contract-check için (varsayılan: boşluk yok)
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

const input = { message: "kur", history: [], mode: "agent" as const, continueRun: false };

describe("AiService.chatStreamAgent — orphan rollback", () => {
  beforeEach(() => { h.responses = []; h.idx = 0; h.onInvoke = null; h.sawContractCheck = false; });

  it("correction limit sonrası orphan node temizlenir, bağlı olanlar korunur", async () => {
    // turn1: A,B yarat · turn2: A→B edge + C(orphan) · turn3-5: tool yok (done + 2 correction)
    h.responses = [
      aiMsg([nodeCall("Service", { ServiceName: "A" }), nodeCall("Service", { ServiceName: "B" })]),
      aiMsg([edgeCall(A, B), nodeCall("Service", { ServiceName: "C" })]),
      aiMsg([]), aiMsg([]), aiMsg([], "bitti"),
    ];
    const { service, nodes } = makeService();
    const ev = await collect(service.chatStream(projectId, input));

    // C silindi (orphan), A/B silinmedi
    expect(nodes.delete).toHaveBeenCalledTimes(1);
    expect(nodes.delete).toHaveBeenCalledWith(projectId, C);
    const removed = ev.filter((e) => e.type === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].data.id).toBe(C);
    const done = ev.find((e) => e.type === "done");
    expect(done.counts.nodes).toBe(2); // A,B kaldı
  });

  it("exception'da o ana dek yaratılan orphan temizlenir + error event akar", async () => {
    h.responses = [aiMsg([nodeCall("Service", { ServiceName: "A" })]), new Error("llm patladı")];
    const { service, nodes } = makeService();
    const ev = await collect(service.chatStream(projectId, input));

    expect(nodes.delete).toHaveBeenCalledWith(projectId, A);
    expect(ev.some((e) => e.type === "removed" && e.data.id === A)).toBe(true);
    expect(ev.some((e) => e.type === "error" && e.code === "ERR_AI_GENERATION_FAILED")).toBe(true);
  });

  it("abort'ta rollback YOK (yarım graf kayıtlı kalır — mevcut sözleşme)", async () => {
    const ac = new AbortController();
    ac.abort(); // baştan iptal
    h.responses = [aiMsg([nodeCall("Service", { ServiceName: "A" })])];
    const { service, nodes } = makeService();
    const ev = await collect(service.chatStream(projectId, input, ac.signal));

    expect(nodes.delete).not.toHaveBeenCalled();
    expect(ev.some((e) => e.type === "removed")).toBe(false);
    expect(ev.some((e) => e.type === "error")).toBe(false); // sessiz return
  });

  it("adım limiti (MAX_TURNS) → paused event; orphan TEMİZLENMEZ ('Devam et' için korunur)", async () => {
    // Her tur geçerli node yarat (başarı → breaker tetiklenmez) + hiç durma →
    // MAX_TURNS'e (env default 120) kadar sürer → paused (error/done DEĞİL).
    let n = 0;
    h.responses = Array.from({ length: 130 }, () => aiMsg([nodeCall("Service", { ServiceName: "S" })]));
    const { service, nodes } = makeService();
    nodes.create.mockImplementation(async (_p: string, inp: any) => ({ id: "n" + n++, type: inp.type, properties: inp.properties }));
    const ev = await collect(service.chatStream(projectId, input));

    const paused = ev.find((e) => e.type === "paused");
    expect(paused).toBeTruthy();
    expect(paused.code).toBe("MAX_TURNS_REACHED");
    // ORPHAN TEMİZLENMEZ — kısmi mimari korunur, Devam et ile bağlanacak.
    expect(nodes.delete).not.toHaveBeenCalled();
    expect(ev.some((e) => e.type === "removed")).toBe(false);
    expect(ev.some((e) => e.type === "error")).toBe(false);
    expect(ev.some((e) => e.type === "done")).toBe(false);
  }, 20_000);

  it("devre kesici: tekrarlayan illegal edge MAX_TURNS'e kadar thrash etmez", async () => {
    // turn1: A,B yarat · turn2+: aynı A→B edge'i (illegal) 30 kez. Breaker olmadan
    // 30+ tur thrash ederdi; breaker ~8 ardışık başarısızlıkta durmalı.
    h.responses = [
      aiMsg([nodeCall("Service", { ServiceName: "A" }), nodeCall("Service", { ServiceName: "B" })]),
      ...Array.from({ length: 30 }, () => aiMsg([edgeCall(A, B)])),
    ];
    const { service, nodes, edges } = makeService();
    edges.create.mockRejectedValue(new ConflictException({ code: "ERR_NOT_WHITELISTED", message: "izinli değil" }));
    const ev = await collect(service.chatStream(projectId, input));

    // Erken durdu: 30 illegal turdan çok önce (A,B turu + ~8 ardışık başarısızlık).
    expect(h.idx).toBeLessThanOrEqual(10);
    // Aynı edge yalnız BİR kez DB'ye gitti; gerisi short-circuit (token tasarrufu).
    expect(edges.create).toHaveBeenCalledTimes(1);
    // Graceful done (ERR_MAX_TURNS error DEĞİL).
    const done = ev.find((e) => e.type === "done");
    expect(done).toBeTruthy();
    expect(done.message).toContain("violate the architecture rules");
    expect(ev.some((e) => e.type === "error" && e.code === "ERR_MAX_TURNS")).toBe(false);
    // A,B bağlanamadı → orphan temizlendi.
    expect(ev.filter((e) => e.type === "removed")).toHaveLength(2);
    expect(nodes.delete).toHaveBeenCalledTimes(2);
  });

  it("contract-check: gövde-alan endpoint input DTO'su olmadan -> LLM'e CONTRACT_CHECK geri bildirilir", async () => {
    // Diyagram-AI'ın ürettiği graf: bir Controller, POST endpoint'i RequestDTORef OLMADAN
    // (lintContracts Rule 1 boşluğu). LLM "done" deyince contract-check tetiklenip geri besler.
    const ctrlNode = {
      id: "c1", type: "Controller",
      properties: {
        ControllerName: "OrderController", Description: "sipariş", BaseRoute: "orders",
        Endpoints: [{ HttpMethod: "POST", Route: "/", RequiresAuth: false, RequiredRoles: [], PathParams: [], QueryParams: [], StatusCodes: [], MiddlewareRefs: [] }],
      },
    };
    // LLM hiç tool çağırmaz (hemen done) → orphan yok → contract-check; boşluk hep var (LLM düzeltmiyor sim.).
    h.responses = [aiMsg([], "bitti"), aiMsg([], "tekrar"), aiMsg([], "tamam")];
    const { service, nodes } = makeService();
    nodes.list.mockResolvedValue([ctrlNode] as any);
    await collect(service.chatStream(projectId, input));
    expect(h.sawContractCheck).toBe(true); // sözleşme boşluğu üretim-anında LLM'e bildirildi
  });

  it("contract-check: graf TAM (boşluk yok) -> CONTRACT_CHECK geri bildirimi YOK", async () => {
    h.responses = [aiMsg([], "bitti")];
    const { service } = makeService(); // nodes.list varsayılan [] -> boşluk yok
    await collect(service.chatStream(projectId, input));
    expect(h.sawContractCheck).toBe(false);
  });

  it("backend kapanırsa (Pool is closed) → anında dur, LLM düzeltme turu YOK, cleanup YOK", async () => {
    // turn1: A yarat (başarı) · turn2: B yarat → DB havuzu kapalı (hot-reload/SIGTERM).
    // Eski hata sınıflandırması bunu ERR_INTERNAL sayıp 8+ tur "düzelt" diye thrash ederdi.
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

    // Anında durdu: thrash yok (yalnız 2 LLM turu — A başarı + B kapalı havuz).
    expect(h.idx).toBeLessThanOrEqual(2);
    // Cleanup beyhude (havuz kapalı) → DENENMEZ; orphan-skipped duvarı basılmaz.
    expect(nodes.delete).not.toHaveBeenCalled();
    expect(ev.some((e) => e.type === "removed")).toBe(false);
    // Net terminal sinyal — ERR_INTERNAL/ERR_AI_GENERATION_FAILED değil.
    expect(ev.some((e) => e.type === "error" && e.code === "ERR_BACKEND_UNAVAILABLE")).toBe(true);
  });

  it("cleanup sırasında delete fırlatsa bile stream çökmeden error event akar", async () => {
    h.responses = [aiMsg([nodeCall("Service", { ServiceName: "A" })]), new Error("boom")];
    const { service, nodes } = makeService();
    nodes.delete.mockRejectedValueOnce(new Error("delete db hatası"));
    const ev = await collect(service.chatStream(projectId, input));
    // delete patladı ama error event yine de geldi (her delete kendi try/catch'inde)
    expect(ev.some((e) => e.type === "error" && e.code === "ERR_AI_GENERATION_FAILED")).toBe(true);
  });
});
