import { z } from "zod";
import { BaseNodeSchema } from "./base.schema";

export const CacheNodeSchema = BaseNodeSchema.extend({
  type: z.literal("Cache"),
  properties: z.object({
    CacheName: z.string().min(1),
    Description: z.string().min(1),
    KeyPattern: z.string().min(1),
    TTL_Seconds: z.number().int().positive(),
    Engine: z.enum(["Redis", "Memcached", "Memory"]),
    EvictionPolicy: z.enum(["LRU", "LFU", "FIFO", "TTL"]).optional(),
    MaxSizeMB: z.number().int().positive().optional(),
    Serialization: z.enum(["json", "binary", "string"]).optional(),
  }).strict(),
}).strict();

export type CacheNode = z.infer<typeof CacheNodeSchema>;
