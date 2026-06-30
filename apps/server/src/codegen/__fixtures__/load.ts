import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCodeGraph } from "../ir";
import { CodegenService } from "../codegen.service";
import type { GeneratedFile, GeneratedProject } from "../types";
import type { StoredNode } from "../../nodes/nodes.repository";
import type { StoredEdge } from "../../edges/edges.repository";

/* ────────────────────────────────────────────────────────────────────────
 * __fixtures__/load.ts — shared fixture loader for VERIFICATION GATES.
 *
 * realistic-graph.json: realistic graph (61 nodes / 82 edges — restaurant
 * app), taken from canvas output format and normalized to StoredNode/StoredEdge.
 * Both fast seam test (codegen-assembly.spec) and whole-project tsc gate
 * (codegen-tsc.gate) use this as SINGLE SOURCE.
 * ──────────────────────────────────────────────────────────────────────── */

export function loadRealisticGraph(): { nodes: StoredNode[]; edges: StoredEdge[] } {
  return JSON.parse(readFileSync(join(__dirname, "realistic-graph.json"), "utf8"));
}

/** Assemble realistic graph without DB and return FULL project (files + warnings + summary). */
export function assembleRealisticProject(): GeneratedProject {
  const { nodes, edges } = loadRealisticGraph();
  const graph = buildCodeGraph(nodes, edges);
  return CodegenService.prototype.assemble.call({} as CodegenService, graph, "nestjs");
}

/** Assemble realistic graph without DB and return generated files. */
export function assembleRealisticFixture(): GeneratedFile[] {
  return assembleRealisticProject().files;
}
