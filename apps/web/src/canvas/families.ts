/** Node type → family → blueprint-compatible accent color.
 *  Cards stay white; color is used in left strip + type label. */
export type NodeFamily =
  | "data" | "business" | "access" | "infrastructure"
  | "client" | "security" | "configuration" | "structure";

const TYPE_FAMILY: Record<string, NodeFamily> = {
  Table: "data", DTO: "data", Model: "data", Enum: "data", View: "data",
  Service: "business", Worker: "business", EventHandler: "business", Orchestrator: "business",
  Controller: "access", APIGateway: "access", MessageQueue: "access",
  Repository: "infrastructure", Cache: "infrastructure", ExternalService: "infrastructure",
  FrontendApp: "client", UIComponent: "client",
  Middleware: "security",
  EnvironmentVariable: "configuration", Exception: "configuration",
  Module: "structure",
};

export const FAMILY_COLOR: Record<NodeFamily, string> = {
  data:          "#3B82F6", // blue
  business:      "#10B981", // green
  access:        "#F97316", // orange
  infrastructure:"#0891B2", // cyan
  client:        "#C026D3", // purple
  security:      "#8B5CF6", // violet
  configuration: "#D97706", // amber
  structure:     "#6B7280", // gray
};

export function familyOf(type: string): NodeFamily {
  return TYPE_FAMILY[type] ?? "structure";
}

export function colorOf(type: string): string {
  return FAMILY_COLOR[familyOf(type)];
}

/** Returns color from family name (e.g. "data") — unlike colorOf, takes family not type. */
export function colorOfFamily(family: string): string {
  return FAMILY_COLOR[family as NodeFamily] ?? FAMILY_COLOR.structure;
}

/** 6% opacity tint (hex suffix 0F). */
export function tintOf(family: string): string {
  return colorOfFamily(family) + "0F";
}

/** 28% opacity border (hex suffix 47). */
export function borderOf(family: string): string {
  return colorOfFamily(family) + "47";
}

/** Extracts display name from node properties (type-specific name field). */
export const NAME_KEYS = [
  "TableName", "ServiceName", "ControllerName", "Name", "ClassName", "ViewName",
  "RepositoryName", "AppName", "ComponentName", "QueueName", "CacheName",
  "GatewayName", "OrchestratorName", "WorkerName", "HandlerName", "MiddlewareName",
  "ExceptionName", "ModuleName", "Key",
];
export function nameOf(properties: Record<string, unknown>): string {
  for (const k of NAME_KEYS) {
    if (typeof properties[k] === "string" && properties[k]) return properties[k] as string;
  }
  return "?";
}
