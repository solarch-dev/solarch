import { Body, Controller, Param, Post, HttpCode, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from "@nestjs/swagger";
import { ProjectAccessGuard } from "../auth/project-access.guard";
import { GraphService } from "./graph.service";
import { ApplyGraphDto } from "./dto/apply-graph.dto";
import { ok } from "../common/envelope";
import type { ApplyGraphResponse } from "./dto/apply-graph-response.dto";

@ApiTags("Graph")
@UseGuards(ProjectAccessGuard)
@Controller("projects/:projectId/graph")
export class GraphController {
  constructor(private readonly service: GraphService) {}

  @Post("apply")
  @HttpCode(200)
  @ApiOperation({
    summary: "Apply the architecture graph in bulk (AI batch)",
    description:
      "Processes multiple nodes + edges in a **single atomic transaction**. Used by the AI agent or the frontend for bulk-save.\n\n" +
      "Each node is validated with Zod, each edge with the Rules Engine + an in-batch circular-dependency check is performed. " +
      "**On any violation the entire batch is rolled back** (ROLLED_BACK) and `violations[]` + `suggestion`s are returned — the AI reads these and self-corrects.\n\n" +
      "Edges reference nodes by `tempId`; on success `idMap { tempId → permanent UUID }` is returned. Positions are assigned server-side via auto-grid.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data.success=true` → idMap + nodeCount + edgeCount. `data.success=false` → transactionStatus ROLLED_BACK + violations[]." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async apply(
    @Param("projectId") projectId: string,
    @Body() body: ApplyGraphDto,
  ): Promise<ApplyGraphResponse> {
    const result = await this.service.apply(projectId, body as any);
    return ok(result);
  }
}
