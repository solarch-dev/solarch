import { Controller, Get, Param } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from "@nestjs/swagger";
import { NodeTypesService } from "./node-types.service";
import { ok } from "../common/envelope";

@ApiTags("Node Types")
@Controller("node-types")
export class NodeTypesController {
  constructor(private readonly service: NodeTypesService) {}

  @Get()
  @ApiOperation({
    summary: "List all node types",
    description:
      "Returns a summary of the 21 node types: `id`, `family` (Data/Business/Access/...), `nameKey` (the field unique within the project) and a short description. Populate the frontend's 'Add New Node' menu from this endpoint.",
  })
  @ApiResponse({ status: 200, description: "`data: { types: [...], total: 21 }`." })
  listAll() {
    const types = this.service.listAll();
    return ok({ types, total: types.length });
  }

  @Get(":typeId")
  @ApiOperation({
    summary: "Single node type (+ JSON Schema)",
    description:
      "Metadata of the given node type + its **full JSON Schema** (generated with zodV3ToOpenAPI). The frontend renders its dynamic form from this schema.",
  })
  @ApiParam({ name: "typeId", description: "Node kind (e.g. `Table`, `Service`, `Controller`)", example: "Table" })
  @ApiResponse({ status: 200, description: "Metadata + `schema` (JSON Schema)." })
  @ApiResponse({ status: 404, description: "`ERR_NODE_TYPE_NOT_FOUND` — valid types are listed in the message." })
  getById(@Param("typeId") typeId: string) {
    return ok(this.service.getById(typeId));
  }

  @Get(":typeId/rule")
  @ApiOperation({
    summary: "Architecture rules for the node type",
    description:
      "This node type's place in the Rules Engine: in which connections it is **allowed as source/target** (`allowAsSource`/`allowAsTarget`) and in which it is **forbidden** (`denyAsSource`/`denyAsTarget`, with ERR codes).",
  })
  @ApiParam({ name: "typeId", description: "Node kind", example: "Service" })
  @ApiResponse({ status: 200, description: "allow/deny rule lists." })
  @ApiResponse({ status: 404, description: "`ERR_NODE_TYPE_NOT_FOUND`." })
  getRules(@Param("typeId") typeId: string) {
    return ok(this.service.getRulesById(typeId));
  }
}
