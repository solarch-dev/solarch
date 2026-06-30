import { Module } from "@nestjs/common";
import { CodegenController } from "./codegen.controller";
import { CodegenService } from "./codegen.service";
import { CodegenFillService } from "./codegen-fill.service";
import { CodegenDepsWarmupService } from "./codegen-deps-warmup.service";
import { ImportResolverService } from "./import-resolver.service";
import { SurgicalFillRepository } from "./surgical-fill.repository";
import { ProjectsModule } from "../projects/projects.module";
import { NodesModule } from "../nodes/nodes.module";
import { EdgesModule } from "../edges/edges.module";
import { BillingModule } from "../billing/billing.module";

@Module({
  imports: [ProjectsModule, NodesModule, EdgesModule, BillingModule],
  controllers: [CodegenController],
  providers: [CodegenService, CodegenFillService, CodegenDepsWarmupService, ImportResolverService, SurgicalFillRepository],
  exports: [CodegenService],
})
export class CodegenModule {}
