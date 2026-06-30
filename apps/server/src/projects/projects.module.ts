import { Module } from "@nestjs/common";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { ProjectsRepository } from "./projects.repository";
import { TabsModule } from "../tabs/tabs.module";

// Nodes/Edges/Graph import this. TabsModule depends only on Neo4jModule,
// so Projects → Tabs is one-way (no cycle).
@Module({
  imports: [TabsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepository],
  exports: [ProjectsRepository],
})
export class ProjectsModule {}
