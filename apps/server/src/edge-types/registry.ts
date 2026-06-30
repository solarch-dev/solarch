import type { EdgeKind } from "../edges/schemas/edge.schema";

export type EdgeFamily =
  | "communication"
  | "data"
  | "infrastructure"
  | "architecture";

export const EDGE_FAMILY_LABELS: Record<EdgeFamily, string> = {
  communication: "Calls and Communication",
  data: "Data and Schema",
  infrastructure: "Database and Infrastructure",
  architecture: "Architecture and Dependency",
};

export interface EdgeTypeMetadata {
  id: EdgeKind;
  family: EdgeFamily;
  familyLabel: string;
  description: string;
  exampleSource: string;
  exampleTarget: string;
  directionNote: string;
}

const make = (
  id: EdgeKind,
  family: EdgeFamily,
  description: string,
  exampleSource: string,
  exampleTarget: string,
  directionNote: string,
): EdgeTypeMetadata => ({
  id,
  family,
  familyLabel: EDGE_FAMILY_LABELS[family],
  description,
  exampleSource,
  exampleTarget,
  directionNote,
});

export const EDGE_TYPE_REGISTRY: Record<EdgeKind, EdgeTypeMetadata> = {
  CALLS: make("CALLS", "communication",
    "Synchronous method/function call.",
    "Controller", "Service",
    "From the caller to the callee."),
  REQUESTS: make("REQUESTS", "communication",
    "HTTP/RPC request over the network.",
    "FrontendApp", "APIGateway",
    "From the client to the server."),
  PUBLISHES: make("PUBLISHES", "communication",
    "Asynchronous event emission.",
    "Service", "MessageQueue",
    "From the publisher to the queue."),
  SUBSCRIBES: make("SUBSCRIBES", "communication",
    "Asynchronous event subscription.",
    "EventHandler", "MessageQueue",
    "From the listener to the source (the arrowhead points to the source)."),

  USES: make("USES", "data",
    "The component needs another type (usually a DTO/Schema) to do its job.",
    "Controller", "DTO",
    "From the user to the used."),
  HAS: make("HAS", "data",
    "A data structure containing another data structure (composition).",
    "Model", "Model",
    "From the owner to the content."),
  EXTENDS: make("EXTENDS", "data",
    "Class or schema inheritance.",
    "Model", "Model",
    "From the derived type to the base type."),
  IMPLEMENTS: make("IMPLEMENTS", "data",
    "A class implementing an interface.",
    "Service", "Service",
    "From the implementer to the interface."),
  RETURNS: make("RETURNS", "data",
    "The type returned by a function/service.",
    "Service", "DTO",
    "From the returner to the returned type."),

  QUERIES: make("QUERIES", "infrastructure",
    "Read-only from the database (SELECT).",
    "Repository", "Table",
    "From the reader to the table."),
  WRITES: make("WRITES", "infrastructure",
    "Write to the database (INSERT/UPDATE/DELETE).",
    "Repository", "Table",
    "From the writer to the table."),
  CACHES_IN: make("CACHES_IN", "infrastructure",
    "Writing/reading data to/from the cache.",
    "Service", "Cache",
    "From the cacher to the cache."),

  DEPENDS_ON: make("DEPENDS_ON", "architecture",
    "A component's dependency on another to function.",
    "Module", "ExternalService",
    "From the dependent to the dependency."),
  READS_CONFIG: make("READS_CONFIG", "architecture",
    "Reading an environment variable or setting.",
    "Service", "EnvironmentVariable",
    "From the reader to the source."),
  THROWS: make("THROWS", "architecture",
    "The exception type a component can throw.",
    "Service", "Exception",
    "From the thrower to the exception type."),
  ROUTES_TO: make("ROUTES_TO", "architecture",
    "The Gateway/Load Balancer routing the request to the backend.",
    "APIGateway", "Controller",
    "From the router to the target."),
};
