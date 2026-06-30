import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCodeGraph } from "../ir";
import { CodegenService } from "../codegen.service";
import type { GeneratedFile, GeneratedProject } from "../types";
import type { StoredNode } from "../../nodes/nodes.repository";
import type { StoredEdge } from "../../edges/edges.repository";

/* ────────────────────────────────────────────────────────────────────────
 * __fixtures__/load.ts — DOĞRULAMA GEÇİTLERİNİN ortak fixture yükleyicisi.
 *
 * realistic-graph.json: gerçekçi bir graf (61 node / 82 edge — restaurant
 * uygulaması), kanvasın ürettiği biçimden alınıp StoredNode/StoredEdge'e normalize
 * edilmiş. Hem hızlı seam testi (codegen-assembly.spec) hem bütün-proje tsc geçidi
 * (codegen-tsc.gate) bunu TEK KAYNAK olarak kullanır.
 * ──────────────────────────────────────────────────────────────────────── */

export function loadRealisticGraph(): { nodes: StoredNode[]; edges: StoredEdge[] } {
  return JSON.parse(readFileSync(join(__dirname, "realistic-graph.json"), "utf8"));
}

/** Gerçekçi grafı DB'siz assemble eder ve TÜM projeyi (files + warnings + summary) döndürür. */
export function assembleRealisticProject(): GeneratedProject {
  const { nodes, edges } = loadRealisticGraph();
  const graph = buildCodeGraph(nodes, edges);
  return CodegenService.prototype.assemble.call({} as CodegenService, graph, "nestjs");
}

/** Gerçekçi grafı DB'siz assemble eder ve üretilen dosyaları döndürür. */
export function assembleRealisticFixture(): GeneratedFile[] {
  return assembleRealisticProject().files;
}
