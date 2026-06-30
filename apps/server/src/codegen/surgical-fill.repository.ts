import { Injectable } from "@nestjs/common";
import { Neo4jService } from "../neo4j/neo4j.service";

/* ────────────────────────────────────────────────────────────────────────
 * surgical-fill.repository.ts — Persist algorithm bodies filled by Surgical AI
 * by REGION (projectId, nodeId, member).
 *
 * Constructor model: STRUCTURE derived deterministically from graph; ALGORITHM body is
 * user IP written by AI (or human), not derivable -> must be stored. Previously never
 * stored (fill lived only in frontend state) -> lost on panel close/refresh. Now every
 * filled region writes here immediately; generate re-injects these bodies instead of NOT_IMPLEMENTED.
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

  /** Write/overwrite filled body for a region (nodeId#member) (idempotent).
   *  filledAt used in re-injection signature (@solarch:filled at=…). */
  async upsert(projectId: string, nodeId: string, member: string, body: string, filledAt: string): Promise<void> {
    await this.neo4j.run(
      `MERGE (f:SurgicalFill {projectId:$projectId, nodeId:$nodeId, member:$member})
       SET f.body=$body, f.filledAt=$filledAt, f.updatedAt=$now`,
      { projectId, nodeId, member, body, filledAt, now: new Date().toISOString() },
    );
  }

  /** All stored bodies for project — for generate re-injection. */
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

  /** Delete all fills (e.g. "regenerate from scratch"). */
  async deleteForProject(projectId: string): Promise<void> {
    await this.neo4j.run(`MATCH (f:SurgicalFill {projectId:$projectId}) DETACH DELETE f`, { projectId });
  }

  /** Delete filled body for ONE region (nodeId#member) — "revert to stub". generate
   *  then returns NOT_IMPLEMENTED skeleton for that region. Silent if missing (idempotent). */
  async deleteOne(projectId: string, nodeId: string, member: string): Promise<void> {
    await this.neo4j.run(
      `MATCH (f:SurgicalFill {projectId:$projectId, nodeId:$nodeId, member:$member}) DETACH DELETE f`,
      { projectId, nodeId, member },
    );
  }
}
