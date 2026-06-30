/** "Verify my architecture" — whole-graph rule review.
 *  POST /projects/:id/review re-evaluates every edge through the Rules Engine and
 *  returns a ranked Problems list. Deterministic (no LLM); same fetch+envelope
 *  pattern as codegen.ts. */

import { useMutation } from "@tanstack/react-query";
import { throwIfNotOk } from "./client";

export interface ReviewFinding {
  severity: "error" | "warning";
  code: string;
  message: string;
  suggestion?: string;
  ruleViolated?: string;
  docLink?: string;
  edgeId: string;
  edgeKind: string;
  /** [sourceId, targetId] — for focusEdge/focusNode. */
  nodeIds: string[];
}

export interface ReviewResult {
  findings: ReviewFinding[];
  summary: { total: number; errors: number; warnings: number; clean: boolean };
}

export function useReviewArchitecture(projectId: string) {
  return useMutation({
    mutationFn: async (): Promise<ReviewResult> => {
      const res = await fetch(`/api/v1/projects/${projectId}/review`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });
      await throwIfNotOk(res);
      const body = (await res.json()) as { success: boolean; data: ReviewResult };
      return body.data;
    },
  });
}
