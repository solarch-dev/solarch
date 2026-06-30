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

/** Structured output schema — apply input ({nodes, edges}) + summary. */
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

/** Extract first valid JSON object from json_object output (tolerates markdown fences etc.). */
function extractJson(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return start >= 0 && end > start ? t.slice(start, end + 1) : t;
}

/** json mode: no tools → embed schema in prompt + 'json' keyword (DeepSeek requirement). */
const JSON_DIRECTIVE = `

## OUTPUT FORMAT (REQUIRED)
In this mode there are NO functions/tools. Reply with ONLY valid JSON (no markdown, backticks, or extra text). JSON schema:
{
  "summary": "short summary (respond in English — the product UI is English)",
  "nodes": [{ "tempId": "temp_x", "type": "Controller", "properties": { ... } }],
  "edges": [{ "sourceTempId": "temp_x", "targetTempId": "temp_y", "edgeType": "CALLS", "label": "optional" }]
}
Every node must carry tempId; edges reference those tempIds.`;

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

    // GraphRAG: fetch nearest canonical patterns (degrades to empty when no embedding).
    let patternHits: PatternSearchHit[] = [];
    try {
      patternHits = await this.patterns.search(input.message, env.EMBED_TOP_K, env.EMBED_MIN_SCORE);
    } catch (e) {
      this.logger.warn(`Pattern retrieval skipped: ${(e as Error).message}`);
    }

    const systemPrompt =
      buildSystemPrompt(
        // graphRevision unused in prompt context — placeholder 0.
        { project: { id: projectId } as any, nodes, edges, counts: { nodes: nodes.length, edges: edges.length }, graphRevision: 0 },
        patternHits,
      ) + JSON_DIRECTIVE;

    // json_object mode: forces provider to valid JSON (no tool-args corruption).
    // We parse ourselves (instead of langchain strict parser → full control + tolerance).
    const llm = getGenerationChat(); // response_format json_object in factory modelKwargs

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
          // Malformed/incomplete JSON → ask for fix and retry.
          this.logger.warn(`Could not parse output, retry (${attempts + 1}/${MAX_ATTEMPTS}).`);
          if (attempts >= MAX_ATTEMPTS) break;
          messages.push(new AIMessage(raw.slice(0, 500)));
          messages.push(new HumanMessage("Your output was not valid/complete JSON. Produce ONLY complete JSON in the specified schema."));
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

        // Rule violation → self-correction: return violations, request fixed JSON.
        if (attempts > MAX_ATTEMPTS) break;
        messages.push(new AIMessage(JSON.stringify({ nodes: out.nodes, edges: out.edges })));
        messages.push(
          new HumanMessage(
            `This draft violated Solarch rules:\n${JSON.stringify(result.violations).slice(0, 1000)}\n` +
              "Apply the suggestions, then produce the complete fixed JSON again.",
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

  /** Mode dispatcher — agent (tool calling) or instruct (text stream).
   *  `signal`: when client disconnects, in-flight LLM call + DB writes stop. */
  async *chatStream(projectId: string, input: ChatInput, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    if (input.mode === "instruct") {
      yield* this.chatStreamInstruct(projectId, input, signal);
      return;
    }
    yield* this.chatStreamAgent(projectId, input, signal);
  }

  /** Instruct mode — chat about the project. No tools; LLM returns text token-by-token.
   *  System prompt includes graph snapshot and [[node:ID|name]] markup instructions.
   *  Frontend renders chunks with typewriter effect, converts markers to NodeChips. */
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
        if (signal?.aborted) return; // client disconnected → stop silently
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
        this.logger.log("Instruct stream cancelled (client disconnected).");
        return;
      }
      const msg = (err as Error)?.message ?? "";
      this.logger.error(`Instruct stream error: ${msg.slice(0, 200)}`);
      yield { type: "error", code: "ERR_AI_GENERATION_FAILED", message: "Could not generate the AI response. Please try again." };
    }
  }

  /** Returns CONTRACT gaps in the generated project (reuses codegen contract-lint):
   *  body-field write endpoint without input DTO, role-required-but-no-auth, route-param
   *  mismatch, dangling DTO/entity ref. For production-time correction loop.
   *  Domain Node/Edge → codegen IR input: only type/properties/id are read (position
   *  irrelevant), so boundary cast is safe. */
  private async contractGaps(projectId: string): Promise<string[]> {
    const [nodes, edges] = await Promise.all([this.nodes.list(projectId), this.edges.list(projectId)]);
    return lintContracts(buildCodeGraph(nodes as unknown as StoredNode[], edges as unknown as StoredEdge[]));
  }

  /** Streaming agent loop — atomic create_node/create_edge tool calling.
   *  Yields StreamEvent after each tool execute; encoded to SSE.
   *  Error handling: HttpException response bodies go back to LLM as ToolMessage
   *  → LLM self-corrects (ReAct). Frontend never sees errors,
   *  only final nodes/edges. */
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
        // graphRevision unused in prompt context — placeholder 0.
        { project: { id: projectId } as any, nodes, edges, counts: { nodes: nodes.length, edges: edges.length }, graphRevision: 0 },
        patternHits,
      ) + STREAMING_DIRECTIVE;

    // Agent mode: the high-capability "agent" tier (resolved per active provider).
    const llm = getGenerationChat({ toolCalling: true, tier: "agent" });
    const llmWithTools = llm.bindTools!([
      { name: CREATE_NODE_TOOL_NAME, description: CREATE_NODE_DESCRIPTION, schema: CreateNodeArgsSchema },
      { name: CREATE_EDGE_TOOL_NAME, description: CREATE_EDGE_DESCRIPTION, schema: CreateEdgeArgsSchema },
      // Refactor tools — modify existing graph (not append-only).
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
    // "Continue": previous run paused at step limit. Agent sees the graph above as
    // 'Current Architecture' → do NOT recreate existing nodes,
    // only fill gaps + connect orphans.
    if (input.continueRun) {
      messages.push(new HumanMessage(
        "CONTINUE MODE: The previous run hit the step limit and the architecture is incomplete. The CURRENT graph above ALREADY EXISTS in this project — do NOT recreate those nodes/edges. Only add missing nodes/edges and connect orphaned nodes appropriately. When done, write a brief summary.",
      ));
    }

    const MAX_TURNS = env.AI_MAX_TURNS; // safety ceiling (env, default 250). With batching, typical runs finish in far fewer turns.
    const MAX_CORRECTION_ROUNDS = 2; // orphan check re-trigger
    const MAX_CONTRACT_ROUNDS = 2; // contract-integrity (contract-lint) re-trigger
    let attempts = 0;
    let nodeCount = 0;
    let edgeCount = 0;
    let correctionRounds = 0;
    let contractRounds = 0;
    // Nodes created in this session (for orphan check)
    const createdNodes = new Map<string, { id: string; type: string; name: string }>();
    // Node endpoints appearing in edges (source+target combined)
    const edgeEndpoints = new Set<string>();
    // CIRCUIT BREAKER: impossible/repeated edge attempts must not thrash until MAX_TURNS
    // and burn tokens. Same (source|target|kind) once rejected is NEVER retried;
    // agent stops when consecutive (8) or total (40) failures exceeded (stuck).
    const failedEdgeSigs = new Set<string>();
    let totalToolFailures = 0;
    let consecutiveFailures = 0;
    let stuck = false;
    const MAX_CONSECUTIVE_FAILURES = 8;
    const MAX_TOTAL_FAILURES = 40;

    // On terminal failure (MAX_TURNS / exception / correction limit), delete nodes
    // still orphaned → no half-finished graph; connected subgraph preserved.
    // `self` because `this` is not bound in inline generator. Each delete in try/catch:
    // if one fails, stream keeps flowing (catch-inner delegation stays safe).
    const self = this;
    async function* cleanupOrphans(reason: string): AsyncGenerator<StreamEvent> {
      const orphans = [...createdNodes.values()].filter((n) => !edgeEndpoints.has(n.id));
      for (const o of orphans) {
        try {
          await self.nodes.delete(projectId, o.id);
        } catch (e) {
          // Delete failed → do NOT corrupt state (no removed yield, no count decrement):
          // removing from frontend cache while node remains in DB creates a 'ghost'.
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
        if (signal?.aborted) return; // client disconnected → do not start new LLM turn
        attempts++;
        const ai = (await llmWithTools.invoke(messages, { signal })) as AIMessage;
        const toolCalls = (ai.tool_calls ?? []) as Array<{ id?: string; name: string; args: Record<string, unknown> }>;

        if (toolCalls.length === 0) {
          // LLM stopped calling tools → orphan check (rule-based safety net)
          const orphans = [...createdNodes.values()].filter((n) => !edgeEndpoints.has(n.id));
          if (orphans.length > 0 && correctionRounds < MAX_CORRECTION_ROUNDS) {
            correctionRounds++;
            this.logger.log(
              `[orphan-check] ${orphans.length} orphan nodes detected (round ${correctionRounds}/${MAX_CORRECTION_ROUNDS}). Feeding back to LLM.`,
            );
            const orphanContext = buildOrphanContext(orphans);
            messages.push(ai); // previous "done" attempt into history
            messages.push(new HumanMessage(
              `**ORPHAN_CHECK FAIL** — not complete yet.\n\n` +
                `The following ${orphans.length} nodes are disconnected (orphan). ` +
                `Orphan-node rule requires connecting each to an appropriate node via create_edge:\n\n` +
                orphanContext +
                `\n\nCreate these connections. IMPORTANT: if a node cannot be connected under architecture rules (edge keeps returning ERR_NOT_WHITELISTED/ERR_EDGE_ALREADY_REJECTED), leave it UNCONNECTED and move to your summary — NEVER retry the same rejected edge. If done, write a brief summary.`,
            ));
            continue; // agent loop continues, LLM will call tools again
          }

          // Still orphans after correction limit → clean up (no half-finished graph).
          if (orphans.length > 0) {
            this.logger.warn(
              `[orphan-check] still ${orphans.length} orphans after ${MAX_CORRECTION_ROUNDS} rounds — cleaning up.`,
            );
            yield* cleanupOrphans("orphan-after-correction-limit");
          }

          // ── CONTRACT INTEGRITY (orphan-prevention pattern — prompt alone insufficient):
          //    if generated graph has contract-lint gaps (body-field write endpoint
          //    without input DTO, role-required-but-no-auth, route-param mismatch, dangling
          //    ref) FEED BACK to LLM → create missing DTO + wire to endpoint. Closes
          //    diagram-AI incomplete-contract at production time (codegen still degrades
          //    gracefully but this puts typed contract on the diagram). ──
          if (contractRounds < MAX_CONTRACT_ROUNDS) {
            let gaps: string[] = [];
            try {
              gaps = await this.contractGaps(projectId);
            } catch (e) {
              this.logger.warn(`[contract-check] skipped: ${(e as Error).message}`);
            }
            if (gaps.length > 0) {
              contractRounds++;
              this.logger.log(
                `[contract-check] ${gaps.length} contract gaps (round ${contractRounds}/${MAX_CONTRACT_ROUNDS}). Feeding back to LLM.`,
              );
              messages.push(ai);
              messages.push(new HumanMessage(
                `**CONTRACT_CHECK FAIL** — architecture contract incomplete:\n\n` +
                  gaps.map((g) => `- ${g}`).join("\n") +
                  `\n\nFix each gap. If a body-field write endpoint (POST/PUT/PATCH) lacks an input DTO: create a DTO node with appropriate fields via create_node, then read the Controller with get_node and send the FULL Endpoints array via update_node — ` +
                  `set the endpoint's RequestDTORef to the new DTO's Name. For endpoints requiring a role but not auth, enable RequiresAuth. ` +
                  `If you cannot fix a gap, leave it and write a brief summary.`,
              ));
              continue; // agent loop continues → LLM fixes
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

        if (signal?.aborted) return; // client disconnected → skip tool execute = empty DB writes

        for (const call of toolCalls) {
          if (signal?.aborted) return; // mid-turn abort → stop remaining tool writes
          const callId = call.id ?? `call_${attempts}`;
          try {
            if (call.name === CREATE_NODE_TOOL_NAME) {
              const args = CreateNodeArgsSchema.parse(call.args);
              const node = await this.nodes.create(projectId, {
                type: args.type as NodeKind,
                projectId,
                position: { x: 0, y: 0 }, // frontend arrange writes real position
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
              // Previously REJECTED identical edge → do NOT hit DB/Rules eval;
              // tell LLM firmly "do not retry" + count failure (token savings).
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
              // Read-only — show current properties before editing.
              const args = GetNodeArgsSchema.parse(call.args);
              const node = await this.nodes.getById(projectId, args.nodeId);
              consecutiveFailures = 0;
              messages.push(new ToolMessage({
                content: JSON.stringify({ ok: true, id: node.id, type: node.type, version: node.version, properties: node.properties }),
                tool_call_id: callId,
              }));
            } else if (call.name === UPDATE_NODE_TOOL_NAME) {
              // Modify existing node (rename / field / array). Merge + full validation in service.
              const args = UpdateNodeArgsSchema.parse(call.args);
              const node = await this.nodes.applyPropertiesPatch(projectId, args.nodeId, args.properties);
              consecutiveFailures = 0;
              // Refresh name tracking if a session-created node was updated.
              if (createdNodes.has(node.id)) {
                createdNodes.set(node.id, { id: node.id, type: node.type, name: extractNodeName(node.type, node.properties as Record<string, unknown>) });
              }
              yield { type: "node", data: node }; // frontend upserts node
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
            // INFRA TERMINAL ERROR: if Neo4j driver closed (hot-reload / deploy
            // SIGTERM → driver.close) this error CANNOT be fixed by LLM — pool closed.
            // Counting it as ERR_INTERNAL retry and saying "fix" burns 8-12 LLM turns + tokens,
            // then hits circuit-breaker; cleanup also cannot write to same closed pool. Stop
            // immediately, cleanly: partial graph preserved (same as abort contract), no futile cleanup.
            if (isBackendUnavailable(err)) {
              this.logger.warn(
                `[backend-unavailable] database unreachable during ${call.name} (may be shutting down) — agent stopped immediately; partial graph preserved.`,
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
            // Record rejected edge signature → same edge never hits DB/Rules again.
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

        // CIRCUIT BREAKER: too many (consecutive or total) rule violations/failures →
        // do not keep trying impossible orphans until MAX_TURNS; stop, preserve valid graph.
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES || totalToolFailures >= MAX_TOTAL_FAILURES) {
          this.logger.warn(
            `[circuit-breaker] ${totalToolFailures} tool failures (consecutive ${consecutiveFailures}) — stopping agent (stuck).`,
          );
          stuck = true;
          break;
        }
      }

      if (stuck) {
        // Rule-violation budget (illegal edge thrash): continuing would thrash again →
        // clean orphans + graceful done (NOT resumable).
        yield* cleanupOrphans("rule-failure-budget");
        yield {
          type: "done",
          message: "Architecture created. Some connections could not be made because they violate the architecture rules and were skipped.",
          counts: { nodes: nodeCount, edges: edgeCount },
          attempts,
        };
        return;
      }
      // STEP LIMIT (MAX_TURNS): work unfinished but ceiling reached. Do NOT clean orphans —
      // partial architecture preserved; "Continue" (continueRun) lets agent see current graph and
      // resume. paused event shows "Continue" button in frontend.
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
      // Infra terminal error (closed pool) may also be caught here (e.g. non-LLM
      // Neo4j call). Cleanup futile (pool closed) → DO NOT attempt; clear signal, keep partial graph.
      if (isBackendUnavailable(err)) {
        this.logger.warn(
          "[backend-unavailable] agent stream — database unreachable (may be shutting down); partial graph preserved, cleanup skipped.",
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
      // No half-finished graph — clean orphans. cleanupOrphans swallows each
      // delete internally; still defensive try/catch (second exception must not
      // block error event).
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

/** System prompt appendix for chatStream — shapes agent loop behavior. */
const STREAMING_DIRECTIVE = `

## STREAMING AGENT BEHAVIOR (REQUIRED)
In this mode the architecture is produced in **batched turns**. Be efficient: do as much work per turn as possible.
1. **CALL MULTIPLE TOOLS IN THE SAME TURN (batch — VERY IMPORTANT).** Create related nodes in one turn via parallel create_node calls (e.g. 8-12 nodes per turn). Save returned IDs. Do not call one-by-one; that is slow and burns the turn limit.
2. Once nodes exist with IDs in hand, create edges **in bulk** too: call as many create_edge as possible in one turn. (Each edge's source+target must already exist → edges come in turns AFTER their nodes.)
3. If a tool returns { ok: false, code, message, suggestion }: read the suggestion, fix, **retry the same tool**.
4. After all required nodes and edges are created, write a brief summary for the user (1-2 sentences, respond in English — the product UI is English) — this final message must NOT be a tool call, text only.
5. Do not specify position; backend defaults, frontend auto-layouts.

## MODIFY EXISTING GRAPH (REFACTOR)
Nodes/edges listed in 'Current Canvas State' ALREADY EXIST. If the user wants a CHANGE (rename, delete, edit a field/array, rewire) do NOT recreate them — use these tools:
- **update_node(nodeId, properties)** — modify an existing node (rename, description/flag, edit an array). Send only changed top-level fields; merged onto existing properties. To edit an ARRAY field (Columns/Endpoints/Methods/Fields) FIRST read the full array with \`get_node\`, then send the FULL array (arrays are replaced, not appended).
- **get_node(nodeId)** — read a node's full properties before editing.
- **delete_node(nodeId)** — delete a node (and its edges).
- **delete_edge(edgeId)** — delete a connection. To REROUTE a connection: \`delete_edge(oldId)\` + \`create_edge(new endpoints)\`.
Node ids and edge ids are given in 'Current Canvas State' — use them, do not invent. When done, write a brief summary without tool calls.

## ORPHAN NODE RULE (VERY IMPORTANT)
**NO node may remain disconnected (orphan).** Every node you create must connect to at least one other node via an edge. Track created node IDs — do not say "done" until each has at least one create_edge.

### Correct-direction connection patterns by node type (passive node = edge TARGET, not source):
- **DTO** (target): \`create_edge(source=Controller|Service, target=DTO, kind=USES)\` — request/response payload. DTO is source only in \`DTO→HAS→DTO\` (nested) and \`DTO→USES→Enum\`.
- **Enum** (target): \`create_edge(source=Model|DTO|Table, target=Enum, kind=USES)\`. Enum is NEVER a source.
- **Exception** (target): \`create_edge(source=Service|Controller|Repository, target=Exception, kind=THROWS)\`.
- **EnvironmentVariable** (target): \`create_edge(source=Service, target=EnvironmentVariable, kind=READS_CONFIG)\`.
- **Cache** (target): \`create_edge(source=Service, target=Cache, kind=CACHES_IN)\`.
- **View** (target): \`create_edge(source=Repository, target=View, kind=QUERIES)\`.
- **UIComponent** (target): \`create_edge(source=FrontendApp, target=UIComponent, kind=HAS)\`.
- **Middleware** (source): \`create_edge(source=Middleware, target=Controller, kind=ROUTES_TO)\`.
- **Repository**: target → \`create_edge(source=Service, target=Repository, kind=CALLS)\`; source → \`(source=Repository, target=Table, kind=QUERIES|WRITES)\`, \`(source=Repository, target=Model, kind=USES|RETURNS)\`.
- **Model**: target → \`create_edge(source=Service, target=Model, kind=USES)\`; source → \`Model→USES→Table\`, \`Model→USES→Enum\`, \`Model→HAS|EXTENDS→Model\`.

If you apply these patterns in the WRONG direction the edge is rejected with \`ERR_NOT_WHITELISTED\`.

### FINAL CHECK (required)
Before writing "done": for every node ID you created, did you call at least one create_edge? If not → create missing edges now.

## WARNINGS IN TOOL RESPONSES (TRACK CONTINUOUSLY)
create_node and create_edge results may include a \`warnings\` field:
\`\`\`json
{
  "ok": true, "id": "...", "type": "DTO",
  "warnings": {
    "status": "8 node, 5 edge — 3 nodes still orphan. Add to your todo list, connect when you can.",
    "pendingOrphans": [
      { "id": "abc-123", "type": "Middleware", "name": "JwtAuth", "hint": "create_edge(source=Middleware, target=Controller, kind=ROUTES_TO)" },
      ...
    ]
  }
}
\`\`\`

**Read these warnings after every tool call.** Put \`pendingOrphans\` at the top of your todo list. Connect them at the next opportunity (when you create a related node or directly). Do not forget old orphans while creating new nodes — they are **priority**.`;

/** Thrown when Neo4j driver closed (deploy SIGTERM / dev hot-reload → driver.close).
 *  This error is NOT retryable and CANNOT be fixed by LLM — pool closed.
 *  Tool loop must stop immediately instead of burning tokens on "fix" turns. */
function isBackendUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /pool is closed|driver is closed|connection pool is closed|driver has been closed/i.test(msg);
}

/** Extract response body (code, message, suggestion, ...) from NestJS HttpException. */
function httpExceptionBody(err: unknown): Record<string, unknown> {
  if (err instanceof HttpException) {
    const resp = err.getResponse();
    if (typeof resp === "object" && resp !== null) return resp as Record<string, unknown>;
    return { code: "ERR_HTTP", message: String(resp) };
  }
  if (err instanceof Error) return { code: "ERR_INTERNAL", message: err.message };
  return { code: "ERR_UNKNOWN", message: String(err) };
}

/** Name field key from node type — same NAME_KEYS order as frontend nameOf. */
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

/** Context sent to LLM for orphan node list — suggests connection pattern by type. */
// Passive nodes are edge TARGETs — hints match whitelist direction exactly (reverse
// direction yields ERR_NOT_WHITELISTED). source/target explicitly stated.
const ORPHAN_HINTS: Partial<Record<string, string>> = {
  DTO: "DTO is TARGET: create_edge(source=Controller or Service, target=DTO, kind=USES). DTO is source only in DTO→USES→Enum, DTO→HAS→DTO.",
  Middleware: "Middleware is SOURCE: create_edge(source=Middleware, target=Controller, kind=ROUTES_TO).",
  Enum: "Enum is TARGET (never source): create_edge(source=Model or DTO or Table, target=Enum, kind=USES).",
  Exception: "Exception is TARGET: create_edge(source=Service or Controller or Repository, target=Exception, kind=THROWS).",
  EnvironmentVariable: "EnvironmentVariable is TARGET: create_edge(source=Service, target=EnvironmentVariable, kind=READS_CONFIG).",
  Cache: "Cache is TARGET: create_edge(source=Service, target=Cache, kind=CACHES_IN).",
  Repository: "Repository is BOTH target AND source: create_edge(source=Service, target=Repository, kind=CALLS) + create_edge(source=Repository, target=Table, kind=QUERIES or WRITES).",
  UIComponent: "UIComponent is TARGET: create_edge(source=FrontendApp, target=UIComponent, kind=HAS).",
  Model: "Model: create_edge(source=Service, target=Model, kind=USES) (Model target) + Model→USES→Table, Model→USES→Enum (Model source).",
  View: "View is TARGET: create_edge(source=Repository, target=View, kind=QUERIES).",
};

function buildOrphanContext(orphans: Array<{ id: string; type: string; name: string }>): string {
  return orphans
    .map((o) => {
      const hint = ORPHAN_HINTS[o.type] ?? "Create an edge to a sensible node (CALLS, USES, HAS, etc.).";
      return `- **${o.type}** "${o.name}" (id: ${o.id}) → ${hint}`;
    })
    .join("\n");
}

/** Instruct mode system prompt — graph snapshot + markup instructions. */
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

  return `You are Solarch's lead software architect. You answer questions about the user's current architecture graph clearly, professionally, and concisely (respond in English — the product UI is English).

**NEVER CREATE OR MODIFY NODES.** Only explain the existing graph and guide the user.

## NODE/EDGE REFERENCE MARKUP (REQUIRED)
When referring to a node use this format: \`[[node:NODE_ID|Display Name]]\`
Examples:
- "[[node:abc-12345|Users table]] stores user data."
- "The request first hits [[node:def-67890|AuthController]], then [[node:ghi-13579|AuthService]]."

When referring to an edge: \`[[edge:EDGE_ID|short description]]\`
Example: "Called via [[edge:xyz-456|CALLS connection]]."

**IDs are given in the snapshot below — NEVER invent them, always use these IDs.** Always use markup instead of plain names so the frontend can convert to chips and highlight on the canvas.

## CURRENT ARCHITECTURE SNAPSHOT

### Nodes (${nodes.length})
${JSON.stringify(nodeSnapshot, null, 2)}

### Edges (${edges.length})
${JSON.stringify(edgeSnapshot, null, 2)}

## STYLE
- Short, clear, no jargon (respond in English — the product UI is English).
- You may use markdown headings/lists but don't overdo it.
- Your answer should flow; markers must not break the text (chips appear inline).`;
}

/** Project warning — appended to each tool result. LLM reads this and adds to TODO list
 *  with priority. Proactive not reactive: situational awareness each step instead of
 *  accumulating orphans. */
interface ProjectWarnings {
  status: string; // "10 node, 6 edge — 4 orphans remaining"
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
    // All nodes connected — brief status only (LLM knows it's going well)
    return {
      status: `${nodeCount} node, ${edgeCount} edge — all nodes connected, looking good.`,
      pendingOrphans: [],
    };
  }

  return {
    status: `${nodeCount} node, ${edgeCount} edge — ${orphans.length} nodes still orphan. Add to your todo list, connect when you can.`,
    pendingOrphans: orphans.map((o) => ({
      id: o.id,
      type: o.type,
      name: o.name,
      hint: ORPHAN_HINTS[o.type] ?? "Create an edge to a sensible node (CALLS, USES, HAS, etc.).",
    })),
  };
}
