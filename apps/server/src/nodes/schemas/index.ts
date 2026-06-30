import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { TableNodeSchema } from "./table.schema";
import { DTONodeSchema } from "./dto.schema";
import { ModelNodeSchema } from "./model.schema";
import { EnumNodeSchema } from "./enum.schema";
import { ViewNodeSchema } from "./view.schema";
import { ServiceNodeSchema } from "./service.schema";
import { WorkerNodeSchema } from "./worker.schema";
import { EventHandlerNodeSchema } from "./event-handler.schema";
import { ControllerNodeSchema } from "./controller.schema";
import { MessageQueueNodeSchema } from "./message-queue.schema";
import { RepositoryNodeSchema } from "./repository.schema";
import { CacheNodeSchema } from "./cache.schema";
import { ExternalServiceNodeSchema } from "./external-service.schema";
import { FrontendAppNodeSchema } from "./frontend-app.schema";
import { UIComponentNodeSchema } from "./ui-component.schema";
import { MiddlewareNodeSchema } from "./middleware.schema";
import { EnvironmentVariableNodeSchema } from "./env-variable.schema";
import { ExceptionNodeSchema } from "./exception.schema";
import { ModuleNodeSchema } from "./module.schema";
import { APIGatewayNodeSchema } from "./api-gateway.schema";
import { OrchestratorNodeSchema } from "./orchestrator.schema";

export { BaseNodeSchema, PositionSchema, type BaseNode, type Position } from "./base.schema";
export { TableNodeSchema, type TableNode } from "./table.schema";
export { DTONodeSchema, type DTONode } from "./dto.schema";
export { ModelNodeSchema, type ModelNode } from "./model.schema";
export { EnumNodeSchema, type EnumNode } from "./enum.schema";
export { ViewNodeSchema, type ViewNode } from "./view.schema";
export { ServiceNodeSchema, type ServiceNode } from "./service.schema";
export { WorkerNodeSchema, type WorkerNode } from "./worker.schema";
export { EventHandlerNodeSchema, type EventHandlerNode } from "./event-handler.schema";
export { ControllerNodeSchema, type ControllerNode } from "./controller.schema";
export { MessageQueueNodeSchema, type MessageQueueNode } from "./message-queue.schema";
export { RepositoryNodeSchema, type RepositoryNode } from "./repository.schema";
export { CacheNodeSchema, type CacheNode } from "./cache.schema";
export { ExternalServiceNodeSchema, type ExternalServiceNode } from "./external-service.schema";
export { FrontendAppNodeSchema, type FrontendAppNode } from "./frontend-app.schema";
export { UIComponentNodeSchema, type UIComponentNode } from "./ui-component.schema";
export { MiddlewareNodeSchema, type MiddlewareNode } from "./middleware.schema";
export { EnvironmentVariableNodeSchema, type EnvironmentVariableNode } from "./env-variable.schema";
export { ExceptionNodeSchema, type ExceptionNode } from "./exception.schema";
export { ModuleNodeSchema, type ModuleNode } from "./module.schema";
export { APIGatewayNodeSchema, type APIGatewayNode } from "./api-gateway.schema";
export { OrchestratorNodeSchema, type OrchestratorNode } from "./orchestrator.schema";

export const NodeSchema = z.discriminatedUnion("type", [
  // Veri ailesi (Phase 1)
  TableNodeSchema,
  DTONodeSchema,
  ModelNodeSchema,
  EnumNodeSchema,
  ViewNodeSchema,
  // İş Mantığı
  ServiceNodeSchema,
  WorkerNodeSchema,
  EventHandlerNodeSchema,
  // Erişim
  ControllerNodeSchema,
  MessageQueueNodeSchema,
  // Altyapı
  RepositoryNodeSchema,
  CacheNodeSchema,
  ExternalServiceNodeSchema,
  // İstemci
  FrontendAppNodeSchema,
  UIComponentNodeSchema,
  // Güvenlik
  MiddlewareNodeSchema,
  // Konfigürasyon
  EnvironmentVariableNodeSchema,
  ExceptionNodeSchema,
  // Yapı
  ModuleNodeSchema,
  // Phase 2A — Rules Matrix gerekli ek tipler
  APIGatewayNodeSchema,
  OrchestratorNodeSchema,
]);

export type Node = z.infer<typeof NodeSchema>;
export type NodeKind = Node["type"];

export const NODE_KINDS: NodeKind[] = [
  "Table", "DTO", "Model", "Enum", "View",
  "Service", "Worker", "EventHandler",
  "Controller", "MessageQueue",
  "Repository", "Cache", "ExternalService",
  "FrontendApp", "UIComponent",
  "Middleware",
  "EnvironmentVariable", "Exception",
  "Module",
  "APIGateway", "Orchestrator",
];

/** Kind → properties Zod şeması. Yazım yollarında (PATCH, AI create_node)
 *  kind-bazlı doğrulama için tek kaynak. createZodDto/CreateNodeSchema ile
 *  aynı `.shape.properties`'leri kullanır → tutarlılık. */
export const PROPERTIES_SCHEMA_BY_KIND: Record<NodeKind, z.ZodTypeAny> = {
  Table: TableNodeSchema.shape.properties,
  DTO: DTONodeSchema.shape.properties,
  Model: ModelNodeSchema.shape.properties,
  Enum: EnumNodeSchema.shape.properties,
  View: ViewNodeSchema.shape.properties,
  Service: ServiceNodeSchema.shape.properties,
  Worker: WorkerNodeSchema.shape.properties,
  EventHandler: EventHandlerNodeSchema.shape.properties,
  Controller: ControllerNodeSchema.shape.properties,
  MessageQueue: MessageQueueNodeSchema.shape.properties,
  Repository: RepositoryNodeSchema.shape.properties,
  Cache: CacheNodeSchema.shape.properties,
  ExternalService: ExternalServiceNodeSchema.shape.properties,
  FrontendApp: FrontendAppNodeSchema.shape.properties,
  UIComponent: UIComponentNodeSchema.shape.properties,
  Middleware: MiddlewareNodeSchema.shape.properties,
  EnvironmentVariable: EnvironmentVariableNodeSchema.shape.properties,
  Exception: ExceptionNodeSchema.shape.properties,
  Module: ModuleNodeSchema.shape.properties,
  APIGateway: APIGatewayNodeSchema.shape.properties,
  Orchestrator: OrchestratorNodeSchema.shape.properties,
};

/* ── Per-kind DTO class'ları ──────────────────────────────────────────
 * createZodDto her şema için NestJS Swagger'a tanıdık bir class verir.
 * main.ts extraModels üzerinden hepsi OpenAPI components/schemas'a girer
 * ve Scalar UI'in Models panelinde tek tek görünür. */
export class TableNodeDto extends createZodDto(TableNodeSchema) {}
export class DTONodeDto extends createZodDto(DTONodeSchema) {}
export class ModelNodeDto extends createZodDto(ModelNodeSchema) {}
export class EnumNodeDto extends createZodDto(EnumNodeSchema) {}
export class ViewNodeDto extends createZodDto(ViewNodeSchema) {}
export class ServiceNodeDto extends createZodDto(ServiceNodeSchema) {}
export class WorkerNodeDto extends createZodDto(WorkerNodeSchema) {}
export class EventHandlerNodeDto extends createZodDto(EventHandlerNodeSchema) {}
export class ControllerNodeDto extends createZodDto(ControllerNodeSchema) {}
export class MessageQueueNodeDto extends createZodDto(MessageQueueNodeSchema) {}
export class RepositoryNodeDto extends createZodDto(RepositoryNodeSchema) {}
export class CacheNodeDto extends createZodDto(CacheNodeSchema) {}
export class ExternalServiceNodeDto extends createZodDto(ExternalServiceNodeSchema) {}
export class FrontendAppNodeDto extends createZodDto(FrontendAppNodeSchema) {}
export class UIComponentNodeDto extends createZodDto(UIComponentNodeSchema) {}
export class MiddlewareNodeDto extends createZodDto(MiddlewareNodeSchema) {}
export class EnvironmentVariableNodeDto extends createZodDto(EnvironmentVariableNodeSchema) {}
export class ExceptionNodeDto extends createZodDto(ExceptionNodeSchema) {}
export class ModuleNodeDto extends createZodDto(ModuleNodeSchema) {}
export class APIGatewayNodeDto extends createZodDto(APIGatewayNodeSchema) {}
export class OrchestratorNodeDto extends createZodDto(OrchestratorNodeSchema) {}

export const ALL_NODE_DTOS = [
  TableNodeDto, DTONodeDto, ModelNodeDto, EnumNodeDto, ViewNodeDto,
  ServiceNodeDto, WorkerNodeDto, EventHandlerNodeDto,
  ControllerNodeDto, MessageQueueNodeDto,
  RepositoryNodeDto, CacheNodeDto, ExternalServiceNodeDto,
  FrontendAppNodeDto, UIComponentNodeDto,
  MiddlewareNodeDto,
  EnvironmentVariableNodeDto, ExceptionNodeDto,
  ModuleNodeDto,
  APIGatewayNodeDto,
  OrchestratorNodeDto,
];

export const KIND_LABELS: Record<NodeKind, string> = {
  Table: "Table",
  DTO: "DTO",
  Model: "Model",
  Enum: "Enum",
  View: "View",
  Service: "Service",
  Worker: "Worker",
  EventHandler: "EventHandler",
  Controller: "Controller",
  MessageQueue: "MessageQueue",
  Repository: "Repository",
  Cache: "Cache",
  ExternalService: "ExternalService",
  FrontendApp: "FrontendApp",
  UIComponent: "UIComponent",
  Middleware: "Middleware",
  EnvironmentVariable: "EnvironmentVariable",
  Exception: "Exception",
  Module: "Module",
  APIGateway: "APIGateway",
  Orchestrator: "Orchestrator",
};
