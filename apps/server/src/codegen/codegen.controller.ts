import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  HttpCode,
  NotFoundException,
  UseGuards,
  Sse,
  Query,
  Req,
  type MessageEvent,
} from "@nestjs/common";
import { from, type Observable } from "rxjs";
import { map } from "rxjs/operators";
import { ApiTags, ApiOperation, ApiParam, ApiResponse, type OpenAPIObject } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ProjectAccessGuard } from "../auth/project-access.guard";
import { env } from "../config/env";
import { CurrentAuth } from "../auth/current-auth.decorator";
import type { AuthContext } from "../auth/auth.types";
import { ProjectsRepository } from "../projects/projects.repository";
import { CodegenService } from "./codegen.service";
import type { SystemMapDTO, SimpleSketchModel } from "./simple-projection";
import { CodegenFillService, type FillEvent } from "./codegen-fill.service";
import { ImportResolverService } from "./import-resolver.service";
import { SurgicalFillRepository } from "./surgical-fill.repository";
import { CodegenRequestDto } from "./dto/codegen.dto";
import { CODEGEN_VERSION } from "./codegen.version";
import { ok } from "../common/envelope";
import type { SuccessEnvelope } from "../common/envelope";
import type { GeneratedProject } from "./types";

/** Extract code+message from HttpException body (SSE error event). */
function errBody(e: unknown): { code?: string; message: string } {
  const resp = (e as { getResponse?: () => unknown }).getResponse?.();
  if (resp && typeof resp === "object") {
    const r = resp as { code?: string; message?: string };
    return { code: r.code, message: r.message ?? "Error" };
  }
  return { message: (e as Error)?.message ?? "Error" };
}

/** Constructor version status + diagram drift — frontend builds "Codebase improved" /
 *  "diagram changed" badges from this. */
export interface CodegenStatus {
  /** Current Constructor version (CODEGEN_VERSION). */
  current: number;
  /** Version stamped on the project; null if never generated. */
  generated: number | null;
  /** generated != null && generated < current -> a better scaffold exists. */
  updateAvailable: boolean;
  /** Project's current structural graph revision (increments on node/edge changes). */
  graphRevision: number;
  /** Graph revision stamped at generation time; null if never generated. */
  generatedGraphRevision: number | null;
  /** DIAGRAM DRIFT: has the diagram structurally changed since generation
   *  (generatedGraphRevision != null && graphRevision > generatedGraphRevision).
   *  NOTE: this is NOT code↔diagram AST drift (that requires local code, in CLI) —
   *  signals "generated code lags the current diagram"; reminds user to regenerate. */
  diagramDrifted: boolean;
  /** Count of structural changes since generation ( > 0 when diagramDrifted). */
  driftCount: number;
}

@ApiTags("Codegen")
@UseGuards(ProjectAccessGuard)
@Controller("projects/:projectId/codegen")
export class CodegenController {
  constructor(
    private readonly service: CodegenService,
    private readonly projects: ProjectsRepository,
    private readonly fill: CodegenFillService,
    private readonly fills: SurgicalFillRepository,
    private readonly imports: ImportResolverService,
  ) {}

  /** Revert — delete stored (AI/human) body for ONE region. Next generate restores that
   *  region to NOT_IMPLEMENTED stub. Idempotent (200 if already absent). Frontend
   *  rail "Revert to stub" calls this then re-generates. */
  @Delete("fill/:nodeId/:member")
  @HttpCode(200)
  @ApiOperation({ summary: "Revert a filled surgical region back to its stub" })
  @ApiParam({ name: "nodeId", description: "Node UUID of the region" })
  @ApiParam({ name: "member", description: "Method/member name" })
  async revertFill(
    @Param("projectId") projectId: string,
    @Param("nodeId") nodeId: string,
    @Param("member") member: string,
  ): Promise<SuccessEnvelope<{ reverted: true }>> {
    await this.fills.deleteOne(projectId, nodeId, member);
    return ok({ reverted: true });
  }

  /** Simple View — READ-ONLY projection of the architecture graph for non-developers:
   *  feature map (boxes + "uses"/"triggers" arrows) + per-feature capability cards +
 *  logic diagram. Does NOT generate code, no AI (like viewing the canvas). Same graph → same output (sibling of Mermaid export). */
  @Get("simple-view")
  @ApiOperation({
    summary: "Non-developer 'Simple View' projection of the architecture graph",
    description:
      "Read-only, deterministic projection for non-technical stakeholders: a feature map " +
      "(boxes + 'uses'/'triggers' arrows) and per-feature capability cards with logic-flow " +
      "diagrams. No code generated, no AI — free. Same graph -> byte-identical output.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: SystemMap` — features[], arrows[], shared?." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async simpleView(@Param("projectId") projectId: string): Promise<SuccessEnvelope<SystemMapDTO>> {
    return ok(await this.service.simpleView(projectId));
  }

  /** Simple SKETCH — Mermaid for the hand-drawn (Excalidraw-style) Simple view. AI
   *  (DeepSeek) refines a deterministic baseline into a friendlier non-dev diagram and
   *  the result is cached per project (LLM runs only when the graph changes); falls back
   *  to the deterministic baseline when AI is unavailable. */
  @Get("simple-sketch")
  @ApiOperation({
    summary: "Mermaid for the hand-drawn Simple sketch (AI-refined, cached, deterministic fallback)",
    description: "Returns `{ mermaid, source }` for the non-developer sketch view.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: { mermaid: string; source: 'ai' | 'deterministic' }`." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async simpleSketch(@Param("projectId") projectId: string): Promise<SuccessEnvelope<{ mermaid: string; source: "ai" | "deterministic" }>> {
    return ok(await this.service.simpleSketch(projectId));
  }

  /** Structured Simple-View model — Mermaid-free `{ nodes, edges, groups }` the client lays
   *  out with ELK and renders with rough.js (the new tool-calling generation path). */
  @Get("simple-sketch-model")
  @ApiOperation({ summary: "Structured Simple-View model (Mermaid-free; ELK-laid-out client-side)" })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: { model: { nodes, edges, groups }, source, aiConfigured }`." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async simpleSketchModel(
    @Param("projectId") projectId: string,
    @Query("stage") stage?: "baseline" | "full",
  ): Promise<SuccessEnvelope<{ model: SimpleSketchModel; source: "ai" | "deterministic"; aiConfigured: boolean }>> {
    return ok(await this.service.simpleSketchModel(projectId, stage === "baseline" ? "baseline" : "full"));
  }

  /** Regenerate the Simple-View model — bypass the per-project cache and re-run the AI refine.
   *  Powers the "Regenerate" button: when a previous run fell back to deterministic (an AI hiccup)
   *  and the graph hasn't changed, this forces a fresh attempt instead of returning the cached one. */
  @Post("simple-sketch-model/regenerate")
  @HttpCode(200)
  @ApiOperation({ summary: "Regenerate the Simple-View model (bypass cache, re-run the AI refine)" })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: { model, source, aiConfigured }` — freshly regenerated." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async regenerateSimpleSketchModel(
    @Param("projectId") projectId: string,
  ): Promise<SuccessEnvelope<{ model: SimpleSketchModel; source: "ai" | "deterministic"; aiConfigured: boolean }>> {
    return ok(await this.service.simpleSketchModel(projectId, "full", true));
  }

  /** OpenAPI document — a deterministic, graph-true OpenAPI 3.1 spec the client renders with Scalar.
   *  `?stage=baseline` returns the instant deterministic doc (no AI); otherwise the persisted
   *  AI-enriched doc is served while the graph is unchanged, falling back to the deterministic baseline
   *  when the AI is off or fails. The AI only annotates EXISTING operations/schemas (prose + examples) —
   *  it never invents paths. */
  @Get("openapi.json")
  @ApiOperation({
    summary: "OpenAPI 3.1 document for the architecture graph (Scalar-rendered, AI-documentized, cached)",
    description: "Returns `{ doc, source, aiConfigured }`. `?stage=baseline` skips the AI for an instant deterministic doc.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: { doc: OpenAPIObject; source: 'ai' | 'deterministic'; aiConfigured: boolean }`." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async openApi(
    @Param("projectId") projectId: string,
    @Query("stage") stage?: "baseline" | "full",
  ): Promise<SuccessEnvelope<{ doc: OpenAPIObject; source: "ai" | "deterministic"; aiConfigured: boolean }>> {
    return ok(await this.service.apiDoc(projectId, stage === "baseline" ? "baseline" : "full"));
  }

  /** AI Documentize — bypass the per-project cache and re-run the AI enrichment over the OpenAPI doc.
   *  Powers the "AI Documentize" button: forces a fresh prose/example pass even when the graph hasn't
   *  changed (e.g. a previous run fell back to deterministic on an AI hiccup). The structure stays
   *  graph-true; only descriptions/examples on existing operations/schemas change. */
  @Post("openapi/documentize")
  @HttpCode(200)
  @ApiOperation({ summary: "AI Documentize the OpenAPI doc (bypass cache, re-run the grounded enrichment)" })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: { doc, source, aiConfigured }` — freshly documentized." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async documentizeOpenApi(
    @Param("projectId") projectId: string,
  ): Promise<SuccessEnvelope<{ doc: OpenAPIObject; source: "ai" | "deterministic"; aiConfigured: boolean }>> {
    return ok(await this.service.apiDoc(projectId, "full", true));
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: "Generate deterministic code from the architecture graph (Constructor)",
    description:
      "From the TechnicalGraph (node + edge), generates a deterministic NestJS + TypeScript " +
      "code scaffold **without AI**. The backend chain (Module/Controller/Service/Repository/DTO/Model/" +
      "Table/Enum/Exception) is fully generated; the other 12 types become stubs with surgical markers. " +
      "Method bodies are marked with `@solarch:surgical` markers (the algorithm area — " +
      "the SURGICAL AI that fills these is separate/future). " +
      "The same graph -> byte-identical output.\n\n",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: { target, files[], summary }`." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async generate(
    @Param("projectId") projectId: string,
    @Body() body: CodegenRequestDto,
    @CurrentAuth() _auth: AuthContext,
  ): Promise<SuccessEnvelope<GeneratedProject>> {
    const target = (body as { target?: "nestjs" }).target ?? "nestjs";
    const project = await this.service.generate(projectId, target);
    // BOUNDARY: AI=algorithm, system=imports. generate re-injects stored BODIES but does not
    // add imports (owned types/operators) → "Cannot find name". When filled regions exist,
    // resolve imports deterministically (best-effort; on error return project unchanged). When
    // no filled regions (fresh scaffold already has imports) skip → avoid temp-dir cost.
    if (project.files.some((f) => f.content.includes("@solarch:filled"))) {
      project.files = await this.imports.resolveImports(project.files);
    }
    // STAMPING: after successful generation write current Constructor version on project.
    await this.projects.setCodegenVersion(projectId, CODEGEN_VERSION);
    return ok(project);
  }

  @Sse("fill/stream")
  @Throttle({ default: { ttl: 60_000, limit: env.CODEGEN_FILL_THROTTLE_LIMIT } })
  @ApiOperation({
    summary: "Surgical AI — fill the @solarch:surgical bodies (SSE)",
    description:
      "Opens an EventSource. Generates the deterministic skeleton, then fills every `@solarch:surgical` " +
      "method body in parallel with the verification-driven fill agent (grounding + contract + declared-throws + " +
      "import-fix), then runs real `tsc` over the project and repairs failing regions in a loop. " +
      "Pass `?jest=true` to also generate+run behavioural specs (slower). Event types:\n" +
      "- `event: start` — { fileCount, markerCount }\n" +
      "- `event: mode` — { verified, withTests, reason? } verified=false ⇒ deps cache unavailable, draft only\n" +
      "- `event: region` — { status: filled|violation|error, member, file, attempts }\n" +
      "- `event: phase` — { kind: verify|repair|imports|tests, … } the live tsc/repair loop\n" +
      "- `event: report` — { filled, violations, errors, typecheck?, tests? }\n" +
      "- `event: files` — { files[] } the full filled project\n" +
      "- `event: error` — { code, message }",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  fillStream(
    @Param("projectId") projectId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: { on(event: "close", cb: () => void): void },
    @Query("target") targetQ?: string,
    @Query("jest") jestQ?: string,
  ): Observable<MessageEvent> {
    const target = targetQ === "nestjs" ? "nestjs" : "nestjs"; // single target for now
    // jest ("deep verify") optional: tsc always in loop; jest is slow+costly → toggle.
    const withTests = jestQ === "true" || jestQ === "1";
    const ac = new AbortController();
    req.on("close", () => ac.abort());
    const self = this;

    async function* guarded(): AsyncGenerator<FillEvent> {
      try {
        for await (const ev of self.fill.fill(projectId, target, ac.signal, { withTests })) {
          yield ev;
        }
        await self.projects.setCodegenVersion(projectId, CODEGEN_VERSION).catch(() => {});
      } catch (e) {
        yield { event: "error", ...errBody(e) };
      }
    }

    return from(guarded()).pipe(map((ev: FillEvent) => ({ type: ev.event, data: ev }) as MessageEvent));
  }

  @Get("status")
  @ApiOperation({
    summary: "Constructor version status",
    description:
      "Compares the current Constructor version with the version STAMPED on the project. " +
      "If `generated` is null the project has never generated code (nothing to update). " +
      "`updateAvailable` is true only if the stamped version is older than the current one — the frontend " +
      "uses this to show the 'Your codebase is now better' (Update) badge in the top bar.",
  })
  @ApiParam({ name: "projectId", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "`data: { current, generated, updateAvailable, graphRevision, generatedGraphRevision, diagramDrifted, driftCount }`." })
  @ApiResponse({ status: 404, description: "`ERR_PROJECT_NOT_FOUND`." })
  async status(
    @Param("projectId") projectId: string,
  ): Promise<SuccessEnvelope<CodegenStatus>> {
    const generated = await this.projects.getCodegenVersion(projectId);
    if (generated === undefined) {
      throw new NotFoundException({
        code: "ERR_PROJECT_NOT_FOUND",
        message: `Project '${projectId}' not found.`,
      });
    }
    const current = CODEGEN_VERSION;
    const updateAvailable = generated !== null && generated < current;
    // Diagram drift: difference between graphRevision at generation vs now (structural change count).
    const graphRevision = await this.projects.getGraphRevision(projectId);
    const generatedGraphRevision = await this.projects.getCodegenGraphRevision(projectId);
    const diagramDrifted = generatedGraphRevision !== null && graphRevision > generatedGraphRevision;
    const driftCount = diagramDrifted ? graphRevision - generatedGraphRevision! : 0;
    return ok({ current, generated, updateAvailable, graphRevision, generatedGraphRevision, diagramDrifted, driftCount });
  }
}
