import { Module } from "@nestjs/common";
import { EdgesController } from "./edges.controller";
import { EdgesService } from "./edges.service";
import { EdgesRepository } from "./edges.repository";
import { NodesModule } from "../nodes/nodes.module";
import { RulesModule } from "../rules/rules.module";
import { ProjectsModule } from "../projects/projects.module";

@Module({
  imports: [NodesModule, RulesModule, ProjectsModule],
  controllers: [EdgesController],
  providers: [EdgesService, EdgesRepository],
  exports: [EdgesService, EdgesRepository],
})
export class EdgesModule {}
