import { Controller, Get, Param } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from "@nestjs/swagger";
import { EdgeTypesService } from "./edge-types.service";
import { ok } from "../common/envelope";

@ApiTags("Edge Types")
@Controller("edge-types")
export class EdgeTypesController {
  constructor(private readonly service: EdgeTypesService) {}

  @Get()
  @ApiOperation({
    summary: "List all edge types",
    description:
      "Returns the 16 connection types: `id`, `family` (Communication/Data/Infrastructure/Architecture), description, example `source`/`target` and direction note. The connection-type picker in the UI is fed from this endpoint.",
  })
  @ApiResponse({ status: 200, description: "`data: { types: [...], total: 16 }`." })
  listAll() {
    const types = this.service.listAll();
    return ok({ types, total: types.length });
  }

  @Get(":edgeKind")
  @ApiOperation({
    summary: "Single edge type",
    description: "Detail of the given edge type: family, description, example source/target, direction note.",
  })
  @ApiParam({ name: "edgeKind", description: "Edge kind (e.g. `CALLS`, `WRITES`, `PUBLISHES`)", example: "CALLS" })
  @ApiResponse({ status: 200, description: "Edge type metadata." })
  @ApiResponse({ status: 404, description: "`ERR_EDGE_TYPE_NOT_FOUND`." })
  getById(@Param("edgeKind") edgeKind: string) {
    return ok(this.service.getById(edgeKind));
  }

  @Get(":edgeKind/rule")
  @ApiOperation({
    summary: "Architecture rules for the edge type",
    description:
      "Returns the **allowed** (`allow` — which source→target pairs) and **forbidden** (`deny` — with ERR codes) rules for this edge type.",
  })
  @ApiParam({ name: "edgeKind", description: "Edge kind", example: "CALLS" })
  @ApiResponse({ status: 200, description: "allow + deny rule lists." })
  @ApiResponse({ status: 404, description: "`ERR_EDGE_TYPE_NOT_FOUND`." })
  getRules(@Param("edgeKind") edgeKind: string) {
    return ok(this.service.getRulesById(edgeKind));
  }
}
