import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from "@nestjs/swagger";
import { ProjectAccessGuard } from "../auth/project-access.guard";
import { TabsService } from "./tabs.service";
import { CreateTabDto } from "./dto/create-tab.dto";
import { UpdateTabDto } from "./dto/update-tab.dto";
import { ReferenceDto } from "./dto/reference.dto";
import { LayoutDto } from "./dto/layout.dto";
import { ok } from "../common/envelope";

@ApiTags("Tabs (Contexts)")
@UseGuards(ProjectAccessGuard)
@Controller("projects/:projectId/tabs")
export class TabsController {
  constructor(private readonly service: TabsService) {}

  @Post()
  @ApiOperation({ summary: "Create tab", description: "New context/canvas tab. moduleNodeId is optional (drill-down source)." })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  async create(@Param("projectId") projectId: string, @Body() body: CreateTabDto) {
    return ok(await this.service.create(projectId, body as any));
  }

  @Get()
  @ApiOperation({ summary: "List tabs", description: "Sorted by order." })
  async list(@Param("projectId") projectId: string) {
    return ok(await this.service.list(projectId));
  }

  @Get(":tabId")
  @ApiOperation({ summary: "Tab detail" })
  @ApiResponse({ status: 404, description: "ERR_TAB_NOT_FOUND" })
  async getById(@Param("projectId") projectId: string, @Param("tabId") tabId: string) {
    return ok(await this.service.getById(projectId, tabId));
  }

  @Get(":tabId/graph")
  @ApiOperation({ summary: "Tab render content", description: "owned + referenced nodes (position + origin) + edges between them." })
  async graph(@Param("projectId") projectId: string, @Param("tabId") tabId: string) {
    return ok(await this.service.tabGraph(projectId, tabId));
  }

  @Patch(":tabId")
  @ApiOperation({ summary: "Update tab (name/order)" })
  async update(@Param("projectId") projectId: string, @Param("tabId") tabId: string, @Body() body: UpdateTabDto) {
    return ok(await this.service.update(projectId, tabId, body as any));
  }

  @Delete(":tabId")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete tab", description: "The default cannot be deleted. Owned nodes are moved to Main Architecture, references are removed." })
  @ApiResponse({ status: 400, description: "ERR_TAB_DEFAULT_DELETE" })
  async delete(@Param("projectId") projectId: string, @Param("tabId") tabId: string) {
    await this.service.delete(projectId, tabId);
  }

  @Put(":tabId/references/:nodeId")
  @ApiOperation({ summary: "Import node into tab / update reference position" })
  @ApiResponse({ status: 400, description: "ERR_TAB_SELF_REFERENCE" })
  async addReference(
    @Param("projectId") projectId: string,
    @Param("tabId") tabId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: ReferenceDto,
  ) {
    const { x, y } = body as any;
    await this.service.addReference(projectId, tabId, nodeId, x, y);
    return ok({ tabId, nodeId, x, y });
  }

  @Delete(":tabId/references/:nodeId")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove reference (node is not deleted)" })
  async removeReference(@Param("projectId") projectId: string, @Param("tabId") tabId: string, @Param("nodeId") nodeId: string) {
    await this.service.removeReference(projectId, tabId, nodeId);
  }

  @Patch(":tabId/layout")
  @ApiOperation({ summary: "Save batch positions", description: "After drag: owned → node position, referenced → reference position." })
  async layout(@Param("projectId") projectId: string, @Param("tabId") tabId: string, @Body() body: LayoutDto) {
    const { items } = body as any;
    await this.service.saveLayout(projectId, tabId, items);
    return ok({ tabId, updated: items.length });
  }
}
