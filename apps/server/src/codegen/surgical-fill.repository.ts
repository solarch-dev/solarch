import { Injectable } from "@nestjs/common";
import { Neo4jService } from "../neo4j/neo4j.service";

/* ────────────────────────────────────────────────────────────────────────
 * surgical-fill.repository.ts — Surgical AI'ın DOLDURDUĞU algoritma gövdelerini
 * BÖLGE-bazında (projectId, nodeId, member) kalıcı saklar.
 *
 * Constructor modeli: YAPI graftan deterministik türetilir; ALGORİTMA gövdesi ise
 * AI'ın (ya da insanın) yazdığı, türetilemeyen kullanıcı IP'sidir → saklanmalı.
 * Önceden hiç saklanmıyordu (fill yalnız frontend state'inde yaşıyordu) → panel
 * kapanınca/yenileyince uçuyordu. Artık her dolan bölge anında buraya yazılır;
 * generate, bu gövdeleri NOT_IMPLEMENTED yerine geri-enjekte eder.
 * ──────────────────────────────────────────────────────────────────────── */

export interface StoredFill {
  nodeId: string;
  member: string;
  body: string;
  filledAt: string;
}

@Injectable()
export class SurgicalFillRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  /** Bir bölgenin (nodeId#member) dolu gövdesini yaz/üzerine yaz (idempotent).
   *  filledAt re-injection imzasında (@solarch:filled at=…) kullanılır. */
  async upsert(projectId: string, nodeId: string, member: string, body: string, filledAt: string): Promise<void> {
    await this.neo4j.run(
      `MERGE (f:SurgicalFill {projectId:$projectId, nodeId:$nodeId, member:$member})
       SET f.body=$body, f.filledAt=$filledAt, f.updatedAt=$now`,
      { projectId, nodeId, member, body, filledAt, now: new Date().toISOString() },
    );
  }

  /** Projenin tüm saklı gövdeleri — generate re-injection için. */
  async getAllForProject(projectId: string): Promise<StoredFill[]> {
    const r = await this.neo4j.run(
      `MATCH (f:SurgicalFill {projectId:$projectId}) RETURN f`,
      { projectId },
    );
    return r.records.map((rec) => {
      const p = rec.get("f").properties;
      return { nodeId: p.nodeId, member: p.member, body: p.body, filledAt: p.filledAt };
    });
  }

  /** Tüm fill'leri sil (örn. "sıfırdan yeniden üret"). */
  async deleteForProject(projectId: string): Promise<void> {
    await this.neo4j.run(`MATCH (f:SurgicalFill {projectId:$projectId}) DETACH DELETE f`, { projectId });
  }

  /** TEK bir bölgenin (nodeId#member) dolu gövdesini sil — "revert to stub". generate
   *  artık o bölgeyi NOT_IMPLEMENTED iskeletiyle döndürür. Yoksa sessiz (idempotent). */
  async deleteOne(projectId: string, nodeId: string, member: string): Promise<void> {
    await this.neo4j.run(
      `MATCH (f:SurgicalFill {projectId:$projectId, nodeId:$nodeId, member:$member}) DETACH DELETE f`,
      { projectId, nodeId, member },
    );
  }
}
