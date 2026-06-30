import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { ProjectAccessGuard } from "../auth/project-access.guard";
import { PatternsService } from "./patterns.service";
import { SearchPatternDto } from "./dto/search-pattern.dto";
import { ok } from "../common/envelope";
import { env } from "../config/env";

/* SECURITY (launch): Pattern library is currently READ ONLY + canonical 'seed'
* Limited to patterns. REMOVED create/delete/promote write bits —
* :Pattern node has no tenant (ownerId/orgId) stamp so these ends
* was a cross-tenant read/delete/prompt-poison vulnerability (BOLA). writing + tenant
* Ownership will be added post-launch. Seeding is done with `pnpm seed:patterns`
* (Calls PatternsService directly, not through this controller). Reading ways
* Scoped in the repository with source:'seed'. */
@ApiTags("Patterns (GraphRAG)")
@UseGuards(ProjectAccessGuard)
@Controller()
export class PatternsController {
  constructor(private readonly service: PatternsService) {}

  @Get("patterns")
  @ApiOperation({ summary: "Pattern list (seed only)", description: "Summary of canonical seed patterns (including node/edge counts)." })
  async list() {
    return ok(await this.service.list());
  }

  @Get("patterns/:id")
  @ApiOperation({ summary: "Single pattern (seed only)", description: "Full pattern including graphJson (sub-graph)." })
  @ApiParam({ name: "id", description: "Pattern UUID" })
  @ApiResponse({ status: 404, description: "ERR_PATTERN_NOT_FOUND" })
  async getById(@Param("id") id: string) {
    return ok(await this.service.getById(id));
  }

  @Post("patterns/search")
  @HttpCode(200)
  @ApiOperation({
    summary: "Semantic pattern search (seed only)",
    description: "Embeds the query and returns top-K cosine matches from the native vector index over seed patterns. Empty list if embedding is unavailable.",
  })
  @ApiResponse({ status: 200, description: "[{ pattern, score }] sorted by similarity." })
  async search(@Body() body: SearchPatternDto) {
    const { query, k, minScore } = body as any;
    return ok(await this.service.search(query, k ?? env.EMBED_TOP_K, minScore ?? env.EMBED_MIN_SCORE));
  }
}
