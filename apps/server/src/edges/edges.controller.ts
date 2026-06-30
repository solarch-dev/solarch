import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse } from "@nestjs/swagger";
import { ProjectAccessGuard } from "../auth/project-access.guard";
import { EdgesService } from "./edges.service";
import { CreateEdgeDto } from "./dto/create-edge.dto";
import { UpdateEdgeDto } from "./dto/update-edge.dto";
import { ValidateEdgeDto } from "./dto/validate-edge.dto";
import { ok } from "../common/envelope";
import type {
  EdgeResponse,
  EdgeCreatedResponse,
  EdgeListResponse,
  EdgeValidationResponse,
} from "./dto/edge-response.dto";
import { EDGE_KINDS, type EdgeKind } from "./schemas/edge.schema";

@ApiTags("Edges")
@UseGuards(ProjectAccessGuard)
@Controller("projects/:projectId/edges")
export class EdgesController {
  constructor(private readonly service: EdgesService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: "Create a new edge (protected by the Rules Engine)",
    description:
      "Creates a directed connection between two nodes. The **Rules Engine** applies: a connection that is not in the whitelist or that hits the blacklist is rejected (409). Self-loops and duplicates are also blocked. The source/target node + project must exist.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 201, description: "Edge created — full edge object. If there is a non-blocking rule warning (e.g. `WARN_COND_001` empty-table), `data.warning: { code, message, suggestion? }` is attached." })
  @ApiResponse({ status: 400, description: "`ERR_SCHEMA_INVALID`, `ERR_PROJECT_MISMATCH` or `ERR_EDGE_SELF_LOOP`." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`, `ERR_EDGE_SOURCE_NOT_FOUND` or `ERR_EDGE_TARGET_NOT_FOUND`." })
  @ApiResponse({ status: 409, description: "`ERR_EDGE_DUPLICATE`, `ERR_001..ERR_007` (blacklist), `ERR_COND_001/002` (conditional) or `ERR_NOT_WHITELISTED` (default deny). `error.suggestion` proposes a fix." })
  async create(
    @Param("projectId") projectId: string,
    @Body() body: CreateEdgeDto,
  ): Promise<EdgeCreatedResponse> {
    const created = await this.service.create(projectId, body as any);
    return ok(created);
  }

  @Get()
  @ApiOperation({
    summary: "List edges",
    description: "Returns the edges in the project. Can be filtered (and combined) with `?kind=CALLS`, `?sourceNodeId=...`, `?targetNodeId=...`.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiQuery({ name: "kind", required: false, description: "Edge kind filter (e.g. `CALLS`).", example: "CALLS" })
  @ApiQuery({ name: "sourceNodeId", required: false, description: "Source node UUID filter." })
  @ApiQuery({ name: "targetNodeId", required: false, description: "Target node UUID filter." })
  @ApiResponse({ status: 200, description: "`data: { edges: [...], total }`." })
  async list(
    @Param("projectId") projectId: string,
    @Query("kind") kind: string | undefined,
    @Query("sourceNodeId") sourceNodeId: string | undefined,
    @Query("targetNodeId") targetNodeId: string | undefined,
  ): Promise<EdgeListResponse> {
    const filterKind =
      kind && (EDGE_KINDS as readonly string[]).includes(kind) ? (kind as EdgeKind) : undefined;
    const edges = await this.service.list(projectId, {
      kind: filterKind,
      sourceNodeId,
      targetNodeId,
    });
    return ok({ edges, total: edges.length });
  }

  @Get(":edgeId")
  @ApiOperation({ summary: "Single edge", description: "Returns the given edge with source/target/kind/properties." })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiParam({ name: "edgeId", description: "Edge UUID" })
  @ApiResponse({ status: 200, description: "Full edge object." })
  @ApiResponse({ status: 404, description: "`ERR_EDGE_NOT_FOUND`." })
  async getById(
    @Param("projectId") projectId: string,
    @Param("edgeId") edgeId: string,
  ): Promise<EdgeResponse> {
    const edge = await this.service.getById(projectId, edgeId);
    return ok(edge);
  }

  @Patch(":edgeId")
  @ApiOperation({
    summary: "Update edge (properties only)",
    description:
      "Only `properties` (Label/IsAsync/Protocol/RetryCount) are updated. `kind`/`sourceNodeId`/`targetNodeId` are **immutable** — `ERR_EDGE_IMMUTABLE`. To change the connection, delete and recreate.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiParam({ name: "edgeId", description: "Edge UUID" })
  @ApiResponse({ status: 200, description: "Updated edge." })
  @ApiResponse({ status: 400, description: "`ERR_SCHEMA_INVALID`, `ERR_EDGE_IMMUTABLE` or `ERR_PATCH_EMPTY`." })
  @ApiResponse({ status: 404, description: "`ERR_EDGE_NOT_FOUND`." })
  async update(
    @Param("projectId") projectId: string,
    @Param("edgeId") edgeId: string,
    @Body() body: UpdateEdgeDto,
  ): Promise<EdgeResponse> {
    const updated = await this.service.update(projectId, edgeId, body as any);
    return ok(updated);
  }

  @Delete(":edgeId")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete edge", description: "Deletes the connection. The nodes are not affected." })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiParam({ name: "edgeId", description: "Edge UUID" })
  @ApiResponse({ status: 204, description: "Deleted (no body)." })
  @ApiResponse({ status: 404, description: "`ERR_EDGE_NOT_FOUND`." })
  async delete(
    @Param("projectId") projectId: string,
    @Param("edgeId") edgeId: string,
  ): Promise<void> {
    await this.service.delete(projectId, edgeId);
  }

  @Post("validate")
  @HttpCode(200)
  @ApiOperation({
    summary: "Pre-validate the connection (does not write to the DB)",
    description:
      "Runs the Rules Engine check **before** an edge is created — writes nothing to the DB. Called while the user drags an arrow in the UI or before the AI creates a connection. Returns `{ isValid, severity?, engineResult? }`; `engineResult.suggestion` proposes a fix.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "Always 200. `data.isValid` true/false — the rule result is in `data.engineResult`." })
  async validate(
    @Param("projectId") projectId: string,
    @Body() body: ValidateEdgeDto,
  ): Promise<EdgeValidationResponse> {
    const result = await this.service.validate(projectId, body as any);
    return ok(result);
  }
}
