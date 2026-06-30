import { Module } from "@nestjs/common";
import { NodesController } from "./nodes.controller";
import { NodesService } from "./nodes.service";
import { NodesRepository } from "./nodes.repository";
import { ProjectsModule } from "../projects/projects.module";
import { TabsModule } from "../tabs/tabs.module";

@Module({
  imports: [ProjectsModule, TabsModule],
  controllers: [NodesController],
  providers: [NodesService, NodesRepository],
  exports: [NodesRepository, NodesService],
})
export class NodesModule {}
