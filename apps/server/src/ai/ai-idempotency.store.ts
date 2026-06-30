import { Injectable } from "@nestjs/common";

/** SSE `chat/stream` çift-tetiklenme koruması.
 *
 *  EventSource bağlantısı koptuğunda tarayıcı aynı URL'i yeniden açabilir
 *  (auto-reconnect) ya da kullanıcı hızlı çift gönderim yapabilir. Aynı
 *  `requestId` ikinci kez gelirse generation yeniden çalışıp **çift fatura +
 *  çift node** yaratır. Bu store ilk görülen requestId'yi TTL boyunca
 *  "sahiplenir"; tekrarları reddeder.
 *
 *  Bellek-içi, tek instance içindir. Çok-instance deploy'a geçilirse Redis'e
 *  taşınır (launch tek kutu — yeterli). */
@Injectable()
export class AiIdempotencyStore {
  private readonly seen = new Map<string, number>(); // requestId → expiry (epoch ms)
  private readonly ttlMs = 5 * 60_000;
  private readonly maxKeys = 10_000; // patolojik büyümeye karşı tavan

  /** İlk görülüşte `true` döner (sahiplenildi). TTL içinde tekrar gelirse `false`. */
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
