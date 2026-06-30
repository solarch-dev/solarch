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
 * nodeKind -> emitter eşlemesi. `supported: true` -> tam üretim; `false` ->
 * stub (summary.skippedKinds'e sayılır). REGISTRY'de HİÇ yer almayan kind'lar
 * da codegen.service tarafından skippedKinds'e yazılır (sessizce düşmez).
 *
 * MİMARİ-FARKINDA ENTEGRASYON DURUMU:
 *   - Backend zinciri (Controller/Service/Repository/DTO/Model/Table/Enum/
 *     Exception) -> supported: true (tam üretim).
 *   - Mimari altyapı tipleri (Cache/MessageQueue/Worker/EventHandler/
 *     Orchestrator/ExternalService/Middleware/APIGateway/View) ARTIK tam
 *     üretim -> supported: true (gerçek NestJS kodu). Module/scaffold wiring
 *     ir.ts feature-inference + module.emitter + scaffold.emitter ile bağlanır.
 *   - Module REGISTRY'de YOKTUR: per-node değil, FEATURE başına SENTEZLENİR
 *     (orchestrator emitFeatureModule çağırır). Ham Module node varsa feature
 *     SEED'i olarak kullanılır (ir.ts), ayrı dosya üretmez.
 *   - FrontendApp/UIComponent REGISTRY'de YOKTUR (EXCLUDED_KINDS): NestJS backend
 *     kapsamı DIŞI -> codegen.service isExcluded ile hiç dosya üretmeden
 *     skippedKinds'e sayar (emitStub yalnız doğrudan/test çağrısında çalışır).
 *   - Scaffold (proje-genel) REGISTRY'ye GİRMEZ; orchestrator ayrı çağırır.
 *
 * Sıra önemli değildir (Record); okunabilirlik için kind gruplarına göre dizilir.
 * ──────────────────────────────────────────────────────────────────────── */

export const EMITTER_REGISTRY: EmitterRegistry = {
  // ── Konfigürasyon ──
  Enum: { kind: "Enum", emit: emitEnum, supported: true },

  // ── Backend zinciri (tam üretim; Module hariç -> feature sentezi) ──
  Exception: { kind: "Exception", emit: emitException, supported: true },
  Controller: { kind: "Controller", emit: emitController, supported: true },
  Service: { kind: "Service", emit: emitService, supported: true },
  Repository: { kind: "Repository", emit: emitRepository, supported: true },
  DTO: { kind: "DTO", emit: emitDto, supported: true },
  Model: { kind: "Model", emit: emitModel, supported: true },
  Table: { kind: "Table", emit: emitTable, supported: true },
  // View bir DB view -> SQL migration (CREATE VIEW), Table gibi migrations/ kökünde.
  View: { kind: "View", emit: emitView, supported: true },

  // ── Mimari altyapı (tam üretim; gerçek NestJS kodu) ──────────────────────
  Cache: { kind: "Cache", emit: emitCache, supported: true },
  MessageQueue: { kind: "MessageQueue", emit: emitMessageQueue, supported: true },
  Worker: { kind: "Worker", emit: emitWorker, supported: true },
  APIGateway: { kind: "APIGateway", emit: emitApiGateway, supported: true },
  EventHandler: { kind: "EventHandler", emit: emitEventHandler, supported: true },
  Orchestrator: { kind: "Orchestrator", emit: emitOrchestrator, supported: true },
  ExternalService: { kind: "ExternalService", emit: emitExternalService, supported: true },
  Middleware: { kind: "Middleware", emit: emitMiddleware, supported: true },

  // FrontendApp / UIComponent: backend kapsamı DIŞI (EXCLUDED_KINDS) -> REGISTRY'de
  //   YOKTUR; codegen.service isExcluded ile hiç dosya üretmeden skippedKinds'e sayar.
  //   `emitStub` MINIMAL STUB olarak yalnız doğrudan çağrıldığında (testte) çalışır.
  // EnvironmentVariable REGISTRY'de YOKTUR: bir ortam değişkeni kod modülü DEĞİL,
  //   config'tir. Tek temsili scaffold'daki src/.env.example + src/config/
  //   configuration.ts olmalı; anlamsız `export class XStub {}` dosyası
  //   ÜRETİLMEZ. Kayıtsız -> codegen.service skippedKinds'e sayar.
};
