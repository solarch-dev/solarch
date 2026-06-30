import type { GeneratedFile, NodeEmitter } from "../../types";
import type { CodeGraph, CodeNode } from "../../ir";
import { filePathFor, pascalCase } from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers, notImplemented, surgicalMarker } from "../../surgical";
import type { MiddlewareNode } from "../../../nodes/schemas";

/* ────────────────────────────────────────────────────────────────────────
 * middleware.emitter.ts — MiddlewareNode -> <feature>/<base>.middleware.ts
 *                                          (common/<base>.middleware.ts when no feature).
 *
 * Emits @Injectable() implements NestMiddleware NestJS middleware:
 *   - Class name = pascalCase(MiddlewareName) (e.g. "AuthMiddleware").
 *   - Single method: use(req: Request, res: Response, next: NextFunction): void.
 *     Body = surgicalMarker (Description + MiddlewareType + AppliesTo +
 *     ExecutionOrder + Config hints) + notImplemented(). Surgical AI fills
 *     the marked point.
 *   - Controllers it ROUTES_TO appear as "application hint" in marker description;
 *     actual `configure(consumer).apply(X).forRoutes(...)` wiring happens in Wire/
 *     module phase on that Controller's feature module (this emitter ONLY
 *     produces the middleware class).
 *
 * PURE + DETERMINISTIC: collections in given/sorted order, missing refs tolerated
 * (NO THROW), imports via ImportCollector, content ends with single "\n".
 *
 * NOTE: Middleware NOT in ir.ts PropsByKind (was one of 12 stub families) ->
 * propsOf<"Middleware"> CANNOT be used. Use local middlewareProps() helper for
 * typed access (DB already Zod-validated; type narrowing only, no runtime transform).
 * ──────────────────────────────────────────────────────────────────────── */

/** Typed Middleware properties access (local because outside PropsByKind). */
type MiddlewareProps = MiddlewareNode["properties"];
function middlewareProps(node: CodeNode): MiddlewareProps {
  return node.properties as MiddlewareProps;
}

export const emitMiddleware: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = middlewareProps(node);
  const className = pascalCase(node.name) || pascalCase(node.kindOf());
  const filePath = filePathFor(node, ctx.graph);
  const graph = ctx.graph;

  const imports = new ImportCollector();
  imports.add("Injectable", "@nestjs/common");
  imports.addType("NestMiddleware", "@nestjs/common");
  // Express types — compatible with NestJS default HTTP adapter (Express).
  imports.addType("NextFunction", "express");
  imports.addType("Request", "express");
  imports.addType("Response", "express");

  // ── Surgical body description ──────────────────────────────────────────────
  const desc = describeMiddleware(node, props, graph);
  const marker = surgicalMarker({
    nodeId: node.id,
    member: "use",
    description: desc,
  });

  const indent = "  ";
  const lines: string[] = [];
  if (props.Description) lines.push(`/** ${props.Description} */`);
  lines.push("@Injectable()");
  lines.push(`export class ${className} implements NestMiddleware {`);
  lines.push(`${indent}use(req: Request, res: Response, next: NextFunction): void {`);
  for (const ml of marker.split("\n")) lines.push(`${indent}${indent}${ml}`);
  lines.push(`${indent}${indent}${notImplemented(className, "use")}`);
  lines.push(`${indent}}`);
  lines.push("}");

  const importBlock = imports.render();
  const body = (importBlock ? `${importBlock}\n\n` : "") + lines.join("\n") + "\n";

  const file: GeneratedFile = {
    path: filePath,
    content: body,
    language: "typescript",
    surgicalMarkers: countSurgicalMarkers(body),
  };
  return [file];
};

/** Build DETERMINISTIC multi-line work description for surgical marker:
 *   - user Description (when present),
 *   - MiddlewareType + AppliesTo + ExecutionOrder context,
 *   - Controller names it ROUTES_TO (application hint),
 *   - Config keys (in given order; secret values NEVER written — Keys only). */
function describeMiddleware(
  node: CodeNode,
  props: MiddlewareProps,
  graph: CodeGraph,
): string {
  const parts: string[] = [];

  const typePart = props.MiddlewareType ? `${props.MiddlewareType} ` : "";
  parts.push(`${typePart}middleware: implement the use() body.`);

  if (props.AppliesTo === "Global") {
    parts.push("Scope: applied to all routes (Global).");
  } else {
    parts.push("Scope: applied only to specific routes (SpecificRoutes).");
  }
  parts.push(`Execution order (ExecutionOrder): ${props.ExecutionOrder}.`);

  // ROUTES_TO -> Controller (middleware routes to one or more controllers).
  //   CodeGraph keeps edges sorted by kind,source.name,target.name,id ->
  //   outEdges arrive in deterministic order.
  const routedControllers: string[] = [];
  for (const e of graph.outEdges(node.id, "ROUTES_TO")) {
    const tgt = graph.byId(e.targetNodeId);
    if (tgt && tgt.kindOf() === "Controller") routedControllers.push(tgt.name);
  }
  if (routedControllers.length > 0) {
    parts.push(
      `Wiring hint: for ${routedControllers.join(", ")} use ` +
        `configure(consumer).apply(${pascalCase(node.name)}).forRoutes(...) (the module phase wires this).`,
    );
  }

  // Config keys (Keys only; secret values NEVER embedded).
  const configKeys = (props.Config ?? []).map((c) => c.Key).filter((k) => k.length > 0);
  if (configKeys.length > 0) {
    parts.push(`Config keys: ${configKeys.join(", ")}.`);
  }

  return parts.join("\n");
}
