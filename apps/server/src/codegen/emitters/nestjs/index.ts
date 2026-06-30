import type { EmitterRegistry } from "../../types";
import { emitEnum } from "./enum.emitter";
import { emitException } from "./exception.emitter";
import { emitController } from "./controller.emitter";
import { emitService } from "./service.emitter";
import { emitRepository } from "./repository.emitter";
import { emitDto } from "./dto.emitter";
import { emitModel } from "./model.emitter";
import { emitTable } from "./table.emitter";
import { emitView } from "./view.emitter";
import { emitCache } from "./cache.emitter";
import { emitMessageQueue } from "./message-queue.emitter";
import { emitWorker } from "./worker.emitter";
import { emitApiGateway } from "./api-gateway.emitter";
import { emitEventHandler } from "./event-handler.emitter";
import { emitOrchestrator } from "./orchestrator.emitter";
import { emitExternalService } from "./external-service.emitter";
import { emitMiddleware } from "./middleware.emitter";

/* ────────────────────────────────────────────────────────────────────────
 * emitters/nestjs/index.ts — NestJS EMITTER_REGISTRY.
 *
 * nodeKind -> emitter mapping. `supported: true` -> full generation; `false` ->
 * stub (counted in summary.skippedKinds). Kinds absent from REGISTRY are also
 * written to skippedKinds by codegen.service (not silently dropped).
 *
 * ARCHITECTURE-AWARE INTEGRATION STATUS:
 *   - Backend chain (Controller/Service/Repository/DTO/Model/Table/Enum/
 *     Exception) -> supported: true (full generation).
 *   - Architecture infra types (Cache/MessageQueue/Worker/EventHandler/
 *     Orchestrator/ExternalService/Middleware/APIGateway/View) NOW full
 *     generation -> supported: true (real NestJS code). Module/scaffold wiring
 *     via ir.ts feature-inference + module.emitter + scaffold.emitter.
 *   - Module NOT in REGISTRY: synthesized per FEATURE, not per-node
 *     (orchestrator calls emitFeatureModule). Raw Module node if present used as
 *     feature SEED (ir.ts), does not emit its own file.
 *   - FrontendApp/UIComponent NOT in REGISTRY (EXCLUDED_KINDS): outside NestJS backend
 *     scope -> codegen.service isExcluded counts in skippedKinds without generating files
 *     (emitStub only runs on direct/test calls).
 *   - Scaffold (project-wide) does NOT enter REGISTRY; orchestrator calls separately.
 *
 * Order does not matter (Record); grouped by kind for readability.
 * ──────────────────────────────────────────────────────────────────────── */

export const EMITTER_REGISTRY: EmitterRegistry = {
  // ── Configuration ──
  Enum: { kind: "Enum", emit: emitEnum, supported: true },

  // ── Backend chain (full generation; Module excepted -> feature synthesis) ──
  Exception: { kind: "Exception", emit: emitException, supported: true },
  Controller: { kind: "Controller", emit: emitController, supported: true },
  Service: { kind: "Service", emit: emitService, supported: true },
  Repository: { kind: "Repository", emit: emitRepository, supported: true },
  DTO: { kind: "DTO", emit: emitDto, supported: true },
  Model: { kind: "Model", emit: emitModel, supported: true },
  Table: { kind: "Table", emit: emitTable, supported: true },
  // View is a DB view -> SQL migration (CREATE VIEW), at migrations/ root like Table.
  View: { kind: "View", emit: emitView, supported: true },

  // ── Architecture infra (full generation; real NestJS code) ──────────────────────
  Cache: { kind: "Cache", emit: emitCache, supported: true },
  MessageQueue: { kind: "MessageQueue", emit: emitMessageQueue, supported: true },
  Worker: { kind: "Worker", emit: emitWorker, supported: true },
  APIGateway: { kind: "APIGateway", emit: emitApiGateway, supported: true },
  EventHandler: { kind: "EventHandler", emit: emitEventHandler, supported: true },
  Orchestrator: { kind: "Orchestrator", emit: emitOrchestrator, supported: true },
  ExternalService: { kind: "ExternalService", emit: emitExternalService, supported: true },
  Middleware: { kind: "Middleware", emit: emitMiddleware, supported: true },

  // FrontendApp / UIComponent: outside backend scope (EXCLUDED_KINDS) -> NOT in REGISTRY;
  //   codegen.service isExcluded counts in skippedKinds without generating files.
  //   `emitStub` MINIMAL STUB only when called directly (in tests).
  // EnvironmentVariable NOT in REGISTRY: an env var is NOT a code module,
  //   it is config. Single representation: scaffold's src/.env.example + src/config/
  //   configuration.ts; meaningless `export class XStub {}` files are NOT
  //   generated. Unregistered -> codegen.service counts in skippedKinds.
};
