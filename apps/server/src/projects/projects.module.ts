import { Module } from "@nestjs/common";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { ProjectsRepository } from "./projects.repository";
import { TabsModule } from "../tabs/tabs.module";
import { BillingModule } from "../billing/billing.module";

// Nodes/Edges/Graph bunu import eder. TabsModule yalnızca Neo4jModule'e bağlı
// olduğundan Projects → Tabs tek yönlü (döngü yok).
@Module({
  imports: [TabsModule, BillingModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepository],
  exports: [ProjectsRepository],
})
export class ProjectsModule {}
