import { HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { SystemMessage, HumanMessage, AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { ProjectsRepository } from "../projects/projects.repository";
import { GraphService } from "../graph/graph.service";
import { PatternsService } from "../patterns/patterns.service";
import { NodesService } from "../nodes/nodes.service";
import { EdgesService } from "../edges/edges.service";
import { TabsService } from "../tabs/tabs.service";
import type { PatternSearchHit } from "../patterns/patterns.repository";
import type { NodeKind } from "../nodes/schemas";
import type { EdgeKind } from "../edges/schemas/edge.schema";
import { buildCodeGraph } from "../codegen/ir";
import { lintContracts } from "../codegen/contract-lint";
import type { StoredNode } from "../nodes/nodes.repository";
import type { StoredEdge } from "../edges/edges.repository";
import { env } from "../config/env";
import { getGenerationChat, isGenerationConfigured } from "./providers/llm.factory";
import { buildSystemPrompt } from "./prompts/system-prompt";
import { ApplyArchitectureArgsSchema } from "./tools/apply-architecture-graph.tool";
import {
  CREATE_NODE_TOOL_NAME,
  CREATE_NODE_DESCRIPTION,
  CreateNodeArgsSchema,
} from "./tools/create-node.tool";
import {
  CREATE_EDGE_TOOL_NAME,
  CREATE_EDGE_DESCRIPTION,
  CreateEdgeArgsSchema,
} from "./tools/create-edge.tool";
import { GET_NODE_TOOL_NAME, GET_NODE_DESCRIPTION, GetNodeArgsSchema } from "./tools/get-node.tool";
import { UPDATE_NODE_TOOL_NAME, UPDATE_NODE_DESCRIPTION, UpdateNodeArgsSchema } from "./tools/update-node.tool";
import { DELETE_NODE_TOOL_NAME, DELETE_NODE_DESCRIPTION, DeleteNodeArgsSchema } from "./tools/delete-node.tool";
import { DELETE_EDGE_TOOL_NAME, DELETE_EDGE_DESCRIPTION, DeleteEdgeArgsSchema } from "./tools/delete-edge.tool";
import type { ChatInput } from "./dto/chat.dto";
import type { ChatResult, StreamEvent } from "./dto/chat-response.dto";

const MAX_ATTEMPTS = 5;

/** Structured output şeması — apply girdisi ({nodes, edges}) + Türkçe özet. */
const GenerationSchema = z.object({
  summary: z.string().optional(),
  nodes: ApplyArchitectureArgsSchema.shape.nodes,
  edges: ApplyArchitectureArgsSchema.shape.edges.default([]),
});
type Generation = z.infer<typeof GenerationSchema>;

function textOf(msg: AIMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.map((c) => (typeof c === "string" ? c : "text" in c ? (c as any).text : "")).join("");
  }
  return "";
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** json_object çıktısından ilk geçerli JSON nesnesini ayıkla (markdown fence vb. tolere et). */
function extractJson(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return start >= 0 && end > start ? t.slice(start, end + 1) : t;
}

/** json mode: tool YOK → şemayı prompt'a göm + 'json' kelimesi (DeepSeek şartı). */
const JSON_DIRECTIVE = `

## ÇIKTI BİÇİMİ (ZORUNLU)
Bu modda fonksiyon/tool YOKTUR. Yanıtını SADECE geçerli JSON olarak ver (markdown, backtick, ek açıklama YOK). JSON şeması:
{
  "summary": "short summary (respond in English — the product UI is English)",
  "nodes": [{ "tempId": "temp_x", "type": "Controller", "properties": { ... } }],
  "edges": [{ "sourceTempId": "temp_x", "targetTempId": "temp_y", "edgeType": "CALLS", "label": "opsiyonel" }]
}
Her node tempId taşımalı; edge'ler bu tempId'leri referanslar.`;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly projectsRepo: ProjectsRepository,
    private readonly graphService: GraphService,
    private readonly patterns: PatternsService,
    private readonly nodes: NodesService,
    private readonly edges: EdgesService,
    private readonly tabs: TabsService,
  ) {}

  async chat(projectId: string, input: ChatInput): Promise<ChatResult> {
    if (!isGenerationConfigured()) {
      throw new ServiceUnavailableException({
        code: "ERR_AI_NOT_CONFIGURED",
        message: "AI agent is not configured (BEDROCK_API_KEY / DEEPSEEK_API_KEY missing).",
      });
    }
    if (!(await this.projectsRepo.exists(projectId))) {
      throw new NotFoundException({ code: "ERR_PROJECT_NOT_FOUND", message: `Project '${projectId}' not found.` });
    }

    const { nodes, edges } = await this.projectsRepo.getGraph(projectId);

    // GraphRAG: en yakın kanonik desenleri getir (embedding yoksa degrade → boş).
    let patternHits: PatternSearchHit[] = [];
    try {
      patternHits = await this.patterns.search(input.message, env.EMBED_TOP_K, env.EMBED_MIN_SCORE);
    } catch (e) {
      this.logger.warn(`Pattern retrieval skipped: ${(e as Error).message}`);
    }

    const systemPrompt =
      buildSystemPrompt(
        // graphRevision prompt bağlamında kullanılmaz — placeholder 0.
        { project: { id: projectId } as any, nodes, edges, counts: { nodes: nodes.length, edges: edges.length }, graphRevision: 0 },
        patternHits,
      ) + JSON_DIRECTIVE;

    // json_object mode: provider'ı geçerli JSON'a zorlar (tool-args bozulması yok).
    // Parse'ı kendimiz yaparız (langchain'in katı parser'ı yerine → tam kontrol + tolerans).
    const llm = getGenerationChat(); // response_format json_object factory'de modelKwargs'ta

    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...input.history.map((h) => (h.role === "user" ? new HumanMessage(h.content) : new AIMessage(h.content))),
      new HumanMessage(input.message),
    ];

    let attempts = 0;
    try {
      while (attempts <= MAX_ATTEMPTS) {
        const ai = (await llm.invoke(messages)) as AIMessage;
        const raw = textOf(ai);
        const parsed = GenerationSchema.safeParse(safeJson(extractJson(raw)));
        if (!parsed.success) {
          // JSON bozuk/eksik → düzeltme isteyip retry.
          this.logger.warn(`Could not parse output, retry (${attempts + 1}/${MAX_ATTEMPTS}).`);
          if (attempts >= MAX_ATTEMPTS) break;
          messages.push(new AIMessage(raw.slice(0, 500)));
          messages.push(new HumanMessage("Çıktın geçerli/tam JSON değildi. SADECE belirtilen şemada eksiksiz JSON üret."));
          attempts++;
          continue;
        }
        const out: Generation = parsed.data;

        const result = await this.graphService.apply(projectId, {
          tabId: input.tabId,
          mutations: { nodes: (out.nodes ?? []) as any, edges: (out.edges ?? []) as any },
        });
        attempts++;

        if (result.success) {
          return {
            reply: out.summary || "Architecture created successfully.",
            applied: { idMap: result.idMap, nodeCount: result.nodeCount, edgeCount: result.edgeCount },
            attempts,
          };
        }

        // Kural ihlali → self-correction: ihlalleri geri ver, düzeltilmiş JSON iste.
        if (attempts > MAX_ATTEMPTS) break;
        messages.push(new AIMessage(JSON.stringify({ nodes: out.nodes, edges: out.edges })));
        messages.push(
          new HumanMessage(
            `Bu taslak Solarch kurallarını ihlal etti:\n${JSON.stringify(result.violations).slice(0, 1000)}\n` +
              "Önerileri (suggestion) uygula, düzeltilmiş TAM JSON'ı tekrar üret.",
          ),
        );
      }

      return {
        reply: "Could not make the architecture rule-compliant within the maximum number of attempts. Please clarify your request.",
        applied: null,
        attempts,
      };
    } catch (err) {
      const msg = (err as Error)?.message ?? "";
      this.logger.error(`AI generation error: ${msg.slice(0, 200)}`);
      const corrupt = /delimiter|expecting|json|parse|unexpected|column \d+/i.test(msg);
      throw new ServiceUnavailableException({
        code: "ERR_AI_GENERATION_FAILED",
        message: corrupt
          ? "Could not process the AI output — the model returned a corrupted response. Please try again."
          : "AI generation failed. Please try again.",
      });
    }
  }

  /** Mode dispatcher — agent (tool calling) veya instruct (text stream).
   *  `signal`: client koparsa in-flight LLM çağrısı + DB yazımı durur. */
  async *chatStream(projectId: string, input: ChatInput, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    if (input.mode === "instruct") {
      yield* this.chatStreamInstruct(projectId, input, signal);
      return;
    }
    yield* this.chatStreamAgent(projectId, input, signal);
  }

  /** Instruct mode — proje hakkında sohbet. Tool yok; LLM token-by-token text döner.
   *  System prompt'a graph snapshot ve [[node:ID|name]] markup talimatı verilir.
   *  Frontend chunk'ları typewriter ile render eder, marker'ları NodeChip'e çevirir. */
  async *chatStreamInstruct(projectId: string, input: ChatInput, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    if (!isGenerationConfigured()) {
      yield { type: "error", code: "ERR_AI_NOT_CONFIGURED", message: "AI agent is not configured." };
      return;
    }
    if (!(await this.projectsRepo.exists(projectId))) {
      yield { type: "error", code: "ERR_PROJECT_NOT_FOUND", message: `Project '${projectId}' not found.` };
      return;
    }

    const { nodes, edges } = await this.projectsRepo.getGraph(projectId);
    const systemPrompt = buildInstructPrompt(nodes, edges);

    // Instruct mode: the chat/instruct tier (resolved per active provider). toolCalling=true
    // only to drop response_format=json_object so the model returns free text (not JSON).
    const llm = getGenerationChat({
      toolCalling: true,
      streaming: true,
      tier: "instruct",
    });

    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...input.history.map((h) => (h.role === "user" ? new HumanMessage(h.content) : new AIMessage(h.content))),
      new HumanMessage(input.message),
    ];

    try {
      const stream = await llm.stream(messages, { signal });
      let fullText = "";
      for await (const chunk of stream) {
        if (signal?.aborted) return; // client koptu → sessizce dur
        const delta = typeof chunk.content === "string" ? chunk.content
          : Array.isArray(chunk.content)
            ? chunk.content.map((c) => (typeof c === "string" ? c : "text" in c ? (c as any).text : "")).join("")
            : "";
        if (!delta) continue;
        fullText += delta;
        yield { type: "text-delta", delta };
      }
      yield {
        type: "done",
        message: fullText,
        counts: { nodes: 0, edges: 0 },
        attempts: 1,
      };
    } catch (err) {
      if (signal?.aborted) {
        this.logger.log("Instruct stream iptal edildi (client koptu).");
        return;
      }
      const msg = (err as Error)?.message ?? "";
      this.logger.error(`Instruct stream error: ${msg.slice(0, 200)}`);
      yield { type: "error", code: "ERR_AI_GENERATION_FAILED", message: "Could not generate the AI response. Please try again." };
    }
  }

  /** Üretilen projenin SÖZLEŞME boşluklarını döndürür (codegen contract-lint'i
   *  yeniden kullanır): gövde-alan write endpoint'i input DTO'su olmadan, rol-ama-
   *  auth'suz, route-param eşleşmeyen, dangling DTO/entity ref. Üretim-anı düzeltme
   *  döngüsü için. Domain Node/Edge → codegen IR girdisi: yalnız type/properties/id
   *  okunur (pozisyon önemsiz), bu yüzden sınır cast'i güvenli. */
  private async contractGaps(projectId: string): Promise<string[]> {
    const [nodes, edges] = await Promise.all([this.nodes.list(projectId), this.edges.list(projectId)]);
    return lintContracts(buildCodeGraph(nodes as unknown as StoredNode[], edges as unknown as StoredEdge[]));
  }

  /** Streaming agent loop — atomic create_node/create_edge tool calling.
   *  Her tool execute sonrası StreamEvent yield eder; SSE'ye encode edilir.
   *  Hata yönetimi: HttpException response body'leri ToolMessage olarak LLM'e
   *  geri verilir → LLM kendini düzeltir (ReAct). Frontend hatayı görmez,
   *  sadece final node/edge'leri görür. */
  async *chatStreamAgent(projectId: string, input: ChatInput, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    if (!isGenerationConfigured()) {
      yield {
        type: "error",
        code: "ERR_AI_NOT_CONFIGURED",
        message: "AI agent is not configured (BEDROCK_API_KEY / DEEPSEEK_API_KEY missing).",
      };
      return;
    }
    if (!(await this.projectsRepo.exists(projectId))) {
      yield { type: "error", code: "ERR_PROJECT_NOT_FOUND", message: `Project '${projectId}' not found.` };
      return;
    }

    const { nodes, edges } = await this.projectsRepo.getGraph(projectId);
    const homeTabId = input.tabId ?? (await this.tabs.ensureDefault(projectId)).id;

    let patternHits: PatternSearchHit[] = [];
    try {
      patternHits = await this.patterns.search(input.message, env.EMBED_TOP_K, env.EMBED_MIN_SCORE);
    } catch (e) {
      this.logger.warn(`Pattern retrieval skipped: ${(e as Error).message}`);
    }

    const systemPrompt =
      buildSystemPrompt(
        // graphRevision prompt bağlamında kullanılmaz — placeholder 0.
        { project: { id: projectId } as any, nodes, edges, counts: { nodes: nodes.length, edges: edges.length }, graphRevision: 0 },
        patternHits,
      ) + STREAMING_DIRECTIVE;

    // Agent mode: the high-capability "agent" tier (resolved per active provider).
    const llm = getGenerationChat({ toolCalling: true, tier: "agent" });
    const llmWithTools = llm.bindTools!([
      { name: CREATE_NODE_TOOL_NAME, description: CREATE_NODE_DESCRIPTION, schema: CreateNodeArgsSchema },
      { name: CREATE_EDGE_TOOL_NAME, description: CREATE_EDGE_DESCRIPTION, schema: CreateEdgeArgsSchema },
      // Refactor araçları — mevcut grafı değiştirmek (append-only değil).
      { name: GET_NODE_TOOL_NAME, description: GET_NODE_DESCRIPTION, schema: GetNodeArgsSchema },
      { name: UPDATE_NODE_TOOL_NAME, description: UPDATE_NODE_DESCRIPTION, schema: UpdateNodeArgsSchema },
      { name: DELETE_NODE_TOOL_NAME, description: DELETE_NODE_DESCRIPTION, schema: DeleteNodeArgsSchema },
      { name: DELETE_EDGE_TOOL_NAME, description: DELETE_EDGE_DESCRIPTION, schema: DeleteEdgeArgsSchema },
    ]);

    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...input.history.map((h) => (h.role === "user" ? new HumanMessage(h.content) : new AIMessage(h.content))),
      new HumanMessage(input.message),
    ];
    // "Devam et": önceki üretim adım limitine takılıp duraklatıldı. Agent yukarıda
    // 'Mevcut Mimari' olarak verilen grafı görüyor → var olanı TEKRAR YARATMA,
    // yalnız eksikleri tamamla + orphan'ları bağla.
    if (input.continueRun) {
      messages.push(new HumanMessage(
        "DEVAM MODU: Önceki üretim adım limitine takıldı, mimari yarım kaldı. Yukarıda verilen MEVCUT graf bu projede ZATEN VAR — o node/edge'leri TEKRAR YARATMA. Yalnızca eksik kalan node/edge'leri ekle ve bağlantısız (orphan) node'ları uygun şekilde bağla. Tamamlayınca kısa bir özet yaz.",
      ));
    }

    const MAX_TURNS = env.AI_MAX_TURNS; // güvenlik tavanı (env, default 250). Batching ile tipik üretim çok daha az turda biter.
    const MAX_CORRECTION_ROUNDS = 2; // orphan check yeniden tetiklemesi
    const MAX_CONTRACT_ROUNDS = 2; // sözleşme-bütünlüğü (contract-lint) yeniden tetiklemesi
    let attempts = 0;
    let nodeCount = 0;
    let edgeCount = 0;
    let correctionRounds = 0;
    let contractRounds = 0;
    // Session içinde yaratılan node'lar (orphan check için)
    const createdNodes = new Map<string, { id: string; type: string; name: string }>();
    // Edge'lerde geçen node endpoint'leri (source+target birleşik)
    const edgeEndpoints = new Set<string>();
    // DEVRE KESİCİ: imkânsız/tekrarlayan edge denemeleri MAX_TURNS'e kadar thrash edip
    // token yakmasın. Aynı (source|target|kind) bir kez reddedilince tekrar DENENMEZ;
    // ardışık (8) veya toplam (40) başarısızlık aşılınca agent durur (stuck).
    const failedEdgeSigs = new Set<string>();
    let totalToolFailures = 0;
    let consecutiveFailures = 0;
    let stuck = false;
    const MAX_CONSECUTIVE_FAILURES = 8;
    const MAX_TOTAL_FAILURES = 40;

    // Terminal başarısızlıkta (MAX_TURNS / exception / correction limit) yaratılıp
    // HÂLÂ orphan kalan node'ları sil → yarım graf kalmasın; bağlı alt-grafik korunur.
    // `self` çünkü inline generator'da `this` bağlanmaz. Her delete ayrı try/catch:
    // biri patlasa stream akmaya devam etsin (catch-içi delegation güvenli kalır).
    const self = this;
    async function* cleanupOrphans(reason: string): AsyncGenerator<StreamEvent> {
      const orphans = [...createdNodes.values()].filter((n) => !edgeEndpoints.has(n.id));
      for (const o of orphans) {
        try {
          await self.nodes.delete(projectId, o.id);
        } catch (e) {
          // Silme başarısız → state'i BOZMA (removed yield etme, count düşürme):
          // frontend cache'ten kaldırırsa DB'de duran node 'hayalet' olur.
          self.logger.warn(`[orphan-cleanup] deletion skipped ${o.id}: ${(e as Error).message}`);
          continue;
        }
        createdNodes.delete(o.id);
        nodeCount = Math.max(0, nodeCount - 1);
        yield { type: "removed", data: { id: o.id, kind: "node", reason } };
      }
    }

    try {
      while (attempts < MAX_TURNS) {
        if (signal?.aborted) return; // client koptu → yeni LLM turu açma
        attempts++;
        const ai = (await llmWithTools.invoke(messages, { signal })) as AIMessage;
        const toolCalls = (ai.tool_calls ?? []) as Array<{ id?: string; name: string; args: Record<string, unknown> }>;

        if (toolCalls.length === 0) {
          // LLM tool çağırmayı durdurdu → orphan check (rule-based safety net)
          const orphans = [...createdNodes.values()].filter((n) => !edgeEndpoints.has(n.id));
          if (orphans.length > 0 && correctionRounds < MAX_CORRECTION_ROUNDS) {
            correctionRounds++;
            this.logger.log(
              `[orphan-check] ${orphans.length} yetim node tespit edildi (round ${correctionRounds}/${MAX_CORRECTION_ROUNDS}). LLM'e geri bildiriliyor.`,
            );
            const orphanContext = buildOrphanContext(orphans);
            messages.push(ai); // önceki "done" denemesi history'ye
            messages.push(new HumanMessage(
              `**ORPHAN_CHECK FAIL** — henüz tamamlanmadı.\n\n` +
                `Aşağıdaki ${orphans.length} node bağlantısız (orphan) durumda. ` +
                `Yetim node yasağı gereği her birini uygun bir node ile create_edge ile bağlamalısın:\n\n` +
                orphanContext +
                `\n\nBu bağlantıları kur. ÖNEMLİ: bir node mimari kurallara göre HİÇBİR şekilde bağlanamıyorsa (edge sürekli ERR_NOT_WHITELISTED/ERR_EDGE_ALREADY_REJECTED veriyorsa) o node'u BAĞLAMADAN bırak ve özetine geç — aynı reddedilen edge'i ASLA tekrar deneme. Tamamladıysan kısa bir özet yaz.`,
            ));
            continue; // agent loop devam, LLM tekrar tool çağıracak
          }

          // Correction limit sonrası hâlâ orphan varsa temizle (yarım graf kalmasın).
          if (orphans.length > 0) {
            this.logger.warn(
              `[orphan-check] ${MAX_CORRECTION_ROUNDS} round sonrası hala ${orphans.length} orphan var — temizleniyor.`,
            );
            yield* cleanupOrphans("orphan-after-correction-limit");
          }

          // ── SÖZLEŞME BÜTÜNLÜĞÜ (orphan-prevention deseni — saf prompt yetersiz):
          //    üretilen graf contract-lint boşluğu taşıyorsa (gövde-alan write endpoint'i
          //    input DTO'su olmadan, rol-ama-auth'suz, route-param eşleşmeyen, dangling
          //    ref) LLM'e GERİ BİLDİR → eksik DTO'yu yarat + endpoint'e bağla. Diyagram-AI'ın
          //    eksik sözleşme üretmesini ÜRETİM-ANINDA kapatır (codegen yine zarif degrade
          //    eder ama bu, tipli sözleşmeyi diyagrama koydurur). ──
          if (contractRounds < MAX_CONTRACT_ROUNDS) {
            let gaps: string[] = [];
            try {
              gaps = await this.contractGaps(projectId);
            } catch (e) {
              this.logger.warn(`[contract-check] atlandı: ${(e as Error).message}`);
            }
            if (gaps.length > 0) {
              contractRounds++;
              this.logger.log(
                `[contract-check] ${gaps.length} sözleşme boşluğu (round ${contractRounds}/${MAX_CONTRACT_ROUNDS}). LLM'e geri bildiriliyor.`,
              );
              messages.push(ai);
              messages.push(new HumanMessage(
                `**CONTRACT_CHECK FAIL** — mimari sözleşmesi eksik:\n\n` +
                  gaps.map((g) => `- ${g}`).join("\n") +
                  `\n\nHer boşluğu düzelt. Gövde-alan write endpoint'i (POST/PUT/PATCH) input DTO'su olmadan ise: uygun alanları taşıyan ` +
                  `bir DTO node'u create_node ile yarat, sonra get_node ile Controller'ı oku ve update_node ile TAM Endpoints dizisini gönder — ` +
                  `ilgili endpoint'in RequestDTORef'ini yeni DTO'nun Name'ine ayarla. Rol gerektirip auth gerektirmeyen endpoint'te RequiresAuth'u aç. ` +
                  `Düzeltemediğin bir boşluk varsa olduğu gibi bırak ve kısa bir özet yaz.`,
              ));
              continue; // agent loop devam → LLM düzeltsin
            }
          }

          yield {
            type: "done",
            message: textOf(ai) || "Architecture complete.",
            counts: { nodes: nodeCount, edges: edgeCount },
            attempts,
          };
          return;
        }

        messages.push(ai);

        if (signal?.aborted) return; // client koptu → tool execute = boş DB yazımı, atla

        for (const call of toolCalls) {
          if (signal?.aborted) return; // tur ortasında abort → kalan tool yazımlarını da durdur
          const callId = call.id ?? `call_${attempts}`;
          try {
            if (call.name === CREATE_NODE_TOOL_NAME) {
              const args = CreateNodeArgsSchema.parse(call.args);
              const node = await this.nodes.create(projectId, {
                type: args.type as NodeKind,
                projectId,
                position: { x: 0, y: 0 }, // frontend arrange ile gerçek konuma yazar
                properties: args.properties,
                homeTabId,
              } as any);
              nodeCount++;
              consecutiveFailures = 0;
              const nodeName = extractNodeName(node.type, node.properties as Record<string, unknown>);
              createdNodes.set(node.id, { id: node.id, type: node.type, name: nodeName });
              yield { type: "node", data: node };
              const warnings = computeProjectWarnings(createdNodes, edgeEndpoints, nodeCount, edgeCount);
              messages.push(new ToolMessage({
                content: JSON.stringify({ ok: true, id: node.id, type: node.type, ...(warnings && { warnings }) }),
                tool_call_id: callId,
              }));
            } else if (call.name === CREATE_EDGE_TOOL_NAME) {
              const args = CreateEdgeArgsSchema.parse(call.args);
              const sig = `${args.sourceNodeId}|${args.targetNodeId}|${args.kind}`;
              // Daha önce REDDEDİLEN birebir aynı edge → DB/Rules eval'e HİÇ gitme;
              // LLM'e kesin dille "tekrar deneme" de + başarısızlık say (token tasarrufu).
              if (failedEdgeSigs.has(sig)) {
                totalToolFailures++; consecutiveFailures++;
                messages.push(new ToolMessage({
                  content: JSON.stringify({ ok: false, code: "ERR_EDGE_ALREADY_REJECTED", message: "This connection (same source/target/kind) was already rejected and violates the architecture rules. DO NOT RETRY — create a different connection or leave this node unconnected." }),
                  tool_call_id: callId,
                }));
                continue;
              }
              const edge = await this.edges.create(projectId, {
                projectId,
                sourceNodeId: args.sourceNodeId,
                targetNodeId: args.targetNodeId,
                kind: args.kind as EdgeKind,
                properties: { IsAsync: false, ...(args.label ? { Label: args.label } : {}) },
              } as any);
              edgeCount++;
              consecutiveFailures = 0;
              edgeEndpoints.add(edge.sourceNodeId);
              edgeEndpoints.add(edge.targetNodeId);
              yield { type: "edge", data: edge };
              const warnings = computeProjectWarnings(createdNodes, edgeEndpoints, nodeCount, edgeCount);
              messages.push(new ToolMessage({
                content: JSON.stringify({ ok: true, id: edge.id, ...(warnings && { warnings }) }),
                tool_call_id: callId,
              }));
            } else if (call.name === GET_NODE_TOOL_NAME) {
              // Read-only — düzenlemeden önce mevcut properties'i göster.
              const args = GetNodeArgsSchema.parse(call.args);
              const node = await this.nodes.getById(projectId, args.nodeId);
              consecutiveFailures = 0;
              messages.push(new ToolMessage({
                content: JSON.stringify({ ok: true, id: node.id, type: node.type, version: node.version, properties: node.properties }),
                tool_call_id: callId,
              }));
            } else if (call.name === UPDATE_NODE_TOOL_NAME) {
              // Mevcut node'u değiştir (rename / alan / dizi). Merge + tam doğrulama serviste.
              const args = UpdateNodeArgsSchema.parse(call.args);
              const node = await this.nodes.applyPropertiesPatch(projectId, args.nodeId, args.properties);
              consecutiveFailures = 0;
              // Session'da yaratılmış bir node güncellendiyse isim takibini tazele.
              if (createdNodes.has(node.id)) {
                createdNodes.set(node.id, { id: node.id, type: node.type, name: extractNodeName(node.type, node.properties as Record<string, unknown>) });
              }
              yield { type: "node", data: node }; // frontend node'u upsert eder
              messages.push(new ToolMessage({
                content: JSON.stringify({ ok: true, id: node.id, version: node.version }),
                tool_call_id: callId,
              }));
            } else if (call.name === DELETE_NODE_TOOL_NAME) {
              const args = DeleteNodeArgsSchema.parse(call.args);
              await this.nodes.delete(projectId, args.nodeId);
              consecutiveFailures = 0;
              if (createdNodes.has(args.nodeId)) {
                createdNodes.delete(args.nodeId);
                nodeCount = Math.max(0, nodeCount - 1);
              }
              yield { type: "removed", data: { id: args.nodeId, kind: "node", reason: "ai-delete" } };
              messages.push(new ToolMessage({
                content: JSON.stringify({ ok: true, id: args.nodeId }),
                tool_call_id: callId,
              }));
            } else if (call.name === DELETE_EDGE_TOOL_NAME) {
              const args = DeleteEdgeArgsSchema.parse(call.args);
              await this.edges.delete(projectId, args.edgeId);
              consecutiveFailures = 0;
              yield { type: "removed", data: { id: args.edgeId, kind: "edge", reason: "ai-delete" } };
              messages.push(new ToolMessage({
                content: JSON.stringify({ ok: true, id: args.edgeId }),
                tool_call_id: callId,
              }));
            } else {
              messages.push(new ToolMessage({
                content: JSON.stringify({ ok: false, code: "ERR_UNKNOWN_TOOL", message: `Unknown tool: ${call.name}` }),
                tool_call_id: callId,
              }));
            }
          } catch (err) {
            // ALTYAPI TERMİNAL HATASI: Neo4j sürücüsü kapanmışsa (hot-reload / deploy
            // SIGTERM → driver.close) bu hata LLM TARAFINDAN DÜZELTİLEMEZ — havuz kapalı.
            // Onu ERR_INTERNAL retry'ı sayıp "düzelt" demek 8-12 LLM turu + token yakar,
            // sonra circuit-breaker'a düşer; cleanup da aynı kapalı havuza yazamaz. Anında,
            // temiz dur: kısmi graf korunur (abort sözleşmesiyle aynı), beyhude cleanup yok.
            if (isBackendUnavailable(err)) {
              this.logger.warn(
                `[backend-unavailable] ${call.name} sırasında veritabanı erişilemez (kapanıyor olabilir) — agent anında durduruldu; kısmi graf korundu.`,
              );
              yield {
                type: "error",
                code: "ERR_BACKEND_UNAVAILABLE",
                message:
                  "The backend is restarting or unavailable. The partial architecture was preserved — please retry in a moment.",
              };
              return;
            }
            // HttpException → response body'i LLM'e geri ver (ReAct self-correct)
            const errBody = httpExceptionBody(err);
            totalToolFailures++; consecutiveFailures++;
            // Reddedilen edge imzasını kaydet → aynı edge bir daha DB/Rules'a gitmesin.
            if (call.name === CREATE_EDGE_TOOL_NAME) {
              const a = call.args as { sourceNodeId?: string; targetNodeId?: string; kind?: string };
              if (a.sourceNodeId && a.targetNodeId && a.kind) failedEdgeSigs.add(`${a.sourceNodeId}|${a.targetNodeId}|${a.kind}`);
            }
            this.logger.warn(`Tool ${call.name} failed: ${errBody.code ?? "unknown"} (total ${totalToolFailures}, consecutive ${consecutiveFailures}) — let the LLM attempt a correction.`);
            messages.push(new ToolMessage({
              content: JSON.stringify({ ok: false, ...errBody }),
              tool_call_id: callId,
            }));
          }
        }

        // DEVRE KESİCİ: çok fazla (ardışık veya toplam) kural-ihlali/başarısızlık →
        // imkânsız orphan'ı MAX_TURNS'e kadar deneme; dur, geçerli grafiği koru.
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES || totalToolFailures >= MAX_TOTAL_FAILURES) {
          this.logger.warn(
            `[circuit-breaker] ${totalToolFailures} tool başarısızlığı (ardışık ${consecutiveFailures}) — agent durduruluyor (stuck).`,
          );
          stuck = true;
          break;
        }
      }

      if (stuck) {
        // Kural-ihlali bütçesi (illegal edge thrash): devam etmek tekrar thrash eder →
        // orphan'ları temizle + graceful done (devam ETTİRİLMEZ).
        yield* cleanupOrphans("rule-failure-budget");
        yield {
          type: "done",
          message: "Architecture created. Some connections could not be made because they violate the architecture rules and were skipped.",
          counts: { nodes: nodeCount, edges: edgeCount },
          attempts,
        };
        return;
      }
      // ADIM LİMİTİ (MAX_TURNS): iş bitmedi ama tavan doldu. Orphan'ları TEMİZLEME —
      // kısmi mimari korunur; "Devam et" (continueRun) ile agent mevcut grafı görüp
      // kaldığı yerden sürer. paused event'i frontend'e "Devam et" butonu gösterir.
      yield {
        type: "paused",
        code: "MAX_TURNS_REACHED",
        message: `A maximum of ${MAX_TURNS} steps are generated per run. The architecture was partially created — use "Continue" to resume from where it stopped.`,
        counts: { nodes: nodeCount, edges: edgeCount },
        attempts,
      };
    } catch (err) {
      if (signal?.aborted) {
        this.logger.log("Agent stream aborted (client disconnected) — the partial graph remains saved.");
        return;
      }
      // Altyapı terminal hatası (kapalı havuz) burada da yakalanabilir (örn. LLM-dışı bir
      // Neo4j çağrısı). Cleanup beyhude (havuz kapalı) → DENEME; net sinyal ver, kısmi graf kalsın.
      if (isBackendUnavailable(err)) {
        this.logger.warn(
          "[backend-unavailable] agent stream — veritabanı erişilemez (kapanıyor olabilir); kısmi graf korundu, cleanup atlandı.",
        );
        yield {
          type: "error",
          code: "ERR_BACKEND_UNAVAILABLE",
          message:
            "The backend is restarting or unavailable. The partial architecture was preserved — please retry in a moment.",
        };
        return;
      }
      const msg = (err as Error)?.message ?? "";
      this.logger.error(`Stream generation error: ${msg.slice(0, 200)}`);
      // Yarım graf kalmasın — orphan'ları temizle. cleanupOrphans kendi içinde her
      // delete'i yutuyor; yine de defensif try/catch (ikinci exception error event'ini
      // engellemesin).
      try {
        yield* cleanupOrphans("agent-exception");
      } catch (e) {
        this.logger.warn(`[orphan-cleanup] cleanup skipped during error: ${(e as Error).message}`);
      }
      yield {
        type: "error",
        code: "ERR_AI_GENERATION_FAILED",
        message: "Unexpected error during AI generation. Unconnectable nodes were cleaned up; the connected subgraph was preserved.",
      };
    }
  }
}

/** chatStream için sistem prompt eki — agent loop davranışını şekillendirir. */
const STREAMING_DIRECTIVE = `

## STREAMING AGENT DAVRANIŞI (ZORUNLU)
Bu modda mimari **toplu turlarla** üretilir. Verimli ol: her tur mümkün olduğunca çok iş yap.
1. **AYNI TURDA BİRDEN ÇOK TOOL ÇAĞIR (batch — ÇOK ÖNEMLİ).** İlgili node'ları tek turda, paralel create_node çağrılarıyla yarat (ör. bir turda 8-12 node). Dönen ID'leri sakla. Tek-tek çağırma; bu hem yavaştır hem tur tavanını (limit) tüketir.
2. Node'lar yaratılıp ID'leri elindeyken, edge'leri de **toplu** yarat: bir turda olabildiğince çok create_edge çağır. (Her edge'in source+target node'u önceden yaratılmış olmalı → edge'ler, ait oldukları node'lardan SONRAKİ turlarda gelir.)
3. Tool sana { ok: false, code, message, suggestion } dönerse: öneriyi (suggestion) oku, düzelt, **aynı tool'u tekrar dene**.
4. Tüm gerekli node ve edge'ler yaratıldıktan sonra kullanıcıya kısa bir özet yaz (1-2 cümle, respond in English — the product UI is English) — bu son mesaj tool çağrısı OLMAMALI, sadece metin.
5. Position belirtme; backend default verir, frontend otomatik yerleşim yapar.

## MEVCUT GRAFI DEĞİŞTİRME (REFACTOR)
'Mevcut Kanvas Durumu'nda listelenen node/edge'ler ZATEN VAR. Kullanıcı bir DEĞİŞİKLİK istediyse (yeniden adlandır, sil, bir alanı/diziyi değiştir, bağlantıyı değiştir) bunları YENİDEN YARATMA — şu araçları kullan:
- **update_node(nodeId, properties)** — mevcut bir node'u değiştir (yeniden adlandırma, açıklama/flag, bir diziyi değiştirme). Yalnız değişen üst-düzey alanları gönder; mevcut properties üzerine merge edilir. Bir DİZİ alanını (Columns/Endpoints/Methods/Fields) düzenleyeceksen ÖNCE \`get_node\` ile tamamını oku, sonra TAM diziyi gönder (diziler replace edilir, append edilmez).
- **get_node(nodeId)** — düzenlemeden önce bir node'un tam properties'ini oku.
- **delete_node(nodeId)** — bir node'u (ve edge'lerini) sil.
- **delete_edge(edgeId)** — bir bağlantıyı sil. Bir bağlantıyı YENİDEN YÖNLENDİRMEK için: \`delete_edge(eskiId)\` + \`create_edge(yeni uçlar)\`.
Node id'leri ve edge id'leri 'Mevcut Kanvas Durumu'nda verilmiştir — onları kullan, uydurma. Değişiklik bittiğinde tool çağırmadan kısa bir özet yaz.

## YETIM NODE YASAĞI (ÇOK ÖNEMLİ)
**HİÇBİR node bağlantısız (orphan) kalmamalı.** Yarattığın her node en az bir edge ile başka bir node'a bağlı olmalı. Yarattığın node ID'lerini takip et — her birinin için en az bir create_edge çağırmadan "done" deme.

### Node tipine göre DOĞRU YÖNLÜ bağlantı paternleri (pasif node = edge HEDEFİ, kaynağı değil):
- **DTO** (hedef): \`create_edge(source=Controller|Service, target=DTO, kind=USES)\` — request/response payload. DTO yalnız \`DTO→HAS→DTO\` (nested) ve \`DTO→USES→Enum\`'da kaynak olur.
- **Enum** (hedef): \`create_edge(source=Model|DTO|Table, target=Enum, kind=USES)\`. Enum asla kaynak DEĞİLDİR.
- **Exception** (hedef): \`create_edge(source=Service|Controller|Repository, target=Exception, kind=THROWS)\`.
- **EnvironmentVariable** (hedef): \`create_edge(source=Service, target=EnvironmentVariable, kind=READS_CONFIG)\`.
- **Cache** (hedef): \`create_edge(source=Service, target=Cache, kind=CACHES_IN)\`.
- **View** (hedef): \`create_edge(source=Repository, target=View, kind=QUERIES)\`.
- **UIComponent** (hedef): \`create_edge(source=FrontendApp, target=UIComponent, kind=HAS)\`.
- **Middleware** (kaynak): \`create_edge(source=Middleware, target=Controller, kind=ROUTES_TO)\`.
- **Repository**: hedef → \`create_edge(source=Service, target=Repository, kind=CALLS)\`; kaynak → \`(source=Repository, target=Table, kind=QUERIES|WRITES)\`, \`(source=Repository, target=Model, kind=USES|RETURNS)\`.
- **Model**: hedef → \`create_edge(source=Service, target=Model, kind=USES)\`; kaynak → \`Model→USES→Table\`, \`Model→USES→Enum\`, \`Model→HAS|EXTENDS→Model\`.

Bu paternleri DOĞRU YÖNDE uygulamazsan edge \`ERR_NOT_WHITELISTED\` ile reddedilir.

### SON KONTROL (zorunlu)
"done" mesajı yazmadan önce şu kontrolü yap: yarattığın her node ID'si için en az bir create_edge çağrısı yaptın mı? Hayır ise → eksik edge'leri şimdi yarat.

## TOOL RESPONSE'TAKİ WARNINGS (SÜREKLİ TAKİP ET)
create_node ve create_edge tool sonuçlarında \`warnings\` field'ı dönebilir:
\`\`\`json
{
  "ok": true, "id": "...", "type": "DTO",
  "warnings": {
    "status": "8 node, 5 edge — 3 node henüz orphan. Yapılacaklar listene ekle, fırsat buldukça bağla.",
    "pendingOrphans": [
      { "id": "abc-123", "type": "Middleware", "name": "JwtAuth", "hint": "create_edge(source=Middleware, target=Controller, kind=ROUTES_TO)" },
      ...
    ]
  }
}
\`\`\`

**Bu warnings'i her tool çağrısından sonra mutlaka oku.** \`pendingOrphans\` listesindeki node'ları yapılacaklar listenin başına ekle. Sonraki uygun fırsatta (yeni ilgili node yarattığında veya doğrudan) bu orphan'ları bağla. Yeni node yaratmaya devam ederken eski orphan'ları unutma — onlar **öncelikli**.`;

/** Neo4j sürücüsü kapandığında (deploy SIGTERM / dev hot-reload → driver.close) atılan
 *  hata sınıfı. Bu hata RETRY edilemez ve LLM tarafından DÜZELTİLEMEZ — havuz kapalı.
 *  Tool döngüsü bunu görünce "düzelt" turlarıyla token yakmak yerine anında durmalı. */
function isBackendUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /pool is closed|driver is closed|connection pool is closed|driver has been closed/i.test(msg);
}

/** NestJS HttpException'dan response body'i (code, message, suggestion, ...) çıkarır. */
function httpExceptionBody(err: unknown): Record<string, unknown> {
  if (err instanceof HttpException) {
    const resp = err.getResponse();
    if (typeof resp === "object" && resp !== null) return resp as Record<string, unknown>;
    return { code: "ERR_HTTP", message: String(resp) };
  }
  if (err instanceof Error) return { code: "ERR_INTERNAL", message: err.message };
  return { code: "ERR_UNKNOWN", message: String(err) };
}

/** Node tipinden name field key'i — frontend nameOf ile aynı NAME_KEYS sırası. */
const NAME_KEYS_BY_TYPE: Partial<Record<string, string>> = {
  Table: "TableName", DTO: "Name", Model: "ClassName", Enum: "Name", View: "ViewName",
  Service: "ServiceName", Worker: "WorkerName", EventHandler: "HandlerName",
  Controller: "ControllerName", MessageQueue: "QueueName",
  Repository: "RepositoryName", Cache: "CacheName", ExternalService: "Name",
  FrontendApp: "AppName", UIComponent: "ComponentName",
  Middleware: "MiddlewareName",
  EnvironmentVariable: "Key", Exception: "ExceptionName",
  Module: "ModuleName",
  APIGateway: "GatewayName", Orchestrator: "OrchestratorName",
};

function extractNodeName(type: string, properties: Record<string, unknown>): string {
  const key = NAME_KEYS_BY_TYPE[type];
  if (key && typeof properties[key] === "string") return properties[key] as string;
  // Fallback — herhangi bir string field
  for (const k of ["Name", "TableName", "ServiceName", "ControllerName", "ClassName"]) {
    if (typeof properties[k] === "string") return properties[k] as string;
  }
  return `(${type})`;
}

/** Orphan node listesi için LLM'e gönderilecek context — tipe göre bağlantı pattern'ı önerir. */
// Pasif node'lar edge'in HEDEFİdir — hint'ler whitelist yönüyle BİREBİR (ters yön
// ERR_NOT_WHITELISTED verir). source/target açıkça belirtilir.
const ORPHAN_HINTS: Partial<Record<string, string>> = {
  DTO: "DTO HEDEFTİR: create_edge(source=Controller veya Service, target=DTO, kind=USES). DTO kaynak olabildiği tek yer: DTO→USES→Enum, DTO→HAS→DTO.",
  Middleware: "Middleware KAYNAKTIR: create_edge(source=Middleware, target=Controller, kind=ROUTES_TO).",
  Enum: "Enum HEDEFTİR (asla kaynak): create_edge(source=Model veya DTO veya Table, target=Enum, kind=USES).",
  Exception: "Exception HEDEFTİR: create_edge(source=Service veya Controller veya Repository, target=Exception, kind=THROWS).",
  EnvironmentVariable: "EnvironmentVariable HEDEFTİR: create_edge(source=Service, target=EnvironmentVariable, kind=READS_CONFIG).",
  Cache: "Cache HEDEFTİR: create_edge(source=Service, target=Cache, kind=CACHES_IN).",
  Repository: "Repository HEM hedef HEM kaynak: create_edge(source=Service, target=Repository, kind=CALLS) + create_edge(source=Repository, target=Table, kind=QUERIES veya WRITES).",
  UIComponent: "UIComponent HEDEFTİR: create_edge(source=FrontendApp, target=UIComponent, kind=HAS).",
  Model: "Model: create_edge(source=Service, target=Model, kind=USES) (Model hedef) + Model→USES→Table, Model→USES→Enum (Model kaynak).",
  View: "View HEDEFTİR: create_edge(source=Repository, target=View, kind=QUERIES).",
};

function buildOrphanContext(orphans: Array<{ id: string; type: string; name: string }>): string {
  return orphans
    .map((o) => {
      const hint = ORPHAN_HINTS[o.type] ?? "Mantıklı bir node ile bir edge yarat (CALLS, USES, HAS, vb.).";
      return `- **${o.type}** "${o.name}" (id: ${o.id}) → ${hint}`;
    })
    .join("\n");
}

/** Instruct mode system prompt — graph snapshot + markup talimatı. */
function buildInstructPrompt(
  nodes: Array<{ id: string; type: string; properties?: Record<string, unknown> }>,
  edges: Array<{ id: string; sourceNodeId: string; targetNodeId: string; kind: string }>,
): string {
  const nodeSnapshot = nodes.map((n) => ({
    id: n.id,
    type: n.type,
    name: extractNodeName(n.type, (n.properties ?? {}) as Record<string, unknown>),
  }));
  const edgeSnapshot = edges.map((e) => ({
    id: e.id,
    kind: e.kind,
    source: e.sourceNodeId,
    target: e.targetNodeId,
  }));

  return `Sen Solarch'ın baş yazılım mimarısın. Kullanıcının mevcut mimari grafiği hakkında sorulara açık, profesyonel, kısa cevaplar verirsin (respond in English — the product UI is English).

**KESİNLİKLE NODE YARATMA / DEĞİŞTİRME.** Sadece mevcut grafiği açıklayıp, kullanıcıya rehberlik et.

## NODE/EDGE REFERANS MARKUP'I (ZORUNLU)
Bir node'tan bahsederken bu formatı kullan: \`[[node:NODE_ID|Görünen İsim]]\`
Örnekler:
- "[[node:abc-12345|Users tablosu]] kullanıcı verilerini tutar."
- "İstek önce [[node:def-67890|AuthController]]'a düşer, sonra [[node:ghi-13579|AuthService]]'e geçer."

Bir edge'den bahsederken: \`[[edge:EDGE_ID|kısa açıklama]]\`
Örnek: "[[edge:xyz-456|CALLS bağlantısı]] üzerinden çağrılır."

**ID'ler aşağıdaki snapshot'ta verilmiştir — ASLA uydurma, mutlaka bu ID'leri kullan.** Düz isim yazmak yerine her zaman markup kullan ki frontend chip'e dönüştürüp canvas'ta vurgulayabilsin.

## MEVCUT MİMARİ SNAPSHOT'I

### Node'lar (${nodes.length})
${JSON.stringify(nodeSnapshot, null, 2)}

### Edge'ler (${edges.length})
${JSON.stringify(edgeSnapshot, null, 2)}

## TARZ
- Kısa, net, jargonsuz (respond in English — the product UI is English).
- Markdown başlık/listeler kullanabilirsin ama abartma.
- Cevabın akıcı olmalı, marker'lar metni bölmemeli (chip'ler inline görünür).`;
}

/** Project warning — her tool result'a eklenir. LLM bunu okuyup TODO list'ine
 *  öncelikli ekler. Reactive değil proactive: orphan biriktirmek yerine her
 *  adımda durum farkındalığı sağlar. */
interface ProjectWarnings {
  status: string; // "10 node, 6 edge — 4 orphan kalıyor"
  pendingOrphans: Array<{ id: string; type: string; name: string; hint: string }>;
}

function computeProjectWarnings(
  createdNodes: Map<string, { id: string; type: string; name: string }>,
  edgeEndpoints: Set<string>,
  nodeCount: number,
  edgeCount: number,
): ProjectWarnings | null {
  if (createdNodes.size === 0) return null;
  const orphans = [...createdNodes.values()].filter((n) => !edgeEndpoints.has(n.id));

  if (orphans.length === 0) {
    // Tüm node'lar bağlı — sadece kısa status bilgisi (LLM "iyi gidiyorum" der)
    return {
      status: `${nodeCount} node, ${edgeCount} edge — tüm node'lar bağlı, iyi gidiyorsun.`,
      pendingOrphans: [],
    };
  }

  return {
    status: `${nodeCount} node, ${edgeCount} edge — ${orphans.length} node henüz orphan. Yapılacaklar listene ekle, fırsat buldukça bağla.`,
    pendingOrphans: orphans.map((o) => ({
      id: o.id,
      type: o.type,
      name: o.name,
      hint: ORPHAN_HINTS[o.type] ?? "Mantıklı bir node ile edge yarat (CALLS, USES, HAS, vb.).",
    })),
  };
}
