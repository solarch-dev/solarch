import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse } from "@nestjs/swagger";
import { ProjectAccessGuard } from "../auth/project-access.guard";
import { NodesService } from "./nodes.service";
import { CreateNodeDto } from "./dto/create-node.dto";
import { UpdateNodeDto } from "./dto/update-node.dto";
import { ok } from "../common/envelope";
import type { NodeResponse, NodeListResponse } from "./dto/node-response.dto";
import { NODE_KINDS, type NodeKind } from "./schemas";

// All 21 NodeKinds — old list only included Data family (5 types), so queries like
// ?type=Exception were silently ignored for other types.
const KIND_VALUES: readonly NodeKind[] = NODE_KINDS;

@ApiTags("Nodes")
@UseGuards(ProjectAccessGuard)
@Controller("projects/:projectId/nodes")
export class NodesController {
  constructor(private readonly service: NodesService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: "Create a new node",
    description:
      "Adds a new building block to the project. Based on the body's `type` (kind) discriminator, the **kind-specific `properties`** are validated with Zod. If `id`/timestamp are not provided the server generates them. The project must exist (strict integrity) and `*Name` must be unique within the project.",
  })
  @ApiParam({ name: "projectId", description: "UUID of the project the node belongs to" })
  @ApiResponse({ status: 201, description: "Node created — returns the full node object." })
  @ApiResponse({ status: 400, description: "`ERR_SCHEMA_INVALID` (schema) or `ERR_PROJECT_MISMATCH` (URL ≠ body projectId)." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND` — create the project first." })
  @ApiResponse({ status: 409, description: "`ERR_ID_CONFLICT` (id exists) or `ERR_NAME_DUPLICATE` (*Name collision)." })
  async create(
    @Param("projectId") projectId: string,
    @Body() body: CreateNodeDto,
  ): Promise<NodeResponse> {
    const created = await this.service.create(projectId, body as any);
    return ok(created);
  }

  @Get()
  @ApiOperation({
    summary: "List nodes",
    description: "Returns the nodes in the project. Can be filtered to a single kind with the `?type=Table` query.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiQuery({ name: "type", required: false, description: "Node kind filter (e.g. `Table`, `Service`). Invalid values are ignored.", example: "Service" })
  @ApiResponse({ status: 200, description: "`data: { nodes: [...], total }`." })
  async list(
    @Param("projectId") projectId: string,
    @Query("type") type: string | undefined,
  ): Promise<NodeListResponse> {
    const kind = type && KIND_VALUES.includes(type as NodeKind) ? (type as NodeKind) : undefined;
    const nodes = await this.service.list(projectId, kind);
    return ok({ nodes, total: nodes.length });
  }

  @Get(":nodeId")
  @ApiOperation({ summary: "Single node", description: "Returns the given node with its full properties." })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiParam({ name: "nodeId", description: "Node UUID" })
  @ApiResponse({ status: 200, description: "Full node object." })
  @ApiResponse({ status: 404, description: "`ERR_NODE_NOT_FOUND`." })
  async getById(
    @Param("projectId") projectId: string,
    @Param("nodeId") nodeId: string,
  ): Promise<NodeResponse> {
    const node = await this.service.getById(projectId, nodeId);
    return ok(node);
  }

  @Patch(":nodeId")
  @ApiOperation({
    summary: "Update node (field-level replace)",
    description:
      "`position` and/or `properties` are replaced with the full given object (no deep merge). `type` (kind) is **immutable** — if attempted, `ERR_KIND_IMMUTABLE`.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiParam({ name: "nodeId", description: "Node UUID" })
  @ApiResponse({ status: 200, description: "Updated node (`updatedAt` is refreshed)." })
  @ApiResponse({ status: 400, description: "`ERR_SCHEMA_INVALID` or `ERR_KIND_IMMUTABLE`." })
  @ApiResponse({ status: 404, description: "`ERR_NODE_NOT_FOUND`." })
  async update(
    @Param("projectId") projectId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: UpdateNodeDto,
  ): Promise<NodeResponse> {
    const updated = await this.service.update(projectId, nodeId, body as any);
    return ok(updated);
  }

  @Delete(":nodeId")
  @HttpCode(204)
  @ApiOperation({
    summary: "Delete node",
    description: "Deletes the node and its attached edges (DETACH). Not idempotent — 404 if it does not exist.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiParam({ name: "nodeId", description: "Node UUID" })
  @ApiResponse({ status: 204, description: "Deleted (no body)." })
  @ApiResponse({ status: 404, description: "`ERR_NODE_NOT_FOUND`." })
  async delete(
    @Param("projectId") projectId: string,
    @Param("nodeId") nodeId: string,
  ): Promise<void> {
    await this.service.delete(projectId, nodeId);
  }
}
