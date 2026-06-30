import { Injectable } from "@nestjs/common";
import type { EvaluationContext, EvaluationResult } from "../types";

/** WARN_COND_001 — warn when target Table has empty schema on Repository → QUERIES → Table. */
@Injectable()
export class EmptySchemaChecker {
  check(ctx: EvaluationContext): EvaluationResult {
    if (ctx.edgeKind !== "QUERIES") return { allowed: true };
    if (ctx.targetNode.type !== "Table") return { allowed: true };

    const columns = ((ctx.targetNode.properties as any).Columns ?? []) as unknown[];
    if (columns.length > 0) return { allowed: true };

    const tableName = (ctx.targetNode.properties as any).TableName ?? ctx.targetNode.id;
    return {
      allowed: true, // warning — edge still created
      severity: "warning",
      code: "WARN_COND_001",
      ruleViolated: "EMPTY_SCHEMA",
      message: `You are trying to query an empty table: '${tableName}'. The table's Columns are empty — the query may be meaningless.`,
      suggestion: "Add at least one Column to the Table node first.",
    };
  }
}
