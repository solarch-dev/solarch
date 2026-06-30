import type { z } from "zod";
import {
  TableNodeSchema, DTONodeSchema, ModelNodeSchema, EnumNodeSchema, ViewNodeSchema,
  ServiceNodeSchema, WorkerNodeSchema, EventHandlerNodeSchema,
  ControllerNodeSchema, MessageQueueNodeSchema,
  RepositoryNodeSchema, CacheNodeSchema, ExternalServiceNodeSchema,
  FrontendAppNodeSchema, UIComponentNodeSchema,
  MiddlewareNodeSchema,
  EnvironmentVariableNodeSchema, ExceptionNodeSchema,
  ModuleNodeSchema,
  APIGatewayNodeSchema,
  OrchestratorNodeSchema,
  type NodeKind,
} from "../nodes/schemas";

/** Field hint for UI inspector: badge + group + value-set ref + node-ref. */
export interface FieldHint {
  badge?: string;
  group?: string;
  /** Strict enum reference — id defined in value-sets registry (e.g. 'http-methods'). */
  valueSet?: string;
  /** In-project node reference — frontend opens NodeRefCombobox (autocomplete +
   *  create new). When edgeKind set: auto edge after select/create
   *  (e.g. Service.Throws → THROWS). */
  nodeRef?: {
    type: NodeKind;
    edgeKind?: string;
  };
}

export interface NodeTypeMetadata {
  id: NodeKind;
  family: NodeFamily;
  familyLabel: string;
  description: string;
  nameKey: string;
  schema: z.ZodTypeAny;
  /** Dotted property path -> hint. For column/field badges in UI. */
  fieldHints?: Record<string, FieldHint>;
}

export type NodeFamily =
  | "data"
  | "business"
  | "access"
  | "infrastructure"
  | "client"
  | "security"
  | "configuration"
  | "structure";

export const FAMILY_LABELS: Record<NodeFamily, string> = {
  data: "Data and Schema",
  business: "Business Logic and Service",
  access: "Access and Presentation",
  infrastructure: "Infrastructure and Data Access",
  client: "Client",
  security: "Security and Policy",
  configuration: "Configuration and Environment",
  structure: "Containers (Bounded Context)",
};

const make = (
  id: NodeKind,
  family: NodeFamily,
  nameKey: string,
  description: string,
  schema: z.ZodTypeAny,
): NodeTypeMetadata => ({
  id,
  family,
  familyLabel: FAMILY_LABELS[family],
  description,
  nameKey,
  schema,
});

export const NODE_TYPE_REGISTRY: Record<NodeKind, NodeTypeMetadata> = {
  Table: make("Table", "data", "TableName",
    "Physical properties of a database table — columns, indexes, foreign keys.", TableNodeSchema),
  DTO: make("DTO", "data", "Name",
    "Data transfer object. Contains no business logic; used for transfer with validation rules.", DTONodeSchema),
  Model: make("Model", "data", "ClassName",
    "The main data class (entity) used in business logic.", ModelNodeSchema),
  Enum: make("Enum", "data", "Name",
    "A set of constant values. For statuses, types, etc.", EnumNodeSchema),
  View: make("View", "data", "ViewName",
    "A database view or materialized view. SQL/aggregate definition + source tables.", ViewNodeSchema),

  Service: make("Service", "business", "ServiceName",
    "Core business logic. Defines its methods + transaction scope.", ServiceNodeSchema),
  Worker: make("Worker", "business", "WorkerName",
    "A scheduled (cron) task. Schedule + retry policy + timeout.", WorkerNodeSchema),
  EventHandler: make("EventHandler", "business", "HandlerName",
    "An event listener. Sync/async event processing.", EventHandlerNodeSchema),

  Controller: make("Controller", "access", "ControllerName",
    "HTTP API endpoints. BaseRoute + endpoint list (method, route, auth).", ControllerNodeSchema),
  MessageQueue: make("MessageQueue", "access", "QueueName",
    "A message queue or pub/sub topic. Provider: RabbitMQ/Kafka/AWS SQS/Generic.", MessageQueueNodeSchema),

  Repository: make("Repository", "infrastructure", "RepositoryName",
    "Data access layer (DAO). Manages an Entity, defines custom queries.", RepositoryNodeSchema),
  Cache: make("Cache", "infrastructure", "CacheName",
    "Memory/cache. Key pattern + TTL + engine (Redis/Memcached/Memory).", CacheNodeSchema),
  ExternalService: make("ExternalService", "infrastructure", "ServiceName",
    "External API integration. BaseURL + auth type + timeout.", ExternalServiceNodeSchema),

  FrontendApp: make("FrontendApp", "client", "AppName",
    "Frontend app. Framework (React/Vue/...) + deployment type (SPA/SSR/SSG).", FrontendAppNodeSchema),
  UIComponent: make("UIComponent", "client", "ComponentName",
    "UI component. Props (external data) + State (internal variables) definition.", UIComponentNodeSchema),

  Middleware: make("Middleware", "security", "MiddlewareName",
    "Pipeline middleware. Scope (Global/SpecificRoutes) + execution order.", MiddlewareNodeSchema),

  EnvironmentVariable: make("EnvironmentVariable", "configuration", "Key",
    "Environment variable. DataType + IsSecret + which environments it is active in.", EnvironmentVariableNodeSchema),
  Exception: make("Exception", "configuration", "ExceptionName",
    "Custom exception type. HTTP status code + log severity.", ExceptionNodeSchema),

  Module: make("Module", "structure", "ModuleName",
    "Bounded Context / Module. StrictBoundaries limits external access.", ModuleNodeSchema),

  APIGateway: make("APIGateway", "access", "GatewayName",
    "API gateway / load balancer. Provider (Kong/Nginx/AWS_API_Gateway/...). Required for the Rules Matrix.", APIGatewayNodeSchema),
  Orchestrator: make("Orchestrator", "business", "OrchestratorName",
    "Business process coordinator. Pattern (Saga/CompensatingTransaction/StateMachine). Coordinates multiple Services.", OrchestratorNodeSchema),
};

/* ── Phase A fieldHints — UI inspector badge/group metadata ─────────────── */
NODE_TYPE_REGISTRY.Table.fieldHints = {
  "Columns.DataType": { badge: "TYPE", group: "definition", valueSet: "column-data-types" },
  "Columns.IsPrimaryKey": { badge: "PK", group: "constraints" },
  "Columns.IsNotNull": { badge: "NN", group: "constraints" },
  "Columns.IsUnique": { badge: "UQ", group: "constraints" },
  "Columns.AutoIncrement": { badge: "AI", group: "constraints" },
  "Columns.EnumRef": { badge: "ENUM", group: "reference", nodeRef: { type: "Enum", edgeKind: "USES" } },
  PrimaryKey: { badge: "PK", group: "constraints" },
  ForeignKeys: { badge: "FK", group: "constraints" },
  "ForeignKeys.OnDelete": { badge: "DEL", group: "constraints", valueSet: "on-delete-actions" },
  "ForeignKeys.OnUpdate": { badge: "UPD", group: "constraints", valueSet: "on-delete-actions" },
  UniqueConstraints: { badge: "UQ", group: "constraints" },
  CheckConstraints: { badge: "CHK", group: "constraints" },
  Indexes: { badge: "IDX", group: "performance" },
};
NODE_TYPE_REGISTRY.DTO.fieldHints = {
  "Fields.DataType": { badge: "TYPE", group: "definition", valueSet: "parameter-types" },
  "Fields.IsRequired": { badge: "REQ", group: "validation" },
  "Fields.ValidationRules": { badge: "VALID", group: "validation" },
  "Fields.ValidationRules.Rule": { badge: "RULE", group: "validation", valueSet: "validation-rules" },
  "Fields.NestedDTORef": { badge: "DTO", group: "reference", nodeRef: { type: "DTO", edgeKind: "HAS" } },
  "Fields.EnumRef": { badge: "ENUM", group: "reference", nodeRef: { type: "Enum", edgeKind: "USES" } },
};
NODE_TYPE_REGISTRY.Model.fieldHints = {
  "Properties.Type": { badge: "TYPE", group: "definition", valueSet: "parameter-types" },
  "Properties.RelationType": { badge: "REL", group: "relations", valueSet: "relation-types" },
  "Properties.RelatedModelRef": { badge: "REF", group: "relations", nodeRef: { type: "Model", edgeKind: "HAS" } },
  "Methods.Visibility": { badge: "VIS", group: "behavior", valueSet: "visibility" },
  "Methods.ReturnType": { badge: "RET", group: "behavior", valueSet: "parameter-types" },
  "Methods.Parameters.Type": { badge: "TYPE", group: "behavior", valueSet: "parameter-types" },
  TableRef: { badge: "TABLE", group: "reference", nodeRef: { type: "Table", edgeKind: "USES" } },
  Methods: { badge: "FN", group: "behavior" },
};
NODE_TYPE_REGISTRY.Enum.fieldHints = {
  BackingType: { badge: "TYPE", group: "definition", valueSet: "enum-backing-types" },
  Values: { badge: "ENUM", group: "definition" },
};
NODE_TYPE_REGISTRY.View.fieldHints = {
  Materialized: { badge: "MAT", group: "definition" },
  RefreshStrategy: { badge: "REFRESH", group: "definition", valueSet: "view-refresh-strategy" },
  SourceTables: { badge: "SRC", group: "reference" },
  "Columns.DataType": { badge: "TYPE", group: "definition", valueSet: "column-data-types" },
};

/* ── Phase B fieldHints — Business Logic + Access ──────────────────────────── */
NODE_TYPE_REGISTRY.Service.fieldHints = {
  IsTransactionScoped: { badge: "TX", group: "behavior" },
  "Methods.Visibility": { badge: "VIS", group: "behavior", valueSet: "visibility" },
  "Methods.ReturnType": { badge: "RET", group: "behavior", valueSet: "parameter-types" },
  "Methods.Parameters.Type": { badge: "TYPE", group: "behavior", valueSet: "parameter-types" },
  "Methods.Parameters.DtoRef": { badge: "DTO", group: "reference", nodeRef: { type: "DTO", edgeKind: "USES" } },
  "Methods.IsAsync": { badge: "ASYNC", group: "behavior" },
  "Methods.Throws": { badge: "THROWS", group: "behavior", nodeRef: { type: "Exception", edgeKind: "THROWS" } },
  "Methods.ReturnDtoRef": { badge: "DTO", group: "reference", nodeRef: { type: "DTO", edgeKind: "RETURNS" } },
  Dependencies: { badge: "DI", group: "relations" },
  "Dependencies.Kind": { badge: "KIND", group: "relations", valueSet: "service-dep-kinds" },
  // Dependencies.Ref dynamic by kind (Repository/Service/Cache/ExternalService).
  // Generic for now — frontend can dynamic lookup, edgeKind CALLS default.
};
NODE_TYPE_REGISTRY.EventHandler.fieldHints = {
  ...NODE_TYPE_REGISTRY.EventHandler.fieldHints,
  QueueRef: { badge: "QUEUE", group: "reference", nodeRef: { type: "MessageQueue", edgeKind: "SUBSCRIBES" } },
};
NODE_TYPE_REGISTRY.Orchestrator.fieldHints = {
  ...NODE_TYPE_REGISTRY.Orchestrator.fieldHints,
  "Steps.ServiceRef": { badge: "SVC", group: "relations", nodeRef: { type: "Service", edgeKind: "CALLS" } },
};
NODE_TYPE_REGISTRY.Worker.fieldHints = {
  Schedule: { badge: "CRON", group: "scheduling" },
  RetryPolicy: { badge: "RETRY", group: "reliability" },
  Concurrency: { badge: "CONC", group: "scheduling" },
  IsEnabled: { badge: "ON", group: "scheduling" },
};
NODE_TYPE_REGISTRY.EventHandler.fieldHints = {
  EventName: { badge: "EVENT", group: "definition" },
  IsAsync: { badge: "ASYNC", group: "behavior" },
  QueueRef: { badge: "QUEUE", group: "reference" },
  RetryPolicy: { badge: "RETRY", group: "reliability" },
  DeadLetterQueue: { badge: "DLQ", group: "reliability" },
};
NODE_TYPE_REGISTRY.Orchestrator.fieldHints = {
  Pattern: { badge: "PATTERN", group: "definition" },
  "Steps.ServiceRef": { badge: "SVC", group: "relations" },
  "Steps.CompensationAction": { badge: "COMP", group: "reliability" },
};
NODE_TYPE_REGISTRY.Controller.fieldHints = {
  "Endpoints.Method": { badge: "HTTP", group: "routing", valueSet: "http-methods" },
  "Endpoints.HttpMethod": { badge: "HTTP", group: "routing", valueSet: "http-methods" },
  "Endpoints.StatusCode": { badge: "STATUS", group: "routing", valueSet: "http-status" },
  "Endpoints.StatusCodes.Code": { badge: "HTTP", group: "definition", valueSet: "http-status" },
  "Endpoints.SuccessStatus": { badge: "STATUS", group: "routing", valueSet: "http-status" },
  "Endpoints.RequiresAuth": { badge: "AUTH", group: "security" },
  "Endpoints.RequestDTORef": { badge: "REQ", group: "reference", nodeRef: { type: "DTO", edgeKind: "USES" } },
  "Endpoints.ResponseDTORef": { badge: "RES", group: "reference", nodeRef: { type: "DTO", edgeKind: "RETURNS" } },
  "Endpoints.RateLimit": { badge: "RATE", group: "security" },
  // MiddlewareRefs: no edgeKind — Controller→Middleware USES forbidden in whitelist.
  // Semantic direction Middleware→Controller ROUTES_TO (reverse); autocomplete used, no edge created.
  "Endpoints.MiddlewareRefs": { badge: "MW", group: "security", nodeRef: { type: "Middleware" } },
};
NODE_TYPE_REGISTRY.MessageQueue.fieldHints = {
  Type: { badge: "TYPE", group: "definition" },
  Provider: { badge: "PROV", group: "definition" },
  Protocol: { badge: "PROTO", group: "definition", valueSet: "protocols" },
  DeliveryGuarantee: { badge: "QOS", group: "reliability" },
  DeadLetterQueue: { badge: "DLQ", group: "reliability" },
  MessageFormat: { badge: "DTO", group: "reference", nodeRef: { type: "DTO", edgeKind: "USES" } },
};
NODE_TYPE_REGISTRY.APIGateway.fieldHints = {
  Provider: { badge: "PROV", group: "definition" },
  AuthMode: { badge: "AUTH", group: "security" },
  CorsEnabled: { badge: "CORS", group: "security" },
  "Routes.Method": { badge: "HTTP", group: "routing", valueSet: "http-methods" },
  "Routes.TargetRef": { badge: "TARGET", group: "relations", nodeRef: { type: "Controller", edgeKind: "ROUTES_TO" } },
};

/* ── Phase C fieldHints — Infra/Client/Security/Config/Structure ──────────── */
NODE_TYPE_REGISTRY.Repository.fieldHints = {
  EntityReference: { badge: "ENTITY", group: "reference", nodeRef: { type: "Model", edgeKind: "USES" } },
  IsCached: { badge: "CACHED", group: "performance" },
  "CustomQueries.QueryType": { badge: "QUERY", group: "behavior" },
};
NODE_TYPE_REGISTRY.Cache.fieldHints = {
  Engine: { badge: "ENGINE", group: "definition" },
  TTL_Seconds: { badge: "TTL", group: "expiry" },
  EvictionPolicy: { badge: "EVICT", group: "expiry" },
};
NODE_TYPE_REGISTRY.ExternalService.fieldHints = {
  AuthType: { badge: "AUTH", group: "security" },
  Protocol: { badge: "PROTO", group: "definition", valueSet: "protocols" },
  CircuitBreaker: { badge: "CB", group: "reliability" },
  RetryPolicy: { badge: "RETRY", group: "reliability" },
  RateLimit: { badge: "RATE", group: "reliability" },
};
NODE_TYPE_REGISTRY.FrontendApp.fieldHints = {
  Framework: { badge: "FW", group: "definition" },
  DeploymentType: { badge: "DEPLOY", group: "definition" },
  StateManagement: { badge: "STATE", group: "definition" },
  "Routes.ComponentRef": { badge: "CMP", group: "relations", nodeRef: { type: "UIComponent", edgeKind: "HAS" } },
};
NODE_TYPE_REGISTRY.UIComponent.fieldHints = {
  "Props.Type": { badge: "TYPE", group: "interface", valueSet: "parameter-types" },
  "Props.Required": { badge: "REQ", group: "interface" },
  Events: { badge: "EVENT", group: "interface" },
  ChildComponentRefs: { badge: "CHILD", group: "relations", nodeRef: { type: "UIComponent", edgeKind: "HAS" } },
};
NODE_TYPE_REGISTRY.Middleware.fieldHints = {
  AppliesTo: { badge: "SCOPE", group: "definition", valueSet: "middleware-scope" },
  ExecutionOrder: { badge: "ORDER", group: "definition" },
  MiddlewareType: { badge: "TYPE", group: "definition", valueSet: "middleware-types" },
};
NODE_TYPE_REGISTRY.EnvironmentVariable.fieldHints = {
  IsSecret: { badge: "SECRET", group: "security" },
  IsRequired: { badge: "REQ", group: "validation" },
  DataType: { badge: "TYPE", group: "definition", valueSet: "primitive-types" },
};
NODE_TYPE_REGISTRY.Exception.fieldHints = {
  HttpStatusCode: { badge: "HTTP", group: "definition", valueSet: "http-status" },
  LogSeverity: { badge: "SEV", group: "definition" },
  ErrorCode: { badge: "CODE", group: "definition" },
  ParentExceptionRef: { badge: "EXTENDS", group: "relations", nodeRef: { type: "Exception", edgeKind: "EXTENDS" } },
};
NODE_TYPE_REGISTRY.Module.fieldHints = {
  StrictBoundaries: { badge: "STRICT", group: "definition" },
  ExposedServices: { badge: "EXPOSE", group: "relations", nodeRef: { type: "Service", edgeKind: "USES" } },
  Dependencies: { badge: "DEP", group: "relations", nodeRef: { type: "Module", edgeKind: "DEPENDS_ON" } },
};
