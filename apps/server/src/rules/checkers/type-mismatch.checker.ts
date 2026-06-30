import { Injectable } from "@nestjs/common";
import type { EvaluationContext, EvaluationResult } from "../types";

/** ERR_COND_002 — Controller → CALLS → Service RequestDTORef ↔ Parameter alignment. */
@Injectable()
export class TypeMismatchChecker {
  check(ctx: EvaluationContext): EvaluationResult {
    if (ctx.edgeKind !== "CALLS") return { allowed: true };
    if (ctx.sourceNode.type !== "Controller" || ctx.targetNode.type !== "Service") return { allowed: true };

    const ctrlEndpoints = ((ctx.sourceNode.properties as any).Endpoints ?? []) as Array<{
      RequestDTORef?: string;
    }>;
    const srvMethods = ((ctx.targetNode.properties as any).Methods ?? []) as Array<{
      Parameters?: Array<{ Type?: string; DtoRef?: string }>;
    }>;

    const ctrlDTOs = new Set<string>();
    for (const ep of ctrlEndpoints) {
      if (ep.RequestDTORef) ctrlDTOs.add(ep.RequestDTORef);
    }
    // Skip when Controller specifies no RequestDTORef (e.g. GET-only endpoints)
    if (ctrlDTOs.size === 0) return { allowed: true };

    const srvInputTypes = new Set<string>();
    for (const m of srvMethods) {
      for (const p of m.Parameters ?? []) {
        // DtoRef preferred (DTO reference), else raw Type.
        if (p.DtoRef) srvInputTypes.add(p.DtoRef);
        if (p.Type) srvInputTypes.add(p.Type);
      }
    }
    // Skip when Service expects no parameters
    if (srvInputTypes.size === 0) return { allowed: true };

    const matches = [...ctrlDTOs].filter((dto) => srvInputTypes.has(dto));
    if (matches.length > 0) return { allowed: true };

    return {
      allowed: false,
      severity: "error",
      code: "ERR_COND_002",
      ruleViolated: "TYPE_MISMATCH",
      message: `Parameter type mismatch: the Controller RequestDTORefs [${[...ctrlDTOs].join(", ")}] do not match any of the Service parameter types [${[...srvInputTypes].join(", ")}].`,
      suggestion:
        "Make the Controller endpoint's RequestDTORef or the Service method's parameter type (Type/DtoRef) compatible; or add a mapping/adapter layer.",
    };
  }
}
