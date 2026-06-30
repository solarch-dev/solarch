import { Controller, Param, Post, HttpCode, UseGuards, NotFoundException } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from "@nestjs/swagger";
import { ProjectAccessGuard } from "../auth/project-access.guard";
import { ProjectsRepository } from "../projects/projects.repository";
import { RulesEngine } from "./rules.engine";
import { ok } from "../common/envelope";
import type { NodeKind } from "../nodes/schemas";
import type { EdgeKind } from "../edges/schemas/edge.schema";

/** "Verify my architecture" — whole-graph rule review.
 *  ProjectAccessGuard + ProjectsRepository @Global AuthModule'den gelir;
 *  ekstra module import gerekmez. */
@ApiTags("Rules")
@UseGuards(ProjectAccessGuard)
@Controller("projects/:projectId")
export class ReviewController {
  constructor(
    private readonly engine: RulesEngine,
    private readonly projects: ProjectsRepository,
  ) {}

  @Post("review")
  @HttpCode(200)
  @ApiOperation({
    summary: "Verify the architecture (whole-graph rule review)",
    description:
      "Re-evaluates every existing edge against the Rules Engine (blacklist → default-deny whitelist → " +
      "conditional checks) and returns a ranked Problems list (errors first). Deterministic — no LLM, no mutation. " +
      "Response: `data: { findings, summary: { total, errors, warnings, clean } }`.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "Ranked findings + summary." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async review(@Param("projectId") projectId: string) {
    if (!(await this.projects.exists(projectId))) {
      throw new NotFoundException({ code: "ERR_PROJECT_NOT_FOUND", message: `Project '${projectId}' not found.` });
    }
    const { nodes, edges } = await this.projects.getGraph(projectId);
    const findings = await this.engine.reviewGraph(
      projectId,
      nodes.map((n) => ({ id: n.id, type: n.type as NodeKind, properties: n.properties as Record<string, unknown> })),
      edges.map((e) => ({ id: e.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, kind: e.kind as EdgeKind })),
    );
    const errors = findings.filter((f) => f.severity === "error").length;
    const warnings = findings.filter((f) => f.severity === "warning").length;
    return ok({ findings, summary: { total: findings.length, errors, warnings, clean: findings.length === 0 } });
  }
}
