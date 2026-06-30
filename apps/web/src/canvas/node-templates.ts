/** Produces minimal-valid properties for each type when adding a new node.
 *  Backend Zod schema requires certain fields; user edits them later in the inspector.
 *  name → written to the type's name field + short suffix for uniqueness. */

const suffix = () => Math.random().toString(36).slice(2, 6);

/** Default width (px) for each node type. */
export function nodeDefaultW(type: string): number {
  switch (type) {
    case "Table": case "Service": case "Controller": return 260;
    case "DTO": case "Model": case "Enum": case "View": return 240;
    case "Repository": case "Cache": case "ExternalService":
    case "MessageQueue": case "APIGateway": case "Worker":
    case "EventHandler": case "Orchestrator": case "FrontendApp":
    case "UIComponent": case "Middleware": return 220;
    case "EnvironmentVariable": case "Exception": case "Module": return 200;
    default: return 220;
  }
}

export interface NodeTypeMeta {
  id: string;
  family: string;
  familyLabel: string;
  description: string;
}

export function defaultProperties(type: string): Record<string, unknown> {
  const s = suffix();
  switch (type) {
    case "Table":
      return { TableName: `table_${s}`, Description: "New table", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }] };
    case "DTO":
      return { Name: `Dto${s}`, Description: "New DTO", Fields: [{ Name: "field", DataType: "string", IsRequired: true, IsArray: false }] };
    case "Model":
      return { ClassName: `Model${s}`, Description: "New model", Properties: [{ Name: "id", Type: "UUID" }] };
    case "Enum":
      return { Name: `Enum${s}`, Description: "New enum", Values: [{ Key: "VALUE_1" }] };
    case "View":
      return { ViewName: `view_${s}`, Description: "New view", Definition: "SELECT 1", SourceTables: ["table"], Materialized: false };
    case "Service":
      return { ServiceName: `Service${s}`, Description: "New service", IsTransactionScoped: false, Methods: [{ MethodName: "execute", ReturnType: "void" }] };
    case "Worker":
      return { WorkerName: `Worker${s}`, Description: "New worker", Schedule: "0 0 * * *", TaskToExecute: "task", TimeoutSeconds: 60, RetryPolicy: { MaxRetries: 3 } };
    case "EventHandler":
      return { HandlerName: `Handler${s}`, Description: "New event handler", EventName: "EVENT", IsAsync: true };
    case "Orchestrator":
      return { OrchestratorName: `Orchestrator${s}`, Description: "New orchestrator", Pattern: "Saga" };
    case "Controller":
      return { ControllerName: `Controller${s}`, Description: "New controller", BaseRoute: "/api", Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: false }] };
    case "MessageQueue":
      return { QueueName: `queue_${s}`, Description: "New queue", Type: "Queue", Provider: "Generic", MessageFormat: "DTO" };
    case "Repository":
      return { RepositoryName: `Repository${s}`, Description: "New repository", EntityReference: "Entity" };
    case "Cache":
      return { CacheName: `cache_${s}`, Description: "New cache", KeyPattern: "key:{id}", TTL_Seconds: 60, Engine: "Redis" };
    case "ExternalService":
      return { ServiceName: `External${s}`, Description: "New external service", BaseURL: "https://api.example.com", AuthType: "None", TimeoutSeconds: 30 };
    case "FrontendApp":
      return { AppName: `App${s}`, Description: "New frontend", Framework: "React", DeploymentType: "SPA" };
    case "UIComponent":
      return { ComponentName: `Component${s}`, Description: "New component" };
    case "Middleware":
      return { MiddlewareName: `Middleware${s}`, Description: "New middleware", AppliesTo: "Global", ExecutionOrder: 1 };
    case "EnvironmentVariable":
      return { Key: `ENV_${s.toUpperCase()}`, Description: "New env", DataType: "String", IsSecret: false, Environment: ["Dev"] };
    case "Exception":
      return { ExceptionName: `Exception${s}`, Description: "New exception", HttpStatusCode: 400, LogSeverity: "Error" };
    case "Module":
      return { ModuleName: `Module${s}`, Description: "New module", StrictBoundaries: false };
    case "APIGateway":
      return { GatewayName: `Gateway${s}`, Description: "New gateway", Provider: "Generic" };
    default:
      return { Name: `Node${s}`, Description: "New node" };
  }
}
