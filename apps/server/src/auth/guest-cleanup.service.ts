import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Neo4jService } from "../neo4j/neo4j.service";
import { env } from "../config/env";
import { GUEST_PREFIX } from "./guest-token";

/** Sahipsiz misafir verisi temizliği: claim edilmeden bırakılan guest_* projeleri
 *  son dokunuştan GUEST_RETENTION_DAYS sonra alt verileriyle (node + tab) silinir.
 *  Boot'ta bir kez + 24 saatte bir çalışır; test ortamında devre dışı. */
@Injectable()
export class GuestCleanupService implements OnModuleInit, OnModuleDestroy {
  private static readonly RETENTION_DAYS = 14;
  private static readonly SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

  private readonly logger = new Logger(GuestCleanupService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly neo4j: Neo4jService) {}

  onModuleInit(): void {
    if (env.NODE_ENV === "test") return;
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), GuestCleanupService.SWEEP_INTERVAL_MS);
    // Interval açık kaldı diye process kapanışı beklemesin.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Süresi dolmuş misafir projelerini id bazında bulup tek tek kaskad siler.
   *  (Proje başına ayrı sorgu: az hacim + node/tab kardinalite çarpımı derdi yok.) */
  async sweep(): Promise<number> {
    try {
      const stale = await this.neo4j.run(
        `MATCH (p:Project)
         WHERE p.ownerId STARTS WITH $prefix
           AND p.updatedAt < datetime() - duration({days: $days})
         RETURN p.id AS id LIMIT 500`,
        { prefix: GUEST_PREFIX, days: GuestCleanupService.RETENTION_DAYS },
      );
      const ids = stale.records.map((r) => r.get("id") as string);
      for (const id of ids) {
        await this.neo4j.run(
          `MATCH (p:Project {id: $id})
           WITH p
           OPTIONAL MATCH (n:Node {projectId: $id})
           DETACH DELETE n
           WITH DISTINCT p
           OPTIONAL MATCH (t:Tab {projectId: $id})
           DETACH DELETE t
           WITH DISTINCT p
           DETACH DELETE p`,
          { id },
        );
      }
      if (ids.length > 0) this.logger.log(`Misafir temizliği: ${ids.length} eski proje silindi.`);
      return ids.length;
    } catch (err) {
      // Temizlik hatası uygulamayı etkilemesin — sonraki turda tekrar denenir.
      this.logger.warn(`Misafir temizliği başarısız: ${err instanceof Error ? err.message : err}`);
      return 0;
    }
  }
}
