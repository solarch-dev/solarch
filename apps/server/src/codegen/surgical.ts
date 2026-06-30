/* ────────────────────────────────────────────────────────────────────────
 * surgical.ts — Surgical marker + NOT_IMPLEMENTED body.
 *
 * Method bodies are "algorithm fields" — Constructor does NOT write them, leaves a structured
 * marker. Surgical AI (separate, later stage) fills only these marked
 * regions. Marker format is FIXED and machine-parseable.
 *
 * Format (single-line comment + info lines):
 *
 *   // @solarch:surgical id=<nodeId>#<member>
 *   // <work description>                         (optional)
 *   // throws: ExceptionA, ExceptionB          (optional)
 *   // deps: dep1, dep2                         (optional)
 *
 * Body is always:
 *   throw new Error("NOT_IMPLEMENTED: <Class>.<member>");
 * ──────────────────────────────────────────────────────────────────────── */

export interface SurgicalMarkerInput {
  /** Persistent UUID of the node this marker belongs to. */
  nodeId: string;
  /** Method/member name (e.g. "createUser"). */
  member: string;
  /** Work description — what it should do (single/multi line; split per line). */
  description?: string;
  /** Throwable Exception node Names. */
  throws?: string[];
  /** Accessible dependencies (DI field names / repo / service Names). */
  deps?: string[];
}

const MARKER_PREFIX = "@solarch:surgical";

/** Emit structured surgical comment block (does NOT include trailing newline —
 *  caller adds own indent). Determinism: lists written in given ORDER
 *  (emitter guarantees sort), empty entries dropped. */
export function surgicalMarker(input: SurgicalMarkerInput): string {
  const lines: string[] = [`// ${MARKER_PREFIX} id=${input.nodeId}#${input.member}`];

  if (input.description) {
    for (const raw of input.description.split("\n")) {
      const t = raw.trim();
      if (t.length > 0) lines.push(`// ${t}`);
    }
  }
  if (input.throws && input.throws.length > 0) {
    lines.push(`// throws: ${input.throws.join(", ")}`);
  }
  if (input.deps && input.deps.length > 0) {
    lines.push(`// deps: ${input.deps.join(", ")}`);
  }
  return lines.join("\n");
}

/** Standard NOT_IMPLEMENTED body line.
 *  notImplemented("UsersService", "create") ->
 *    throw new Error("NOT_IMPLEMENTED: UsersService.create"); */
export function notImplemented(className: string, member: string): string {
  return `throw new Error("NOT_IMPLEMENTED: ${className}.${member}");`;
}

/** Count surgical markers in a content block (for GeneratedFile.surgicalMarkers).
 *  Single source: emitters use this, do not count manually. */
export function countSurgicalMarkers(content: string): number {
  const markers = content.match(new RegExp(MARKER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length ?? 0;
  // TO-FILL region count = markers − filled stamps. When codegen DETERMINISTICALLY
  // completes a region and stamps `@solarch:filled by=codegen` (e.g. BullMQ queue producer),
  // that does NOT count as "to fill". Otherwise displayed total (markers) exceeds what
  // fill processes (NOT_IMPLEMENTED skeletons) -> user sees "starting with 69 instead of 71".
  const filled = content.match(/@solarch:filled\b/g)?.length ?? 0;
  return Math.max(0, markers - filled);
}
