import { Module } from "@nestjs/common";
import { Neo4jModule } from "../neo4j/neo4j.module";
import { TabsController } from "./tabs.controller";
import { TabsService } from "./tabs.service";
import { TabsRepository } from "./tabs.repository";

@Module({
  imports: [Neo4jModule],
  controllers: [TabsController],
  providers: [TabsService, TabsRepository],
  exports: [TabsService, TabsRepository],
})
export class TabsModule {}
