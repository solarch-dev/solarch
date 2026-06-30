import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { RulesEngine } from "./rules.engine";
import { ok } from "../common/envelope";
import { RULE_LAYER_LABELS } from "./types";

@ApiTags("Rules")
@Controller("rules")
export class RulesController {
  constructor(private readonly engine: RulesEngine) {}

  @Get()
  @ApiOperation({
    summary: "Architecture rule catalog",
    description:
      "Returns all rules of the Rules Engine:\n\n" +
      "- **whitelist** (~32 rules): allowed source→edge→target combinations, split into 6 layers\n" +
      "- **blacklist** (7 rules): hard prohibitions `ERR_001..ERR_007` (message + suggestion)\n" +
      "- **conditional** (3 rules): circular dependency, type mismatch, empty schema\n" +
      "- **defaults**: unspecified connections are `deny` (forbidden by default)\n\n" +
      "Consult this catalog to learn which connection can be created between two nodes.",
  })
  @ApiResponse({ status: 200, description: "whitelist + blacklist + conditional + layers + counts." })
  catalog() {
    const c = this.engine.catalog();
    return ok({
      ...c,
      layers: RULE_LAYER_LABELS,
      counts: {
        whitelist: c.whitelist.length,
        blacklist: c.blacklist.length,
        conditional: c.conditional.length,
      },
    });
  }
}
