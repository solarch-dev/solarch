import type { NodeKind } from "../nodes/schemas";
import type { CodeGraph, CodeNode } from "./ir";

/* ────────────────────────────────────────────────────────────────────────
 * Constructor Codegen — shared types / contract.
 *
 * TechnicalGraph (nodes + edges) -> DETERMINISTIC NestJS+TypeScript scaffold.
 * No AI. All emitters are PURE functions: same graph -> byte-identical output.
 *
 * This file is "single source" — emitter agents rely only on signatures here and
 * in ir.ts / naming.ts / imports.ts / surgical.ts.
 * ──────────────────────────────────────────────────────────────────────── */

/** Target stack. v1 only emits "nestjs"; type may expand later. */
export type CodegenTarget = "nestjs";

/** Language of a generated file — formatting/lint/snapshot hint. */
export type GeneratedLanguage = "typescript" | "sql" | "json" | "markdown" | "env";

/** A single generated file. `path` is project-root-relative POSIX path (always
 *  "/" separator, no leading "/"), e.g. "users/users.service.ts". */
export interface GeneratedFile {
  /** Project-root-relative POSIX path (no leading "/"). */
  path: string;
  /** Full file content. Ends with single "\n" (POSIX). */
  content: string;
  /** Syntax/format hint. */
  language: GeneratedLanguage;
  /** Count of surgical markers (@solarch:surgical) in this file. */
  surgicalMarkers: number;
  /** Persistent UUID of the node that PRODUCED this file (when from a node-emitter).
   *  undefined for scaffold (project-wide), synthesized feature module, synthetic entity, etc.
   *  nodeFiles map is built from this. */
  nodeId?: string;
}

/** Skipped/stubbed node types and counts (for summary). */
export type SkippedKinds = Record<string, number>;

/** Full codegen output — assembled project. */
export interface GeneratedProject {
  target: CodegenTarget;
  files: GeneratedFile[];
  /** node.id -> file paths that node PRODUCED (final paths after assembly,
   *  e.g. "src/users/users.service.ts" / "migrations/001_create_users.sql").
   *  Only node-emitter outputs; excludes scaffold/feature-module/synthetic
   *  entity and other non-node-bound files. One node may produce multiple files
   *  (list). Keys + paths deterministically sorted. */
  nodeFiles: Record<string, string[]>;
  /** Deterministic codegen warnings — generation SUCCEEDED but a structural decision
   *  is reported to the user (e.g. mutual feature module import detected and
   *  cycle broken: one direction dropped in A<->B, no forwardRef emitted). Content
   *  deterministic + sorted by input; empty array when no warnings. (M4) */
  warnings: string[];
  summary: {
    /** Constructor version that produced this output (CODEGEN_VERSION). Tags which
     *  generation scaffold the generated code came from. */
    version: number;
    fileCount: number;
    nodeCount: number;
    surgicalMarkerCount: number;
    /** Count breakdown of kinds with emitters but stub output (remaining out-of-scope)
     *  + kinds not in REGISTRY at all. */
    skippedKinds: SkippedKinds;
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * EmitterContext — everything an emitter needs when converting a node to code.
 * Emitters do no I/O, no store access; work only via this ctx + node
 * (purity + determinism guarantee). Built by ir.ts.
 * ──────────────────────────────────────────────────────────────────────── */
export interface EmitterContext {
  /** Resolved graph with relationship resolution + indexes. */
  readonly graph: CodeGraph;
  /** Target stack (always "nestjs" for now). */
  readonly target: CodegenTarget;
}

/* ────────────────────────────────────────────────────────────────────────
 * Emitter contract.
 *
 * Three forms; all PURE functions, all return GeneratedFile[]:
 *
 *  1) NodeEmitter   — converts a node to file(s). (node, ctx) -> GeneratedFile[].
 *                     Most emitters return one file; some (Module barrel,
 *                     Model+entity etc.) may return several. NEVER throws;
 *                     tolerates missing refs (if ctx.graph.resolveRef returns null,
 *                     skip that line / leave TODO comment).
 *
 *  2) StubEmitter   — for 12 unsupported types. Same signature but semantically
 *                     emits "surgical-marker empty skeleton + edge summary".
 *                     Same type as NodeEmitter; separate name documents intent only.
 *                     REGISTRY stub emitter also slots into NodeEmitter slot.
 *
 *  3) ScaffoldEmitter — project-level files NOT bound to a node
 *                       (package.json, tsconfig, main.ts, app.module.ts ...).
 *                       (ctx) -> GeneratedFile[]. Single input: ctx.
 *
 * Emitter agents write (1) and (2); (3) provided by scaffold core.
 * ──────────────────────────────────────────────────────────────────────── */

/** Pure function converting a node (or stub) to file(s). */
export type NodeEmitter = (node: CodeNode, ctx: EmitterContext) => GeneratedFile[];

/** Pure function emitting stub for unsupported type (type-same as NodeEmitter). */
export type StubEmitter = NodeEmitter;

/** Pure function emitting project-level files independent of nodes. */
export type ScaffoldEmitter = (ctx: EmitterContext) => GeneratedFile[];

/** Registered emitter entry for a nodeKind.
 *  `supported=true`  -> full backend-chain emitter (Module/Controller/...).
 *  `supported=false` -> stub emitter (counted in skippedKinds). */
export interface EmitterEntry {
  kind: NodeKind;
  emit: NodeEmitter;
  /** when false, written to summary.skippedKinds (not silently dropped). */
  supported: boolean;
}

/** nodeKind -> emitter mapping. emitters/nestjs/index.ts fills this. */
export type EmitterRegistry = Partial<Record<NodeKind, EmitterEntry>>;
