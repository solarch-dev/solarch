import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { PositionSchema } from "../schemas/base.schema";
import { TableNodeSchema } from "../schemas/table.schema";
import { DTONodeSchema } from "../schemas/dto.schema";
import { ModelNodeSchema } from "../schemas/model.schema";
import { EnumNodeSchema } from "../schemas/enum.schema";
import { ViewNodeSchema } from "../schemas/view.schema";
import { ServiceNodeSchema } from "../schemas/service.schema";
import { WorkerNodeSchema } from "../schemas/worker.schema";
import { EventHandlerNodeSchema } from "../schemas/event-handler.schema";
import { ControllerNodeSchema } from "../schemas/controller.schema";
import { MessageQueueNodeSchema } from "../schemas/message-queue.schema";
import { RepositoryNodeSchema } from "../schemas/repository.schema";
import { CacheNodeSchema } from "../schemas/cache.schema";
import { ExternalServiceNodeSchema } from "../schemas/external-service.schema";
import { FrontendAppNodeSchema } from "../schemas/frontend-app.schema";
import { UIComponentNodeSchema } from "../schemas/ui-component.schema";
import { MiddlewareNodeSchema } from "../schemas/middleware.schema";
import { EnvironmentVariableNodeSchema } from "../schemas/env-variable.schema";
import { ExceptionNodeSchema } from "../schemas/exception.schema";
import { ModuleNodeSchema } from "../schemas/module.schema";
import { APIGatewayNodeSchema } from "../schemas/api-gateway.schema";
import { OrchestratorNodeSchema } from "../schemas/orchestrator.schema";

// id/createdAt/updatedAt generated server-side — client does not send.
const CreatableBaseFields = {
  projectId: z.string().uuid(),
  position: PositionSchema,
  homeTabId: z.string().uuid().optional(), // project default tab when omitted
};

const make = <K extends string>(kind: K, propertiesSchema: z.ZodTypeAny) =>
  z.object({
    ...CreatableBaseFields,
    type: z.literal(kind),
    properties: propertiesSchema,
  }).strict();

export const CreateNodeSchema = z.discriminatedUnion("type", [
  make("Table", TableNodeSchema.shape.properties),
  make("DTO", DTONodeSchema.shape.properties),
  make("Model", ModelNodeSchema.shape.properties),
  make("Enum", EnumNodeSchema.shape.properties),
  make("View", ViewNodeSchema.shape.properties),
  make("Service", ServiceNodeSchema.shape.properties),
  make("Worker", WorkerNodeSchema.shape.properties),
  make("EventHandler", EventHandlerNodeSchema.shape.properties),
  make("Controller", ControllerNodeSchema.shape.properties),
  make("MessageQueue", MessageQueueNodeSchema.shape.properties),
  make("Repository", RepositoryNodeSchema.shape.properties),
  make("Cache", CacheNodeSchema.shape.properties),
  make("ExternalService", ExternalServiceNodeSchema.shape.properties),
  make("FrontendApp", FrontendAppNodeSchema.shape.properties),
  make("UIComponent", UIComponentNodeSchema.shape.properties),
  make("Middleware", MiddlewareNodeSchema.shape.properties),
  make("EnvironmentVariable", EnvironmentVariableNodeSchema.shape.properties),
  make("Exception", ExceptionNodeSchema.shape.properties),
  make("Module", ModuleNodeSchema.shape.properties),
  make("APIGateway", APIGatewayNodeSchema.shape.properties),
  make("Orchestrator", OrchestratorNodeSchema.shape.properties),
]);

export type CreateNodeInput = z.infer<typeof CreateNodeSchema>;

// discriminated union does not match createZodDto type signature — works at runtime
export class CreateNodeDto extends createZodDto(CreateNodeSchema as any) {}
