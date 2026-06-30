import { Body, Controller, Param, Post, HttpCode, Sse, Query, Req, UseGuards, type MessageEvent } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ProjectAccessGuard } from "../auth/project-access.guard";
import { from, type Observable } from "rxjs";
import { map } from "rxjs/operators";
import { AiService } from "./ai.service";
import { AiIdempotencyStore } from "./ai-idempotency.store";
import { BillingService } from "../billing/billing.service";
import type { Meter } from "../billing/entitlements";
import { CurrentAuth } from "../auth/current-auth.decorator";
import type { AuthContext } from "../auth/auth.types";
import { ChatDto, MAX_MESSAGE_CHARS, MAX_HISTORY_ITEMS } from "./dto/chat.dto";
import { ok } from "../common/envelope";
import type { ChatResponse, StreamEvent } from "./dto/chat-response.dto";
import type { ChatInput } from "./dto/chat.dto";

@ApiTags("AI Agent")
@UseGuards(ProjectAccessGuard)
// AI uçları pahalı: kullanıcı başına 20 istek/dk (global 60'tan sıkı).
@Throttle({ default: { ttl: 60_000, limit: 20 } })
@Controller("projects/:projectId/ai")
export class AiController {
  constructor(
    private readonly service: AiService,
    private readonly billing: BillingService,
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
    @CurrentAuth() auth: AuthContext,
  ): Promise<ChatResponse> {
    const meter = (body as { mode?: string }).mode === "instruct" ? "questions" : "generations";
    await this.billing.consume(auth.userId, meter); // 402 ERR_PLAN_AI / ERR_PLAN_METER
    // Metre LLM'den ÖNCE tüketildi. Üretim tamamen başarısızsa (exception ya da
    // hiçbir şey uygulanmadı → applied=null) tüketilen kotayı geri ver (refund).
    // Başarı yolu hiç dokunulmadan bırakılır.
    let result: Awaited<ReturnType<AiService["chat"]>>;
    try {
      result = await this.service.chat(projectId, body as any);
    } catch (e) {
      await this.refundQuietly(auth.userId, meter);
      throw e;
    }
    if (!result.applied) {
      await this.refundQuietly(auth.userId, meter);
    }
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
    @CurrentAuth() auth: AuthContext,
    @Req() req: { on(event: "close", cb: () => void): void },
    @Query("tabId") tabId?: string,
    @Query("history") historyJson?: string,
    @Query("mode") mode?: string,
    @Query("requestId") requestId?: string,
    @Query("continue") cont?: string,
  ): Observable<MessageEvent> {
    const history = historyJson ? safeParseHistory(historyJson) : [];
    const safeMode: "agent" | "instruct" = mode === "instruct" ? "instruct" : "agent";
    const meter = safeMode === "instruct" ? "questions" : "generations";
    const input: ChatInput = { message, tabId, history, mode: safeMode, continueRun: cont === "true" };
    const self = this;

    // Client kopunca (sekme kapandı / abort butonu / ağ koptu) in-flight LLM
    // çağrısını ve DB yazımlarını durdur → boş yere para + veri yazılmasın.
    const ac = new AbortController();
    req.on("close", () => ac.abort());

    // Plan/metre kontrolü generator'ın ilk adımında; aşılırsa SSE 'error' event'i.
    async function* guarded(): AsyncGenerator<StreamEvent> {
      // SSE ham query → DTO doğrulamasını baypas eder; girişi burada sınırla.
      if (!message || message.length > MAX_MESSAGE_CHARS || history.length > MAX_HISTORY_ITEMS) {
        yield { type: "error", code: "ERR_SCHEMA_INVALID", message: "Invalid or too long input." } as StreamEvent;
        return;
      }
      // Idempotency: aynı requestId (reconnect / çift gönderim) generation'ı
      // yeniden çalıştırıp çift fatura + çift node yaratmasın.
      if (requestId && !self.idem.tryAcquire(requestId)) {
        yield {
          type: "error",
          code: "ERR_DUPLICATE_REQUEST",
          message: "This request is already being processed (duplicate connection ignored).",
        } as StreamEvent;
        return;
      }
      try {
        await self.billing.consume(auth.userId, meter);
      } catch (e) {
        const r = (e as { getResponse?: () => { code?: string; message?: string } }).getResponse?.() ?? {};
        yield { type: "error", code: r.code ?? "ERR_PLAN_AI", message: r.message ?? "Plan limit exceeded." } as StreamEvent;
        return;
      }
      // Metre LLM'den ÖNCE tüketildi. Üretim TAMAMEN başarısızsa kullanıcıya hiçbir
      // değer dönmeden tüketilen kotayı bir kez geri ver (refund). Çift-refund olmaz
      // (refunded bayrağı + repo 0'ın altına düşmez). "Değer döndü" sayılan haller refund
      // ETMEZ: node/edge üretildi, ya da text yanıtı geldi (instruct), ya da temiz
      // done/paused event'i (agent işini bitirdi/duraksattı). Yalnız error + tek bir şey
      // üretmeden biten abort refund alır.
      let served = false;
      let refunded = false;
      const refundIfTotalFailure = async () => {
        if (!served && !refunded) {
          refunded = true;
          await self.refundQuietly(auth.userId, meter);
        }
      };
      try {
        for await (const event of self.service.chatStream(projectId, input, ac.signal)) {
          if (event.type === "node" || event.type === "edge" || event.type === "text-delta") served = true;
          if (event.type === "done" || event.type === "paused") served = true;
          if (event.type === "error") await refundIfTotalFailure();
          yield event;
        }
        // Generator hiç done/error yield etmeden bitti (örn. client abort → sessiz return):
        // kullanıcıya değer dönmediyse refund.
        await refundIfTotalFailure();
      } catch (e) {
        await refundIfTotalFailure();
        throw e;
      }
    }
    return from(guarded()).pipe(
      map((event: StreamEvent) => {
        // Payload'ı düzleştir: type SSE header'da; data sadece çıplak payload.
        // Frontend JSON.parse(e.data) doğrudan node/edge/payload alır.
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

  /** Refund'u sessizce yap — refund'un kendisi başarısız olursa asıl yanıtı/hatayı
   *  bastırma (best-effort iade; logla, yut). */
  private async refundQuietly(userId: string, meter: Meter): Promise<void> {
    try {
      await this.billing.refund(userId, meter);
    } catch {
      // best-effort: iade başarısızlığı kullanıcı akışını bozmamalı.
    }
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
