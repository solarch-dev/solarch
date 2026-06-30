import { Injectable } from "@nestjs/common";
import { Neo4jService } from "../../neo4j/neo4j.service";
import type { EvaluationContext, EvaluationResult } from "../types";

/** ERR_COND_001 — is there a reverse path on Service → CALLS → Service? */
@Injectable()
export class CircularDependencyChecker {
  constructor(private readonly neo4j: Neo4jService) {}

  async check(ctx: EvaluationContext): Promise<EvaluationResult> {
    if (ctx.edgeKind !== "CALLS") return { allowed: true };
    if (ctx.sourceNode.type !== "Service" || ctx.targetNode.type !== "Service") return { allowed: true };

    // If (target)-[:CALLS*1..10]->(source) path exists, new (source → target) creates a cycle.
    const result = await this.neo4j.run(
      `MATCH path = (t:Node {id: $targetId, projectId: $projectId})-[:CALLS*1..10]->(s:Node {id: $sourceId, projectId: $projectId})
       RETURN [n IN nodes(path) | coalesce(apoc.convert.fromJsonMap(n.properties).ServiceName, n.id)] AS chain
       LIMIT 1`,
      {
        sourceId: ctx.sourceNode.id,
        targetId: ctx.targetNode.id,
        projectId: ctx.projectId,
      },
    );

    if (result.records.length === 0) return { allowed: true };

    const chain = result.records[0].get("chain") as string[];
    const srcName = (ctx.sourceNode.properties as any).ServiceName ?? ctx.sourceNode.id;
    const tgtName = (ctx.targetNode.properties as any).ServiceName ?? ctx.targetNode.id;
    const culprit = [srcName, ...chain].join(" → ");

    return {
      allowed: false,
      severity: "error",
      code: "ERR_COND_001",
      ruleViolated: "CIRCULAR_DEPENDENCY",
      message: `Circular dependency detected: ${culprit}. '${tgtName}' already calls '${srcName}' directly or transitively — this connection leads to an infinite loop (Stack Overflow).`,
      suggestion:
        "To break the cycle, perform asynchronous decoupling with an Orchestrator (Saga pattern) or a MessageQueue (event-driven).",
    };
  }
}
