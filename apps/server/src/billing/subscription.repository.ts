import { Injectable } from "@nestjs/common";
import { Neo4jService } from "../neo4j/neo4j.service";
import type { Plan, Meter } from "./entitlements";

export interface StoredSubscription {
  subjectType: "user" | "org";
  subjectId: string;
  plan: Plan;
  status: string; // active|trialing|past_due|canceled
  polarSubscriptionId: string | null;
  polarCustomerId: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean; // dönem sonunda iptal planlandı mı (erişim dönem sonuna kadar sürer)
}

export interface UsageCounters {
  generations: number;
  edits: number;
  questions: number;
  /** Constructor "Generate Code" ücretsiz önizleme tüketimi (canGenerateCode olmayan
   *  tier'lar 4h'de 1). Frontend gate'i (hasFreeCodegenPreview) bunu okur. */
  codegen: number;
}

@Injectable()
export class SubscriptionRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async get(subjectType: string, subjectId: string): Promise<StoredSubscription | null> {
    const r = await this.neo4j.run(
      `MATCH (s:Subscription {subjectType:$subjectType, subjectId:$subjectId}) RETURN s`,
      { subjectType, subjectId },
    );
    if (!r.records.length) return null;
    const p = r.records[0].get("s").properties;
    return {
      subjectType: p.subjectType,
      subjectId: p.subjectId,
      plan: p.plan,
      status: p.status,
      polarSubscriptionId: p.polarSubscriptionId ?? null,
      polarCustomerId: p.polarCustomerId ?? null,
      currentPeriodEnd: p.currentPeriodEnd ?? null,
      trialEndsAt: p.trialEndsAt ?? null,
      cancelAtPeriodEnd: p.cancelAtPeriodEnd ?? false,
    };
  }

  async upsert(sub: StoredSubscription): Promise<void> {
    await this.neo4j.run(
      `MERGE (s:Subscription {subjectType:$subjectType, subjectId:$subjectId})
       SET s += { plan:$plan, status:$status, polarSubscriptionId:$polarSubscriptionId,
                  polarCustomerId:$polarCustomerId, currentPeriodEnd:$currentPeriodEnd,
                  trialEndsAt:$trialEndsAt, cancelAtPeriodEnd:$cancelAtPeriodEnd, updatedAt:$now }`,
      { ...sub, now: new Date().toISOString() },
    );
  }

  async getUsage(subjectId: string, periodKey: string): Promise<UsageCounters> {
    const r = await this.neo4j.run(
      `MATCH (u:Usage {subjectId:$subjectId, periodKey:$periodKey}) RETURN u`,
      { subjectId, periodKey },
    );
    if (!r.records.length) return { generations: 0, edits: 0, questions: 0, codegen: 0 };
    const p = r.records[0].get("u").properties;
    return {
      generations: Number(p.generations ?? 0),
      edits: Number(p.edits ?? 0),
      questions: Number(p.questions ?? 0),
      codegen: Number(p.codegen ?? 0),
    };
  }

  /** Atomik artış; güncel metre değerini döner. meter sabit union'dan gelir (güvenli). */
  async incrementUsage(subjectId: string, periodKey: string, meter: Meter): Promise<number> {
    const r = await this.neo4j.run(
      `MERGE (u:Usage {subjectId:$subjectId, periodKey:$periodKey})
       ON CREATE SET u.generations=0, u.edits=0, u.questions=0, u.codegen=0
       SET u.\`${meter}\` = coalesce(u.\`${meter}\`,0) + 1, u.updatedAt=$now
       RETURN u.\`${meter}\` AS v`,
      { subjectId, periodKey, now: new Date().toISOString() },
    );
    return Number(r.records[0].get("v"));
  }

  /** Atomik check-and-increment: TEK Cypher'da MERGE + (cap altındaysa) +1.
   *  Yarış koşulu (TOCTOU) yok — oku/kontrol/yaz arası kilitsiz boşluk kalmaz.
   *  Cap aşılmışsa WHERE satırı eler → kayıt dönmez → null. meter sabit union (güvenli).
   *  Döner: yeni sayaç değeri (artış yapıldıysa) ya da null (cap dolu). */
  async tryConsume(
    subjectId: string,
    periodKey: string,
    meter: Meter,
    cap: number,
  ): Promise<number | null> {
    const r = await this.neo4j.run(
      `MERGE (u:Usage {subjectId:$subjectId, periodKey:$periodKey})
       ON CREATE SET u.generations=0, u.edits=0, u.questions=0, u.codegen=0
       WITH u, coalesce(u.\`${meter}\`,0) AS cur
       WHERE cur < $cap
       SET u.\`${meter}\` = cur + 1, u.updatedAt=$now
       RETURN u.\`${meter}\` AS v`,
      { subjectId, periodKey, cap, now: new Date().toISOString() },
    );
    if (!r.records.length) return null;
    return Number(r.records[0].get("v"));
  }

  /** Metreyi geri ver (refund) — başarısız üretimde tüketilen kotayı iade eder.
   *  0'ın altına düşmez (idempotent çift-refund'a karşı güvenli). meter sabit union. */
  async refundUsage(subjectId: string, periodKey: string, meter: Meter): Promise<number> {
    const r = await this.neo4j.run(
      `MATCH (u:Usage {subjectId:$subjectId, periodKey:$periodKey})
       SET u.\`${meter}\` = CASE WHEN coalesce(u.\`${meter}\`,0) > 0
                                 THEN u.\`${meter}\` - 1 ELSE 0 END,
           u.updatedAt=$now
       RETURN u.\`${meter}\` AS v`,
      { subjectId, periodKey, now: new Date().toISOString() },
    );
    if (!r.records.length) return 0;
    return Number(r.records[0].get("v"));
  }
}
