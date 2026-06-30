/** Node type → name field key in properties.
 *  NodeNameEditor uses this to know which field to write when committing a rename.
 *  Inspector forms use their own nameKey (backend NodeTypeDetail.nameKey field). */

export const NAME_KEY_FOR: Record<string, string> = {
  Table: "TableName",
  Service: "ServiceName",
  Controller: "ControllerName",
  DTO: "Name",
  Model: "ClassName",
  Enum: "Name",
  View: "ViewName",
  Worker: "WorkerName",
  EventHandler: "HandlerName",
  Orchestrator: "OrchestratorName",
  APIGateway: "GatewayName",
  MessageQueue: "QueueName",
  Repository: "RepositoryName",
  Cache: "CacheName",
  ExternalService: "ServiceName",
  FrontendApp: "AppName",
  UIComponent: "ComponentName",
  Middleware: "MiddlewareName",
  EnvironmentVariable: "Key",
  Exception: "ExceptionName",
  Module: "ModuleName",
};

export function nameKeyFor(type: string): string {
  return NAME_KEY_FOR[type] ?? "Name";
}
