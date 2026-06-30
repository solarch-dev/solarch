import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ZodValidationPipe as ZodPipe } from "nestjs-zod";
import express from "express";
import request from "supertest";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";
import { AppModule } from "../src/app.module";
import { Neo4jService } from "../src/neo4j/neo4j.service";
import { InternalFilter } from "../src/common/filters/internal.filter";
import { bypassAuth } from "./test-auth";

describe("Health E2E (liveness + readiness)", () => {
  let container: StartedNeo4jContainer;
  let app: INestApplication;
  let neo4j: Neo4jService;

  beforeAll(async () => {
    container = await new Neo4jContainer("neo4j:5-community").withApoc().start();
    neo4j = new Neo4jService({
      uri: container.getBoltUri(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await neo4j.onModuleInit();

    const moduleRef = await bypassAuth(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(Neo4jService)
        .useValue(neo4j),
    ).compile();

    app = moduleRef.createNestApplication();
    app.use(express.json());
    app.useGlobalPipes(new ZodPipe());
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new InternalFilter());
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await neo4j.onModuleDestroy();
    await container.stop();
  });

  it("liveness: GET /health → 200 status ok", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/health").expect(200);
    expect(res.body.data.status).toBe("ok");
  });

  it("readiness: GET /health/ready → 200 status ready (Neo4j up)", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/health/ready").expect(200);
    expect(res.body.data.status).toBe("ready");
  });

  it("readiness: Neo4j down → 503 ERR_NOT_READY", async () => {
    // ping override-throw → readiness 503 (process/liveness etkilenmez).
    const spy = neo4j.ping;
    (neo4j as { ping: () => Promise<void> }).ping = async () => { throw new Error("down"); };
    try {
      const res = await request(app.getHttpServer()).get("/api/v1/health/ready").expect(503);
      expect(res.body.error.code).toBe("ERR_NOT_READY");
// liveness is still 200 (process should not be killed in DB down)
      await request(app.getHttpServer()).get("/api/v1/health").expect(200);
    } finally {
      (neo4j as { ping: typeof spy }).ping = spy;
    }
  });

it("readiness: fast 503 (network partition) with timeout if ping hangs", async () => {
// ping should not resolve at all (partition dropping packet) → controller pingWithTimeout(2s)
// must compete with; The probe should return 503 in ~2s, it should not wait for the 30-60s driver timeout.
    const spy = neo4j.ping;
    (neo4j as { ping: () => Promise<void> }).ping = () => new Promise<void>(() => {});
    const start = Date.now();
    try {
      const res = await request(app.getHttpServer()).get("/api/v1/health/ready").expect(503);
      expect(res.body.error.code).toBe("ERR_NOT_READY");
      expect(Date.now() - start).toBeLessThan(5_000); // 2s timeout + tampon
    } finally {
      (neo4j as { ping: typeof spy }).ping = spy;
    }
  }, 10_000);
});
