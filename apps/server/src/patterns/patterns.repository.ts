import { Injectable } from "@nestjs/common";
import { Neo4jService } from "../neo4j/neo4j.service";
import type { StoredPattern, PatternSummary } from "./schemas/pattern.schema";

export interface PatternSearchHit {
  pattern: StoredPattern;
  score: number;
}

@Injectable()
export class PatternsRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async create(p: StoredPattern, embedding: number[]): Promise<void> {
    await this.neo4j.run(
      `CREATE (p:Pattern {
        id: $id, name: $name, description: $description, tags: $tags,
        graphJson: $graphJson, source: $source,
        createdAt: datetime($createdAt), embedding: $embedding
      })`,
      {
        id: p.id,
        name: p.name,
        description: p.description,
        tags: p.tags,
        graphJson: JSON.stringify(p.graph),
        source: p.source,
        createdAt: p.createdAt,
        embedding,
      },
    );
  }

// SECURITY (inter-tenant BOLA): reading surface canonical 'seed' patterns ONLY
//returns. Since promoted (user) patterns are not stamped to the tenant
// does not leak out of any read path (list/getById/search) + to AI prompt
  // (search RAG) zehirli pattern enjekte edilemez.
  async list(): Promise<PatternSummary[]> {
    const res = await this.neo4j.run(
      `MATCH (p:Pattern {source: 'seed'}) RETURN p ORDER BY p.createdAt DESC`,
    );
    return res.records.map((r) => toSummary(r.get("p").properties));
  }

  async getById(id: string): Promise<StoredPattern | null> {
    const res = await this.neo4j.run(`MATCH (p:Pattern {id: $id, source: 'seed'}) RETURN p`, { id });
    if (res.records.length === 0) return null;
    return toStored(res.records[0].get("p").properties);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.neo4j.run(
      `MATCH (p:Pattern {id: $id}) DELETE p RETURN 1 AS d`,
      { id },
    );
    return res.records.length > 0;
  }

  async findByName(name: string): Promise<boolean> {
    const res = await this.neo4j.run(
      `MATCH (p:Pattern {name: $name}) RETURN p LIMIT 1`,
      { name },
    );
    return res.records.length > 0;
  }

/** Native vector search: cosine top-K + minScore filter. */
  async search(embedding: number[], k: number, minScore: number): Promise<PatternSearchHit[]> {
    const res = await this.neo4j.run(
      `CALL db.index.vector.queryNodes('pattern_embedding', $k, $embedding)
       YIELD node, score
       WHERE node.source = 'seed' AND score >= $minScore
       RETURN node, score ORDER BY score DESC`,
      { k: Math.trunc(k), embedding, minScore },
    );
    return res.records.map((r) => ({
      pattern: toStored(r.get("node").properties),
      score: r.get("score"),
    }));
  }
}

function toStored(p: any): StoredPattern {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    tags: p.tags ?? [],
    graph: JSON.parse(p.graphJson),
    source: p.source,
    createdAt: new Date(p.createdAt).toISOString(),
  };
}

function toSummary(p: any): PatternSummary {
  const g = JSON.parse(p.graphJson);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    tags: p.tags ?? [],
    source: p.source,
    createdAt: new Date(p.createdAt).toISOString(),
    nodeCount: g.nodes.length,
    edgeCount: g.edges.length,
  };
}
