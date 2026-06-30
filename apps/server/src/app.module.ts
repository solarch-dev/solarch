import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { UserThrottlerGuard } from "./common/guards/user-throttler.guard";
import { Neo4jModule } from "./neo4j/neo4j.module";
import { AuthModule } from "./auth/auth.module";
import { BillingModule } from "./billing/billing.module";
import { ProjectsModule } from "./projects/projects.module";
import { NodesModule } from "./nodes/nodes.module";
import { NodeTypesModule } from "./node-types/node-types.module";
import { EdgesModule } from "./edges/edges.module";
import { EdgeTypesModule } from "./edge-types/edge-types.module";
import { RulesModule } from "./rules/rules.module";
import { GraphModule } from "./graph/graph.module";
import { CodegenModule } from "./codegen/codegen.module";
import { AiModule } from "./ai/ai.module";
import { EmbeddingsModule } from "./embeddings/embeddings.module";
import { PatternsModule } from "./patterns/patterns.module";
import { TabsModule } from "./tabs/tabs.module";
import { ValueSetsModule } from "./value-sets/value-sets.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [
    // Global rate-limit: 60 istek/dk/kullanıcı (pahalı uçlar @Throttle ile daha sıkı).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    Neo4jModule,
    AuthModule,
    BillingModule,
    ProjectsModule,
    NodesModule,
    NodeTypesModule,
    EdgesModule,
    EdgeTypesModule,
    RulesModule,
    GraphModule,
    CodegenModule,
    AiModule,
    EmbeddingsModule,
    PatternsModule,
    TabsModule,
    ValueSetsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: UserThrottlerGuard }],
})
export class AppModule {}
