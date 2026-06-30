import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from "@nestjs/swagger";
import { ProjectsService } from "./projects.service";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { ReportImplementationDto } from "./dto/report-implementation.dto";
import { CurrentAuth } from "../auth/current-auth.decorator";
import type { AuthContext } from "../auth/auth.types";
import { ok } from "../common/envelope";
import type {
  ProjectResponse,
  ProjectListResponse,
  ProjectGraphResponse,
} from "./dto/project-response.dto";

@ApiTags("Projects")
@Controller("projects")
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: "Create a new project",
    description:
      "Opens a new architecture project (workspace). The project must exist before adding nodes/edges. If `id` is not provided the server generates a UUID. If `status` is not provided it defaults to `draft`.",
  })
  @ApiResponse({ status: 201, description: "Project created. `data` returns the project + `counts: {nodes:0, edges:0}`." })
  @ApiResponse({ status: 400, description: "`ERR_SCHEMA_INVALID` — name/description missing or invalid status." })
  @ApiResponse({ status: 409, description: "`ERR_ID_CONFLICT` — the given `id` is already in use." })
  async create(@Body() body: CreateProjectDto, @CurrentAuth() auth: AuthContext): Promise<ProjectResponse> {
    const created = await this.service.create(body as any, auth);
    return ok(created);
  }

  @Get()
  @ApiOperation({
    summary: "List projects",
    description: "Returns all projects (newest first). Each project includes `counts` (node + edge count).",
  })
  @ApiResponse({ status: 200, description: "`data: { projects: [...], total }`." })
  async list(@CurrentAuth() auth: AuthContext): Promise<ProjectListResponse> {
    const projects = await this.service.list(auth);
    return ok({ projects, total: projects.length });
  }

  @Post("claim-guest")
  @HttpCode(200)
  @ApiOperation({
    summary: "Claim guest projects",
    description:
      "Transfers the project(s) drawn with a guest token (`X-Guest-Token` trial) to the signed-in account. Invalid or empty tokens return an empty list. Counts toward the user's own project cap.",
  })
  @ApiResponse({ status: 200, description: "`data: { projects: [...], total }` — claimed projects." })
  @ApiResponse({ status: 402, description: "`ERR_PLAN_LIMIT` — claiming would exceed the user's project cap." })
  async claimGuest(
    @Body() body: { token?: string },
    @CurrentAuth() auth: AuthContext,
  ): Promise<ProjectListResponse> {
    const projects = await this.service.claimGuestProjects(body?.token ?? "", auth);
    return ok({ projects, total: projects.length });
  }

  @Get(":projectId")
  @ApiOperation({
    summary: "Single project (+ counts)",
    description: "Returns the given project with node/edge `counts`.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID", example: "f773f8ac-b3f0-46ac-ac79-6d9106fe4adc" })
  @ApiResponse({ status: 200, description: "Project + counts." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async getById(@Param("projectId") projectId: string, @CurrentAuth() auth: AuthContext): Promise<ProjectResponse> {
    const project = await this.service.getById(projectId, auth);
    return ok(project);
  }

  @Get(":projectId/graph")
  @ApiOperation({
    summary: "The project's full graph",
    description:
      "Returns **all of the project's nodes + edges in a single request**: `{ project, nodes[], edges[], counts }`. Ideal for loading the frontend canvas.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "Full graph: project + nodes + edges + counts." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async getGraph(@Param("projectId") projectId: string, @CurrentAuth() auth: AuthContext): Promise<ProjectGraphResponse> {
    const graph = await this.service.getGraph(projectId, auth);
    return ok(graph);
  }

  @Put(":projectId/implementation")
  @HttpCode(200)
  @ApiOperation({
    summary: "Report implementation status (surgical fill counters)",
    description:
      "Written by the Solarch CLI (`solarch status --report`) and the VS Code extension. Stores per-node " +
      "implementation counters (`implTotal`, `implFilled`, `implAi`) derived from `@solarch:surgical` markers " +
      "in the codebase. NOT a structural mutation: `graphRevision` is not bumped and node `version` does not " +
      "change. Unknown nodeIds are silently skipped. The canvas uses these counters for completion badges.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: { updated }` — number of nodes that received counters." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async reportImplementation(
    @Param("projectId") projectId: string,
    @Body() body: ReportImplementationDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ReturnType<typeof ok<{ updated: number }>>> {
    const result = await this.service.reportImplementation(projectId, body.entries, auth);
    return ok(result);
  }

  @Patch(":projectId")
  @ApiOperation({
    summary: "Update the project",
    description: "Only `name`, `description` and `status` can be updated (partial). `id` and timestamps do not change.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "Updated project + counts." })
  @ApiResponse({ status: 400, description: "`ERR_SCHEMA_INVALID`." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async update(
    @Param("projectId") projectId: string,
    @Body() body: UpdateProjectDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ProjectResponse> {
    const updated = await this.service.update(projectId, body as any, auth);
    return ok(updated);
  }

  @Delete(":projectId")
  @HttpCode(204)
  @ApiOperation({
    summary: "Delete the project (cascade)",
    description:
      "Permanently deletes the project **and all its nodes + edges** (cascade). Cannot be undone.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 204, description: "Deleted (no body)." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async delete(@Param("projectId") projectId: string, @CurrentAuth() auth: AuthContext): Promise<void> {
    await this.service.delete(projectId, auth);
  }
}
