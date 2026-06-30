import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Polar webhook imza+Zod doğrulamasını mock'la: e2e controller→service akışına odaklanır,
// SDK'nın katı payload Zod şemasının tüm alanlarını e2e'de üretmek kırılgan olur.
// "valid" body → parsed event döner; "invalid" body → WebhookVerificationError.
class WebhookVerificationError extends Error {}
vi.mock("@polar-sh/sdk/dist/commonjs/webhooks.js", () => ({
  WebhookVerificationError,
  validateEvent: (body: string | Buffer) => {
    const parsed = JSON.parse(body.toString());
    if (parsed.__invalid) throw new WebhookVerificationError("bad signature");
    return parsed;
  },
}));
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ZodValidationPipe as ZodPipe } from "nestjs-zod";
import request from "supertest";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";
import { AppModule } from "../src/app.module";
import { Neo4jService } from "../src/neo4j/neo4j.service";
import { SchemaErrorFilter } from "../src/common/filters/schema-error.filter";
import { NotFoundFilter } from "../src/common/filters/not-found.filter";
import { ConflictFilter } from "../src/common/filters/conflict.filter";
import { InternalFilter } from "../src/common/filters/internal.filter";
import { PaymentRequiredFilter } from "../src/common/filters/payment-required.filter";
import { bypassAuth, TEST_AUTH } from "./test-auth";

/** Billing e2e — webhook (imza), entitlement, proje cap (402). TEST_AUTH.userId = subject. */
describe("Billing E2E", () => {
  let container: StartedNeo4jContainer;
  let app: INestApplication;
  let neo4j: Neo4jService;
  const base = "/api/v1";

  beforeAll(async () => {
    container = await new Neo4jContainer("neo4j:5-community").withApoc().start();
    neo4j = new Neo4jService({
      uri: container.getBoltUri(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await neo4j.onModuleInit();
    await neo4j.run("CREATE CONSTRAINT node_id_unique IF NOT EXISTS FOR (n:Node) REQUIRE n.id IS UNIQUE");
    await neo4j.run("CREATE CONSTRAINT project_id_unique IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE");
    await neo4j.run("CREATE CONSTRAINT tab_id_unique IF NOT EXISTS FOR (t:Tab) REQUIRE t.id IS UNIQUE");
    await neo4j.run("CREATE CONSTRAINT subscription_subject_unique IF NOT EXISTS FOR (s:Subscription) REQUIRE (s.subjectType, s.subjectId) IS UNIQUE");

    const moduleRef = await bypassAuth(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(Neo4jService)
        .useValue(neo4j),
    ).compile();

    // rawBody:true → webhook req.rawBody dolar (Nest default parser raw'ı yakalar).
    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ZodPipe());
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(
      new InternalFilter(),
      new PaymentRequiredFilter(),
      new ConflictFilter(),
      new NotFoundFilter(),
      new SchemaErrorFilter(),
    );
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await neo4j?.onModuleDestroy();
    await container?.stop();
  });

  beforeEach(async () => {
    await neo4j.run("MATCH (n) DETACH DELETE n");
  });

  // Mock'lanan validateEvent body'yi JSON.parse edip aynen döner.
  const webhookBody = (
    data: Record<string, unknown>,
    type = "subscription.created",
    invalid = false,
  ) => JSON.stringify({ type, data, __invalid: invalid });

  const buildSub = {
    id: "sub_1", customerId: "ctm_1", status: "active",
    productId: "prod_build",
    customer: { externalId: TEST_AUTH.userId },
    metadata: { clerkUserId: TEST_AUTH.userId },
    currentPeriodEnd: "2026-07-01T00:00:00.000Z",
  };

  it("abonelik yokken plan free, AI kapalı", async () => {
    const res = await request(app.getHttpServer()).get(`${base}/billing/subscription`).expect(200);
    expect(res.body.data.plan).toBe("free");
    expect(res.body.data.entitlements.canUseAI).toBe(false);
  });

  it("imzalı build webhook → plan build, AI açık", async () => {
    await request(app.getHttpServer())
      .post(`${base}/billing/webhook`).set("webhook-signature", "v1,sig")
      .set("content-type", "application/json").send(webhookBody(buildSub)).expect(200);

    const res = await request(app.getHttpServer()).get(`${base}/billing/subscription`).expect(200);
    expect(res.body.data.plan).toBe("build");
    expect(res.body.data.entitlements.canUseAI).toBe(true);
    expect(res.body.data.meters.questions).toBe(200);
  });

  it("imzasız webhook → ok:false, plan değişmez", async () => {
    await request(app.getHttpServer())
      .post(`${base}/billing/webhook`).set("webhook-signature", "v1,bad")
      .set("content-type", "application/json")
      .send(webhookBody(buildSub, "subscription.created", true))
      .expect(200).expect((r) => expect(r.body.ok).toBe(false));
    const res = await request(app.getHttpServer()).get(`${base}/billing/subscription`).expect(200);
    expect(res.body.data.plan).toBe("free");
  });

  it("proje cap dolu → 402 ERR_PLAN_LIMIT", async () => {
    // build aboneliği (cap 25) + 25 mevcut proje seed
    await neo4j.run(
      `MERGE (s:Subscription {subjectType:'user', subjectId:$uid})
       SET s.plan='build', s.status='active'`,
      { uid: TEST_AUTH.userId },
    );
    await neo4j.run(
      `UNWIND range(1,25) AS i
       CREATE (p:Project {id: randomUUID(), name:'P'+i, description:'', status:'draft',
         ownerId:$uid, orgId:null, createdAt: datetime(), updatedAt: datetime()})`,
      { uid: TEST_AUTH.userId },
    );
    const res = await request(app.getHttpServer())
      .post(`${base}/projects`).send({ name: "Aşan", description: "", status: "draft" })
      .expect(402);
    expect(res.body.error.code).toBe("ERR_PLAN_LIMIT");
  });
});
