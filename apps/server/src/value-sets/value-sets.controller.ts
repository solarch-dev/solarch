import { Controller, Get, Param } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from "@nestjs/swagger";
import { ValueSetsService } from "./value-sets.service";
import { ok } from "../common/envelope";

@ApiTags("Value Sets")
@Controller("value-sets")
export class ValueSetsController {
  constructor(private readonly service: ValueSetsService) {}

  @Get()
  @ApiOperation({
    summary: "List of all value-sets",
    description:
      "Solarch's shared enum / lookup catalog. Common value sets used in each node type's properties " +
      "(parameter-types, http-methods, column-data-types, etc.). " +
      "Referenced via fieldHint.valueSet.",
  })
  @ApiResponse({ status: 200, description: "Array of value-set summaries" })
  list() {
    return ok(this.service.list());
  }

  @Get(":id")
  @ApiOperation({
    summary: "Single value-set (with all values)",
    description: "Used by the frontend Select widget.",
  })
  @ApiParam({ name: "id", description: "Value-set id (e.g. 'parameter-types', 'http-methods')" })
  @ApiResponse({ status: 200, description: "Value-set with all values" })
  @ApiResponse({ status: 404, description: "ERR_VALUE_SET_NOT_FOUND" })
  getById(@Param("id") id: string) {
    return ok(this.service.getById(id));
  }
}
