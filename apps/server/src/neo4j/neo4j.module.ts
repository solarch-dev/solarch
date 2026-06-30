import { Global, Module } from "@nestjs/common";
import { Neo4jService } from "./neo4j.service";
import { env } from "../config/env";

@Global()
@Module({
  providers: [
    {
      provide: Neo4jService,
      useFactory: () => new Neo4jService({
        uri: env.NEO4J_URI,
        user: env.NEO4J_USER,
        password: env.NEO4J_PASSWORD,
        maxConnectionPoolSize: env.NEO4J_MAX_POOL_SIZE,
        connectionAcquisitionTimeout: env.NEO4J_CONNECTION_ACQUISITION_TIMEOUT_MS,
        connectionTimeout: env.NEO4J_CONNECTION_TIMEOUT_MS,
        maxTransactionRetryTime: env.NEO4J_MAX_TX_RETRY_TIME_MS,
        maxConnectionLifetime: env.NEO4J_MAX_CONNECTION_LIFETIME_MS,
      }),
    },
  ],
  exports: [Neo4jService],
})
export class Neo4jModule {}
