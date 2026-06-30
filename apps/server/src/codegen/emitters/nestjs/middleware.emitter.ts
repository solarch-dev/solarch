import type { GeneratedFile, NodeEmitter } from "../../types";
import type { CodeGraph, CodeNode } from "../../ir";
import { filePathFor, pascalCase } from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers, notImplemented, surgicalMarker } from "../../surgical";
import type { MiddlewareNode } from "../../../nodes/schemas";

/* ────────────────────────────────────────────────────────────────────────
 * middleware.emitter.ts — MiddlewareNode -> <feature>/<base>.middleware.ts
 *                                          (feature yoksa common/<base>.middleware.ts).
 *
 * @Injectable() implements NestMiddleware bir NestJS middleware'i üretir:
 *   - Sınıf adı = pascalCase(MiddlewareName) (ör. "AuthMiddleware").
 *   - Tek metot: use(req: Request, res: Response, next: NextFunction): void.
 *     Gövde = surgicalMarker (Description + MiddlewareType + AppliesTo +
 *     ExecutionOrder + Config ipuçları) + notImplemented(). Surgical AI bu
 *     işaretli noktayı doldurur.
 *   - ROUTES_TO ettiği Controller'lar marker açıklamasında "uygulanış ipucu"
 *     olarak verilir; gerçek `configure(consumer).apply(X).forRoutes(...)`
 *     bağlaması Wire/module fazında o Controller'ın feature module'üne eklenir
 *     (bu emitter SADECE middleware sınıfını üretir).
 *
 * SAF + DETERMİNİSTİK: koleksiyonlar verildiği/sıralı düzende, kayıp ref tolere
 * edilir (THROW yok), import'lar ImportCollector ile, içerik tek "\n" ile biter.
 *
 * NOT: Middleware, ir.ts PropsByKind içinde DEĞİL (12 stub-ailesinden biriydi) ->
 * propsOf<"Middleware"> KULLANILAMAZ. Tipli erişim için yerel middlewareProps()
 * helper'ı (DB zaten Zod-doğrulanmış; yalnız tip daraltma, çalışma-zamanı dönüşümü
 * yok) kullanılır.
 * ──────────────────────────────────────────────────────────────────────── */

/** Tipli Middleware properties erişimi (PropsByKind dışı olduğundan yerel). */
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
  // Express tipleri — NestJS varsayılan HTTP adaptörü (Express) ile uyumlu.
  imports.addType("NextFunction", "express");
  imports.addType("Request", "express");
  imports.addType("Response", "express");

  // ── Surgical gövde açıklaması ──────────────────────────────────────────────
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

/** Surgical marker'ın çok-satırlı iş açıklamasını DETERMİNİSTİK kurar:
 *   - kullanıcı Description'ı (varsa),
 *   - MiddlewareType + AppliesTo + ExecutionOrder bağlamı,
 *   - ROUTES_TO ettiği Controller adları (uygulanış ipucu),
 *   - Config anahtarları (verildiği sırada; gizli değer YAZILMAZ — yalnız Key'ler). */
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

  // ROUTES_TO -> Controller (middleware bir/birkaç controller'a yönlenir).
  //   CodeGraph edge'leri kind,source.name,target.name,id'ye sıralı tutar ->
  //   outEdges deterministik sıralı gelir.
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

  // Config anahtarları (yalnız Key'ler; secret değerler ASLA gömülmez).
  const configKeys = (props.Config ?? []).map((c) => c.Key).filter((k) => k.length > 0);
  if (configKeys.length > 0) {
    parts.push(`Config keys: ${configKeys.join(", ")}.`);
  }

  return parts.join("\n");
}
