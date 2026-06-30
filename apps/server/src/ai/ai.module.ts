import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { AiIdempotencyStore } from "./ai-idempotency.store";
import { ProjectsModule } from "../projects/projects.module";
import { GraphModule } from "../graph/graph.module";
import { PatternsModule } from "../patterns/patterns.module";
import { NodesModule } from "../nodes/nodes.module";
import { EdgesModule } from "../edges/edges.module";
import { TabsModule } from "../tabs/tabs.module";

@Module({
  imports: [ProjectsModule, GraphModule, PatternsModule, NodesModule, EdgesModule, TabsModule],
  controllers: [AiController],
  providers: [AiService, AiIdempotencyStore],
})
export class AiModule {}
