import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { ok } from "../common/envelope";
import { Public } from "../auth/public.decorator";
import { Neo4jService } from "../neo4j/neo4j.service";

@ApiTags("Health")
@Controller("health")
// Liveness/readiness probe'ları sık çağrılır — rate-limit'ten muaf.
@SkipThrottle()
export class HealthController {
  constructor(private readonly neo4j: Neo4jService) {}

  /** LIVENESS — process ayakta mı. DB'ye DOKUNMAZ (Neo4j flap'inde process öldürülmesin). */
  @Public()
  @Get()
  @ApiOperation({
    summary: "Liveness — is the service up",
    description: "The process is up. `{ status: 'ok', uptime }`. Does not touch the DB (liveness probe).",
  })
  @ApiResponse({ status: 200, description: "`data: { status: 'ok', uptime: <saniye> }`." })
  check() {
    return ok({ status: "ok", uptime: process.uptime() });
  }

  /** READINESS — trafik almaya hazır mı. Neo4j'ye gerçek RETURN 1 ile bağlanır;
   *  DB erişilemezse 503 (reverse proxy/orkestratör trafiği kesmeli ama process'i ÖLDÜRMEMELİ). */
  @Public()
  @Get("ready")
  @ApiOperation({
    summary: "Readiness — are the dependencies (Neo4j) ready",
    description: "Real connection check via Neo4j 'RETURN 1'. 200 if ready, 503 if the DB is down.",
  })
  @ApiResponse({ status: 200, description: "`data: { status: 'ready' }`." })
  @ApiResponse({ status: 503, description: "`ERR_NOT_READY` — Neo4j is unreachable." })
  async ready() {
    try {
      // Kısa timeout: ağ partition'ında (paket düşüyor, refuse değil) ping driver
      // timeout'larını (connectionTimeout 30s / acquisition 60s) miras alıp probe'u
      // 30-60s askıda bırakırdı + havuz slotu tutardı. Probe hızlı düşmeli (≤2s).
      await this.pingWithTimeout(2_000);
      return ok({ status: "ready" });
    } catch {
      // {code,message} → InternalFilter envelope'a sarar (mevcut exception deseni).
      throw new ServiceUnavailableException({ code: "ERR_NOT_READY", message: "Neo4j is unreachable." });
    }
  }

  /** ping'i süre sınırıyla yarıştır — DB ulaşılamazken probe hızlı 503 dönsün.
   *  (Yarış kaybedilse de altta süren query connectionTimeout ile sonunda kapanır.) */
  private async pingWithTimeout(ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("ping timeout")), ms);
    });
    try {
      await Promise.race([this.neo4j.ping(), timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
