import { Body, Controller, Param, Post, HttpCode, Sse, Query, Req, UseGuards, type MessageEvent } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ProjectAccessGuard } from "../auth/project-access.guard";
import { from, type Observable } from "rxjs";
import { map } from "rxjs/operators";
import { AiService } from "./ai.service";
import { AiIdempotencyStore } from "./ai-idempotency.store";
import { CurrentAuth } from "../auth/current-auth.decorator";
import type { AuthContext } from "../auth/auth.types";
import { ChatDto, MAX_MESSAGE_CHARS, MAX_HISTORY_ITEMS } from "./dto/chat.dto";
import { ok } from "../common/envelope";
import type { ChatResponse, StreamEvent } from "./dto/chat-response.dto";
import type { ChatInput } from "./dto/chat.dto";

@ApiTags("AI Agent")
@UseGuards(ProjectAccessGuard)
// AI endpoints are expensive: 20 req/min per user (stricter than global 60).
@Throttle({ default: { ttl: 60_000, limit: 20 } })
@Controller("projects/:projectId/ai")
export class AiController {
  constructor(
    private readonly service: AiService,
    private readonly idem: AiIdempotencyStore,
  ) {}

  @Post("chat")
  @HttpCode(200)
  @ApiOperation({
    summary: "Chat with the AI architect (generate architecture)",
    description:
      "Passes the natural-language request to the 'Chief Software Architect' AI. The AI sees the current graph (current_graph), " +
      "generates architecture via atomic `create_node` / `create_edge` tools, and **self-corrects** on Rules Engine violations " +
      "(ReAct self-correction, max 3 attempts). Generation: Bedrock/Claude, tool calling.\n\n" +
      "Response: `{ reply, applied?: {idMap, nodeCount, edgeCount}, attempts }`. " +
      "If `applied` is populated, the architecture has been added to the canvas.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "AI response + (if any) the applied architecture." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  @ApiResponse({ status: 503, description: "`ERR_AI_NOT_CONFIGURED` — LLM API key missing." })
  async chat(
    @Param("projectId") projectId: string,
    @Body() body: ChatDto,
    @CurrentAuth() _auth: AuthContext,
  ): Promise<ChatResponse> {
    const result = await this.service.chat(projectId, body as any);
    return ok(result);
  }

  @Sse("chat/stream")
  @ApiOperation({
    summary: "AI architect — streaming (SSE, atomic create_node/create_edge tool agent loop)",
    description:
      "Opens an EventSource connection. The AI creates each node/edge one by one with the `create_node`/`create_edge` tools; " +
      "the backend pushes an SSE event after each tool execution. Event types:\n" +
      "- `event: node` — created node ({id, type, properties, ...})\n" +
      "- `event: edge` — created edge\n" +
      "- `event: done` — completed ({message, counts, attempts})\n" +
      "- `event: error` — error ({code, message})\n\n" +
      "GET is used (EventSource native limitation). history is a JSON-encoded query param.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  chatStream(
    @Param("projectId") projectId: string,
    @Query("message") message: string,
    @CurrentAuth() _auth: AuthContext,
    @Req() req: { on(event: "close", cb: () => void): void },
    @Query("tabId") tabId?: string,
    @Query("history") historyJson?: string,
    @Query("mode") mode?: string,
    @Query("requestId") requestId?: string,
    @Query("continue") cont?: string,
  ): Observable<MessageEvent> {
    const history = historyJson ? safeParseHistory(historyJson) : [];
    const safeMode: "agent" | "instruct" = mode === "instruct" ? "instruct" : "agent";
    const input: ChatInput = { message, tabId, history, mode: safeMode, continueRun: cont === "true" };
    const self = this;

    // On client disconnect (tab closed / abort / network drop) stop in-flight LLM
    // calls and DB writes → avoid wasted cost + stray data.
    const ac = new AbortController();
    req.on("close", () => ac.abort());

    async function* guarded(): AsyncGenerator<StreamEvent> {
      // Raw SSE query bypasses DTO validation — bound input here.
      if (!message || message.length > MAX_MESSAGE_CHARS || history.length > MAX_HISTORY_ITEMS) {
        yield { type: "error", code: "ERR_SCHEMA_INVALID", message: "Invalid or too long input." } as StreamEvent;
        return;
      }
      // Idempotency: same requestId (reconnect / double submit) must not re-run
      // generation → duplicate nodes.
      if (requestId && !self.idem.tryAcquire(requestId)) {
        yield {
          type: "error",
          code: "ERR_DUPLICATE_REQUEST",
          message: "This request is already being processed (duplicate connection ignored).",
        } as StreamEvent;
        return;
      }
      try {
        for await (const event of self.service.chatStream(projectId, input, ac.signal)) {
          yield event;
        }
      } catch (e) {
        const r = (e as { getResponse?: () => { code?: string; message?: string } }).getResponse?.() ?? {};
        yield { type: "error", code: r.code ?? "ERR_AI_FAILED", message: r.message ?? "AI request failed." } as StreamEvent;
      }
    }
    return from(guarded()).pipe(
      map((event: StreamEvent) => {
        // Flatten payload: type in SSE header; data is bare payload.
        // Frontend JSON.parse(e.data) gets node/edge/payload directly.
        switch (event.type) {
          case "node":
          case "edge":
          case "removed":
            return { data: event.data, type: event.type };
          case "text-delta":
            return { data: { delta: event.delta }, type: "text-delta" };
          case "done":
            return {
              data: { message: event.message, counts: event.counts, attempts: event.attempts },
              type: "done",
            };
          case "paused":
            return {
              data: { code: event.code, message: event.message, counts: event.counts, attempts: event.attempts },
              type: "paused",
            };
          case "error":
            return { data: { code: event.code, message: event.message }, type: "error" };
        }
      }),
    );
  }
}

function safeParseHistory(json: string): Array<{ role: "user" | "assistant"; content: string }> {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}
