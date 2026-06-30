import { Module } from "@nestjs/common";
import { GraphController } from "./graph.controller";
import { GraphService } from "./graph.service";
import { ProjectsModule } from "../projects/projects.module";
import { NodesModule } from "../nodes/nodes.module";
import { RulesModule } from "../rules/rules.module";
import { TabsModule } from "../tabs/tabs.module";

@Module({
  imports: [ProjectsModule, NodesModule, RulesModule, TabsModule],
  controllers: [GraphController],
  providers: [GraphService],
  exports: [GraphService],
})
export class GraphModule {}
