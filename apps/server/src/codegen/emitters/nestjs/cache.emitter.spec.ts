import { describe, it, expect } from "vitest";
import { emitCache } from "./cache.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";

/* ── Fixture yardımcıları ──────────────────────────────────────────────── */
const PROJECT = "00000000-0000-4000-8000-000000000000";
const TAB = "22222222-2222-4222-8222-222222222222";
const CACHE = "33333333-3333-4333-8333-333333333333";

function cacheNode(properties: Record<string, unknown>, id = CACHE): StoredNode {
  return {
    id,
    type: "Cache",
    projectId: PROJECT,
    positionX: 0,
    positionY: 0,
    homeTabId: TAB,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    properties,
  };
}

function ctxFor(...nodes: StoredNode[]): { ctx: EmitterContext } {
  const graph = buildCodeGraph(nodes, []);
  return { ctx: { graph, target: "nestjs" } };
}

const DYNAMIC = {
  CacheName: "ImageResultCache",
  Description: "Üretilen görsel sonuçlarını önbellekler",
  KeyPattern: "image:result:{id}",
  TTL_Seconds: 3600,
  Engine: "Redis",
};

const STATIC = {
  CacheName: "ConfigCache",
  Description: "Uygulama konfigürasyonu önbelleği",
  KeyPattern: "app:config",
  TTL_Seconds: 60,
  Engine: "Memory",
};

describe("emitCache", () => {
  it("dinamik anahtar (KeyPattern yer tutuculu) — snapshot", () => {
    const node = cacheNode(DYNAMIC);
    const { ctx } = ctxFor(node);
    const [file] = emitCache(ctx.graph.byId(node.id)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "import { CACHE_MANAGER } from "@nestjs/cache-manager";
      import { Inject, Injectable } from "@nestjs/common";
      import type { Cache } from "cache-manager";

      /**
       * Üretilen görsel sonuçlarını önbellekler
       *
       * Engine: Redis · TTL: 3600s · KeyPattern: image:result:{id}
       */
      @Injectable()
      export class ImageResultCache {
        /** Default TTL (cache-manager expects milliseconds). */
        private static readonly TTL_MS = 3600000;
        /** Key template (Cache.KeyPattern). */
        private static readonly KEY_PATTERN = "image:result:{id}";

        constructor(
          @Inject(CACHE_MANAGER) private readonly cache: Cache,
        ) {}

        /** Replaces the first \`{...}\` placeholder in KeyPattern with the suffix. */
        private buildKey(suffix: string | number): string {
          return ImageResultCache.KEY_PATTERN.replace(/\\{[^}]*\\}/, String(suffix));
        }

        async get<T>(suffix: string | number): Promise<T | null> {
          return this.cache.get<T>(this.buildKey(suffix));
        }

        async set<T>(suffix: string | number, value: T, ttlSeconds?: number): Promise<void> {
          const ttl = ttlSeconds !== undefined ? ttlSeconds * 1000 : ImageResultCache.TTL_MS;
          await this.cache.set(this.buildKey(suffix), value, ttl);
        }

        async del(suffix: string | number): Promise<void> {
          await this.cache.del(this.buildKey(suffix));
        }
      }
      ",
        "language": "typescript",
        "path": "common/image-result.cache.ts",
        "surgicalMarkers": 0,
      }
    `);
  });

  it("sabit anahtar (yer tutucu yok) — get/set/del parametresiz", () => {
    const node = cacheNode(STATIC);
    const { ctx } = ctxFor(node);
    const [file] = emitCache(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain("private buildKey(): string {");
    expect(file.content).toContain("async get<T>(): Promise<T | null> {");
    expect(file.content).toContain("async set<T>(value: T, ttlSeconds?: number): Promise<void> {");
    expect(file.content).toContain("async del(): Promise<void> {");
    expect(file.content).not.toContain("suffix");
  });

  it("dosya yolu: Cache rol eki düşer, base kebab + .cache.ts", () => {
    const node = cacheNode(DYNAMIC);
    const { ctx } = ctxFor(node);
    const [file] = emitCache(ctx.graph.byId(node.id)!, ctx);
    expect(file.path).toBe("common/image-result.cache.ts");
  });

  it("TTL_Seconds ms'e çevrilir (saniye*1000) ve sınıf @Injectable", () => {
    const node = cacheNode(DYNAMIC);
    const { ctx } = ctxFor(node);
    const [file] = emitCache(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain("private static readonly TTL_MS = 3600000;");
    expect(file.content).toContain("@Injectable()");
    expect(file.content).toContain("@Inject(CACHE_MANAGER) private readonly cache: Cache,");
  });

  it("CACHE_MANAGER + Cache import'ları doğru paketten", () => {
    const node = cacheNode(STATIC);
    const { ctx } = ctxFor(node);
    const [file] = emitCache(ctx.graph.byId(node.id)!, ctx);
    expect(file.content).toContain('import { CACHE_MANAGER } from "@nestjs/cache-manager";');
    expect(file.content).toContain('import type { Cache } from "cache-manager";');
    expect(file.content).toContain('import { Inject, Injectable } from "@nestjs/common";');
  });

  it("metot gövdeleri gerçek impl — surgical marker yok", () => {
    const node = cacheNode(DYNAMIC);
    const { ctx } = ctxFor(node);
    const [file] = emitCache(ctx.graph.byId(node.id)!, ctx);
    expect(file.surgicalMarkers).toBe(0);
    expect(file.content).not.toContain("@solarch:surgical");
    expect(file.content).not.toContain("NOT_IMPLEMENTED");
  });

  it("içerik tek satır sonu ile biter", () => {
    const node = cacheNode(DYNAMIC);
    const { ctx } = ctxFor(node);
    const [file] = emitCache(ctx.graph.byId(node.id)!, ctx);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMİNİZM: aynı node iki kez -> byte-identical", () => {
    const node = cacheNode(DYNAMIC);
    const { ctx } = ctxFor(node);
    const a = emitCache(ctx.graph.byId(node.id)!, ctx)[0].content;
    const b = emitCache(ctx.graph.byId(node.id)!, ctx)[0].content;
    expect(a).toBe(b);
  });
});
