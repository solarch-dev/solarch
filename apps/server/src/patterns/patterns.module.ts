import { Module } from "@nestjs/common";
import { Neo4jModule } from "../neo4j/neo4j.module";
import { ProjectsModule } from "../projects/projects.module";
import { EmbeddingsModule } from "../embeddings/embeddings.module";
import { PatternsController } from "./patterns.controller";
import { PatternsService } from "./patterns.service";
import { PatternsRepository } from "./patterns.repository";

@Module({
  imports: [Neo4jModule, ProjectsModule, EmbeddingsModule],
  controllers: [PatternsController],
  providers: [PatternsService, PatternsRepository],
  exports: [PatternsService],
})
export class PatternsModule {}
