import { Injectable } from "@nestjs/common";

/** SSE `chat/stream` duplicate-trigger protection.
 *
 *  When an EventSource connection drops, the browser may reopen the same URL
 *  (auto-reconnect) or the user may double-submit quickly. If the same
 *  `requestId` arrives again, generation reruns and creates duplicate nodes. This store "claims" the first seen requestId for the TTL
 *  and rejects repeats.
 *
 *  In-memory, single-instance only. Move to Redis when deploying multi-instance
 *  (single-box launch is sufficient for now). */
@Injectable()
export class AiIdempotencyStore {
  private readonly seen = new Map<string, number>(); // requestId → expiry (epoch ms)
  private readonly ttlMs = 5 * 60_000;
  private readonly maxKeys = 10_000; // cap against pathological growth

  /** Returns `true` on first sight (claimed). Returns `false` if seen again within TTL. */
  tryAcquire(key: string): boolean {
    const now = Date.now();
    this.sweep(now);
    const exp = this.seen.get(key);
    if (exp !== undefined && exp > now) return false;
    this.seen.set(key, now + this.ttlMs);
    return true;
  }

  private sweep(now: number): void {
    if (this.seen.size === 0) return;
    for (const [k, exp] of this.seen) {
      if (exp <= now) this.seen.delete(k);
    }
    if (this.seen.size > this.maxKeys) {
      const excess = this.seen.size - this.maxKeys;
      let i = 0;
      for (const k of this.seen.keys()) {
        if (i++ >= excess) break;
        this.seen.delete(k);
      }
    }
  }
}
