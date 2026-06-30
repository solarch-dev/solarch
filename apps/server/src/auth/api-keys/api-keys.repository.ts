import { Injectable } from "@nestjs/common";
import { Neo4jService } from "../../neo4j/neo4j.service";

/** API anahtarı kaydı — anahtarın kendisi ASLA saklanmaz, yalnız SHA-256 hash'i.
 *  prefix (slk_ + ilk 6 karakter) listede "hangi anahtar" tanıma içindir. */
export interface StoredApiKey {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

@Injectable()
export class ApiKeysRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async create(key: StoredApiKey & { hash: string }): Promise<void> {
    await this.neo4j.run(
      `CREATE (k:ApiKey {
         id: $id, userId: $userId, name: $name, prefix: $prefix,
         hash: $hash, createdAt: $createdAt, lastUsedAt: null
       })`,
      { ...key },
    );
  }

  async listByUser(userId: string): Promise<StoredApiKey[]> {
    const r = await this.neo4j.run(
      `MATCH (k:ApiKey {userId: $userId}) RETURN k ORDER BY k.createdAt DESC`,
      { userId },
    );
    return r.records.map((rec) => {
      const p = rec.get("k").properties;
      return {
        id: p.id,
        userId: p.userId,
        name: p.name,
        prefix: p.prefix,
        createdAt: p.createdAt,
        lastUsedAt: p.lastUsedAt ?? null,
      };
    });
  }

  /** Hash ile arama — anahtar yüksek entropili olduğundan exact-match yeterli. */
  async findByHash(hash: string): Promise<StoredApiKey | null> {
    const r = await this.neo4j.run(`MATCH (k:ApiKey {hash: $hash}) RETURN k`, { hash });
    if (!r.records.length) return null;
    const p = r.records[0].get("k").properties;
    return {
      id: p.id,
      userId: p.userId,
      name: p.name,
      prefix: p.prefix,
      createdAt: p.createdAt,
      lastUsedAt: p.lastUsedAt ?? null,
    };
  }

  /** Sahiplik koşullu silme — başkasının anahtarı silinemez (BOLA). */
  async deleteOwned(id: string, userId: string): Promise<boolean> {
    const r = await this.neo4j.run(
      `MATCH (k:ApiKey {id: $id, userId: $userId}) DELETE k RETURN count(*) AS n`,
      { id, userId },
    );
    return (r.records[0]?.get("n")?.toNumber?.() ?? r.records[0]?.get("n") ?? 0) > 0;
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.neo4j.run(
      `MATCH (k:ApiKey {id: $id}) SET k.lastUsedAt = $now`,
      { id, now: new Date().toISOString() },
    );
  }
}
