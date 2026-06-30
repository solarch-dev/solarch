import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import neo4j, { Driver, Session, ManagedTransaction, QueryResult } from "neo4j-driver";

export interface Neo4jConfig {
  uri: string;
  user: string;
  password: string;
  // Connection pool / timeout (opsiyonel — verilmezse makul launch default'u).
  maxConnectionPoolSize?: number;
  connectionAcquisitionTimeout?: number;
  connectionTimeout?: number;
  maxTransactionRetryTime?: number;
  maxConnectionLifetime?: number;
}

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private driver!: Driver;

  constructor(private readonly config: Neo4jConfig) {}

  async onModuleInit(): Promise<void> {
    this.driver = neo4j.driver(
      this.config.uri,
      neo4j.auth.basic(this.config.user, this.config.password),
      {
        disableLosslessIntegers: true,
        // ?? default'lar: {uri,user,password} ile çağıran migration/seed/test
        // call-site'ları (pool config geçmez) kırılmadan makul varsayılan alır.
        maxConnectionPoolSize: this.config.maxConnectionPoolSize ?? 50,
        connectionAcquisitionTimeout: this.config.connectionAcquisitionTimeout ?? 60_000,
        connectionTimeout: this.config.connectionTimeout ?? 30_000,
        maxTransactionRetryTime: this.config.maxTransactionRetryTime ?? 30_000,
        maxConnectionLifetime: this.config.maxConnectionLifetime ?? 3_600_000,
      },
    );
    await this.driver.verifyConnectivity();
  }

  async onModuleDestroy(): Promise<void> {
    await this.driver?.close();
  }

  /** Readiness kontrolü — havuzdan gerçek bir session+query alır (RETURN 1).
   *  DB erişilemezse fırlatır (çağıran 503'e çevirir). verifyConnectivity'den daha temsili. */
  async ping(): Promise<void> {
    await this.run("RETURN 1 AS ok");
  }

  async run(cypher: string, params?: Record<string, unknown>): Promise<QueryResult> {
    const session: Session = this.driver.session();
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  async write<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    const session: Session = this.driver.session();
    try {
      return await session.executeWrite(work);
    } finally {
      await session.close();
    }
  }

  async read<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    const session: Session = this.driver.session();
    try {
      return await session.executeRead(work);
    } finally {
      await session.close();
    }
  }
}
