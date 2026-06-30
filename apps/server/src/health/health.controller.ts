import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { ok } from "../common/envelope";
import { Public } from "../auth/public.decorator";
import { Neo4jService } from "../neo4j/neo4j.service";

@ApiTags("Health")
@Controller("health")
// Liveness/readiness probes are called frequently — exempt from rate limiting.
@SkipThrottle()
export class HealthController {
  constructor(private readonly neo4j: Neo4jService) {}

  /** LIVENESS — is the process up. Does NOT touch the DB (avoid killing the process during Neo4j flaps). */
  @Public()
  @Get()
  @ApiOperation({
    summary: "Liveness — is the service up",
    description: "The process is up. `{ status: 'ok', uptime }`. Does not touch the DB (liveness probe).",
  })
  @ApiResponse({ status: 200, description: "`data: { status: 'ok', uptime: <seconds> }`." })
  check() {
    return ok({ status: "ok", uptime: process.uptime() });
  }

  /** READINESS — ready to accept traffic. Connects to Neo4j with a real RETURN 1;
   *  returns 503 if the DB is unreachable (reverse proxy/orchestrator should stop traffic but NOT kill the process). */
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
      // Short timeout: during network partition (packets drop, not refuse) ping would
      // inherit driver timeouts (connectionTimeout 30s / acquisition 60s), leaving the
      // probe hanging 30–60s and holding a pool slot. Probe must fail fast (≤2s).
      await this.pingWithTimeout(2_000);
      return ok({ status: "ready" });
    } catch {
      // {code,message} → InternalFilter wraps in envelope (existing exception pattern).
      throw new ServiceUnavailableException({ code: "ERR_NOT_READY", message: "Neo4j is unreachable." });
    }
  }

  /** Race ping against a time limit — probe returns 503 quickly when DB is unreachable.
   *  (If the race is lost, the underlying query still closes eventually via connectionTimeout.) */
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
