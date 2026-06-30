import { z } from "zod";

export const EDGE_KINDS = [
  // 1. Call and communication
  "CALLS",
  "REQUESTS",
  "PUBLISHES",
  "SUBSCRIBES",
  // 2. Data and schema
  "USES",
  "HAS",
  "EXTENDS",
  "IMPLEMENTS",
  "RETURNS",
  // 3. DB and infrastructure
  "QUERIES",
  "WRITES",
  "CACHES_IN",
  // 4. Architecture
  "DEPENDS_ON",
  "READS_CONFIG",
  "THROWS",
  "ROUTES_TO",
] as const;

export type EdgeKind = (typeof EDGE_KINDS)[number];

export const EdgeKindSchema = z.enum(EDGE_KINDS);

/* Plans/Edge Taxonomy: all edge kinds share the SAME property shape.
 * No per-kind schema needed — discriminator + shared properties suffice. */
export const EdgePropertiesSchema = z.object({
  Label: z.string().optional(),
  IsAsync: z.boolean(),
  Protocol: z.enum(["HTTP", "gRPC", "TCP", "WebSocket", "AMQP", "MQTT"]).optional(),
  RetryCount: z.number().int().nonnegative().optional(),
}).strict();

export type EdgeProperties = z.infer<typeof EdgePropertiesSchema>;

export const EdgeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sourceNodeId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
  kind: EdgeKindSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  properties: EdgePropertiesSchema,
}).strict();

export type Edge = z.infer<typeof EdgeSchema>;
