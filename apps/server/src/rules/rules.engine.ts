import { Injectable } from "@nestjs/common";
import type { NodeKind } from "../nodes/schemas";
import type { EdgeKind } from "../edges/schemas/edge.schema";
import type { StoredNode } from "../nodes/nodes.repository";
import { WHITELIST } from "./registry/whitelist";
import { BLACKLIST } from "./registry/blacklist";
import { CONDITIONAL_RULES } from "./registry/conditional";
import { CircularDependencyChecker } from "./checkers/circular-dependency.checker";
import { TypeMismatchChecker } from "./checkers/type-mismatch.checker";
import { EmptySchemaChecker } from "./checkers/empty-schema.checker";
import type {
  AllowRule,
  DenyRule,
  EvaluationContext,
  EvaluationResult,
  NodeKindOrWildcard,
  EdgeKindOrWildcard,
  ReviewFinding,
} from "./types";

@Injectable()
export class RulesEngine {
  constructor(
    private readonly circularChecker: CircularDependencyChecker,
    private readonly typeMismatchChecker: TypeMismatchChecker,
    private readonly emptySchemaChecker: EmptySchemaChecker,
  ) {}

  /** 3 fazlı evaluator: blacklist → whitelist (default deny) → conditional. */
  async evaluate(ctx: EvaluationContext): Promise<EvaluationResult> {
    // 1. Blacklist — keskin yasak
    const denyHit = this.checkBlacklist(ctx);
    if (denyHit) return denyHit;

    // 2. Whitelist — default deny
    const allowHit = this.checkWhitelist(ctx);
    if (!allowHit) {
      return {
        allowed: false,
        severity: "error",
        code: "ERR_NOT_WHITELISTED",
        ruleViolated: `${ctx.sourceNode.type} → ${ctx.edgeKind} → ${ctx.targetNode.type}`,
        message: `The '${ctx.sourceNode.type} → ${ctx.edgeKind} → ${ctx.targetNode.type}' combination is not permitted in the plans/Rules Matrix. Per the plans: any connection that is not explicitly specified is FORBIDDEN by default.`,
        suggestion:
          "Use GET /api/v1/rules to see the allowed (whitelist) connections and build the correct chain (e.g. Controller → Service → Repository → Table).",
      };
    }

    // 3. Conditional — derin kontroller
    const circular = await this.circularChecker.check(ctx);
    if (!circular.allowed) return circular;

    const typeMismatch = this.typeMismatchChecker.check(ctx);
    if (!typeMismatch.allowed) return typeMismatch;

    const emptySchema = this.emptySchemaChecker.check(ctx);
    if (emptySchema.severity === "warning") return emptySchema;

    return { allowed: true };
  }

  /** Whole-graph review — her mevcut edge'i Rules Engine'den geçirip sıralı
   *  Problems listesi döndürür (errors önce). Deterministik; LLM yok, mutasyon
   *  yok. "Verify my architecture" Pass-1. evaluate() çoğu edge için ucuzdur
   *  (circular Neo4j sorgusu yalnız Service→Service CALLS'ta tetiklenir). */
  async reviewGraph(
    projectId: string,
    nodes: { id: string; type: NodeKind; properties: Record<string, unknown> }[],
    edges: { id: string; sourceNodeId: string; targetNodeId: string; kind: EdgeKind }[],
  ): Promise<ReviewFinding[]> {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const findings: ReviewFinding[] = [];
    for (const e of edges) {
      const source = byId.get(e.sourceNodeId);
      const target = byId.get(e.targetNodeId);
      if (!source || !target) {
        findings.push({
          severity: "error",
          code: "ERR_DANGLING_EDGE",
          message: `Edge references a node that no longer exists (${e.sourceNodeId} -[${e.kind}]-> ${e.targetNodeId}).`,
          suggestion: "Delete this edge or restore the missing node.",
          edgeId: e.id,
          edgeKind: e.kind,
          nodeIds: [e.sourceNodeId, e.targetNodeId],
        });
        continue;
      }
      const result = await this.evaluate({
        projectId,
        sourceNode: source as unknown as StoredNode,
        targetNode: target as unknown as StoredNode,
        edgeKind: e.kind,
      });
      if (result.code) {
        findings.push({
          severity: result.severity ?? "error",
          code: result.code,
          message: result.message ?? "Rule violation.",
          suggestion: result.suggestion,
          ruleViolated: result.ruleViolated,
          docLink: result.docLink,
          edgeId: e.id,
          edgeKind: e.kind,
          nodeIds: [source.id, target.id],
        });
      }
    }
    findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
    return findings;
  }

  /** Belirli bir node tipi için ilgili tüm whitelist + blacklist kuralları. */
  rulesForNodeKind(kind: NodeKind) {
    const allowAsSource = WHITELIST.filter((r) => matchesKind(r.source, kind));
    const allowAsTarget = WHITELIST.filter((r) => matchesKind(r.target, kind));
    const denyAsSource = BLACKLIST.filter((r) => matchesDenyKind(r.source, kind));
    const denyAsTarget = BLACKLIST.filter((r) => matchesDenyKind(r.target, kind));
    return { allowAsSource, allowAsTarget, denyAsSource, denyAsTarget };
  }

  /** Belirli bir edge tipi için ilgili tüm whitelist + blacklist kuralları. */
  rulesForEdgeKind(kind: EdgeKind) {
    const allow = WHITELIST.filter((r) => matchesEdge(r.edge, kind));
    const deny = BLACKLIST.filter((r) => matchesDenyEdge(r.edge, kind));
    return { allow, deny };
  }

  catalog() {
    return {
      whitelist: WHITELIST,
      blacklist: BLACKLIST,
      conditional: CONDITIONAL_RULES,
      defaults: {
        unmatchedBehavior: "deny",
        reason: "Plans/Rules Matrix: any connection that is not explicitly specified is FORBIDDEN.",
      },
    };
  }

  private checkBlacklist(ctx: EvaluationContext): EvaluationResult | null {
    for (const rule of BLACKLIST) {
      if (
        matchesDenyKind(rule.source, ctx.sourceNode.type) &&
        matchesDenyEdge(rule.edge, ctx.edgeKind) &&
        matchesDenyKind(rule.target, ctx.targetNode.type)
      ) {
        return {
          allowed: false,
          severity: "error",
          code: rule.code,
          ruleViolated: `${asStr(rule.source)} → ${asStr(rule.edge)} → ${asStr(rule.target)}`,
          message: rule.message,
          suggestion: rule.suggestion,
          docLink: rule.docLink,
        };
      }
    }
    return null;
  }

  private checkWhitelist(ctx: EvaluationContext): AllowRule | null {
    for (const rule of WHITELIST) {
      if (
        matchesKind(rule.source, ctx.sourceNode.type) &&
        matchesEdge(rule.edge, ctx.edgeKind) &&
        matchesKind(rule.target, ctx.targetNode.type)
      ) {
        return rule;
      }
    }
    return null;
  }
}

function matchesKind(spec: NodeKind | NodeKind[], target: NodeKind): boolean {
  return Array.isArray(spec) ? spec.includes(target) : spec === target;
}

function matchesEdge(spec: EdgeKind | EdgeKind[], target: EdgeKind): boolean {
  return Array.isArray(spec) ? spec.includes(target) : spec === target;
}

function matchesDenyKind(
  spec: NodeKindOrWildcard | NodeKindOrWildcard[],
  target: NodeKind,
): boolean {
  if (spec === "*") return true;
  if (Array.isArray(spec)) return spec.includes("*") || spec.includes(target);
  return spec === target;
}

function matchesDenyEdge(
  spec: EdgeKindOrWildcard | EdgeKindOrWildcard[],
  target: EdgeKind,
): boolean {
  if (spec === "*") return true;
  if (Array.isArray(spec)) return spec.includes("*") || spec.includes(target);
  return spec === target;
}

function asStr(v: string | string[]): string {
  return Array.isArray(v) ? `[${v.join("|")}]` : v;
}

function asStrAny(v: unknown): string {
  return typeof v === "string" ? v : Array.isArray(v) ? `[${v.join("|")}]` : String(v);
}
