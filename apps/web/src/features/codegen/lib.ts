/** Codegen panel helpers — file tree construction, language mapping, surgical detection,
 *  clipboard copy and .zip download. Pure functions; kept separate from UI for easy testing/reading. */

import type { GeneratedFile } from "../../api/codegen";

/** Surgical AI marker signature in source content. Lines containing this text are highlighted. */
export const SURGICAL_MARKER = "@solarch:surgical";

/** GeneratedFile.language -> prism-react-renderer language key.
 *  Bundled prism languages: typescript, json, markdown, sql, yaml... "bash" NOT included →
 *  for env files we return an empty language (unhighlighted plain text), prism renders fine. */
export function prismLanguageFor(language: GeneratedFile["language"]): string {
  switch (language) {
    case "typescript":
      return "typescript";
    case "sql":
      return "sql";
    case "json":
      return "json";
    case "markdown":
      return "markdown";
    case "env":
    default:
      return ""; // unhighlighted: .env lines as plain text
  }
}

/** Is a file line a surgical (edit point) marker? */
export function isSurgicalLine(line: string): boolean {
  return line.includes(SURGICAL_MARKER);
}

/** Surgical region status — derived from content (done) + from fill.regions (failed). */
export type RegionStatus = "done" | "failed" | "pending";

/** WHO wrote a filled region — from the `@solarch:filled by=...` stamp. Source of the
 *  provenance spine: the distinction that makes "verified, not guessed" visible. */
export type Provenance = "constructor" | "ai" | "human";

/** Single color/label source for the provenance spine + rail chips: status + provenance collapse to one axis.
 *  pending/failed from status; done from WHO wrote it (constructor/ai/human). */
export type RegionKind = "pending" | "failed" | "constructor" | "ai" | "human";

export interface SurgicalRegion {
  /** 0-based index of the marker line. */
  line: number;
  member: string;
  /** Cloud node UUID from the marker — for jumping (focusNodeId) from the rail to the editor. */
  nodeId: string;
  status: RegionStatus;
  /** Provenance of the filled region (meaningful when done). codegen→constructor, ai, human/unstamped→human. */
  by?: Provenance;
}

export interface FileFillStatus {
  /** Total surgical regions in the file. */
  total: number;
  done: number;
  failed: number;
  pending: number;
}

const SURGICAL_ID_RE = /@solarch:surgical\s+id=([^\s#]+)#(\S+)/;
const FILLED_BY_RE = /@solarch:filled(?:\s+by=(\w+))?/;

/** Reduce the `by=` token to a provenance: codegen→constructor (deterministic), ai→ai, rest→human. */
function provenanceOf(by: string | undefined): Provenance {
  return by === "codegen" ? "constructor" : by === "ai" ? "ai" : "human";
}

/** Reduce a region to one color axis (RegionKind): failed/pending from status, done from provenance. */
export function regionKind(r: SurgicalRegion): RegionKind {
  if (r.status === "failed") return "failed";
  if (r.status === "pending") return "pending";
  return r.by ?? "human";
}

/** Returns a file's surgical regions with STATUS + PROVENANCE. Status is derived FROM CONTENT:
 *  if the region block (up to the next surgical marker) has `@solarch:filled` then DONE (+ `by=`
 *  provenance); otherwise PENDING (NOT_IMPLEMENTED stub). `failedMembers` (violation/error
 *  members from fill.regions) override to FAILED. line = 0-based index of the marker line. */
export function surgicalRegions(content: string, failedMembers?: ReadonlySet<string>): SurgicalRegion[] {
  const lines = content.split("\n");
  const out: SurgicalRegion[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = SURGICAL_ID_RE.exec(lines[i]!);
    if (!m) continue;
    const nodeId = m[1]!;
    const member = m[2]!;
    let done = false;
    let by: Provenance | undefined;
    for (let j = i + 1; j < lines.length && j < i + 12; j++) {
      if (lines[j]!.includes(SURGICAL_MARKER)) break; // entered the next region
      const fm = FILLED_BY_RE.exec(lines[j]!);
      if (fm) {
        done = true;
        by = provenanceOf(fm[1]);
        break;
      }
    }
    const status: RegionStatus = failedMembers?.has(member) ? "failed" : done ? "done" : "pending";
    out.push({ line: i, member, nodeId, status, by: done ? by : undefined });
  }
  return out;
}

export interface RegionSpan extends SurgicalRegion {
  /** Single color axis (status + provenance). */
  kind: RegionKind;
  /** Provenance spine span: START of the method body (signature `{` line) and END (closing `}`).
   *  The spine paints this span → the region's provenance reads as a block, not line by line. */
  startLine: number;
  endLine: number;
}

/** Returns regions with STATUS+PROVENANCE+SPAN — source of the provenance spine and the rail (jump-to).
 *  Span: from the method-opening line above the marker, to the closing `}` line found via
 *  brace counting. Generated code is clean, so brace counting suffices for visuals (not logic). */
export function regionSpans(content: string, failedMembers?: ReadonlySet<string>): RegionSpan[] {
  const lines = content.split("\n");
  return surgicalRegions(content, failedMembers).map((r) => {
    // startLine: the method-opening line just above the marker (trimEnd ends with `{`).
    let startLine = r.line;
    for (let k = r.line; k >= 0 && k > r.line - 5; k--) {
      if (lines[k]!.trimEnd().endsWith("{")) {
        startLine = k;
        break;
      }
    }
    // endLine: from the opening, when brace depth returns to 0.
    let depth = 0;
    let endLine = r.line;
    for (let k = startLine; k < lines.length; k++) {
      for (const ch of lines[k]!) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
      endLine = k;
      if (k > startLine && depth <= 0) break;
    }
    return { ...r, kind: regionKind(r), startLine, endLine };
  });
}

/** Per-file surgical fill summary (source of the FileTree badge). */
export function fileFillStatus(content: string, failedMembers?: ReadonlySet<string>): FileFillStatus {
  const s: FileFillStatus = { total: 0, done: 0, failed: 0, pending: 0 };
  for (const r of surgicalRegions(content, failedMembers)) {
    s.total++;
    s[r.status]++;
  }
  return s;
}

/** "Show Code": finds the relevant node's surgical line in the content (0-based line number).
 *  The backend writes an `id=<nodeId>` tag on each surgical marker. First looks for a line
 *  matching both surgical + id; falls back to the first line containing id=<nodeId>. Returns null if not found. */
export function surgicalLineForNode(content: string, nodeId: string): number | null {
  if (!nodeId) return null;
  const needle = `id=${nodeId}`;
  const lines = content.split("\n");
  // First preference: line carrying both surgical marker and id.
  for (let i = 0; i < lines.length; i++) {
    if (isSurgicalLine(lines[i]) && lines[i].includes(needle)) return i;
  }
  // Second preference: any line containing id=<nodeId>.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) return i;
  }
  return null;
}

/** "src/users/users.service.ts" -> "users.service.ts" (tab/title name). */
export function baseName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

/** "src/users/users.service.ts" -> ["src","users","users.service.ts"] (breadcrumb). */
export function pathSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/** File tree node. Carries either children (folder) or a file (leaf). */
export interface TreeNode {
  /** Display name (path segment). */
  name: string;
  /** Full path relative to root (unique key for folders too). */
  path: string;
  /** Child nodes if folder; empty if file. */
  children: TreeNode[];
  /** The associated GeneratedFile if leaf; undefined if folder. */
  file?: GeneratedFile;
}

/** Converts a files[].path list ("/" separated) into a folder hierarchy.
 *  Folders first, then files; each level sorted alphabetically. */
export function buildFileTree(files: GeneratedFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let cursor = root;
    let acc = "";

    parts.forEach((part, idx) => {
      acc = acc ? `${acc}/${part}` : part;
      const isLeaf = idx === parts.length - 1;

      let next = cursor.children.find((c) => c.name === part && (isLeaf ? !!c.file : !c.file));
      if (!next) {
        next = { name: part, path: acc, children: [] };
        cursor.children.push(next);
      }
      if (isLeaf) next.file = file;
      cursor = next;
    });
  }

  sortTree(root.children);
  return root.children;
}

/** At each level: folders first, then files; alphabetical by name. Sorts in place. */
function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    const aDir = !a.file;
    const bDir = !b.file;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const n of nodes) if (n.children.length) sortTree(n.children);
}

/** Returns all folder paths in the given tree (for default-open state). */
export function allFolderPaths(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (!n.file) {
        out.push(n.path);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}

/** Copies text to clipboard. Falls back to textarea if navigator.clipboard is unavailable. */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}

/** Packs all files with their paths into a .zip and triggers a browser download.
 *  Uses jszip to produce a Blob; no file-saver — URL.createObjectURL + temporary <a>.click(). */
export async function downloadZip(
  files: GeneratedFile[],
  fileName = "solarch-codegen.zip",
): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const f of files) zip.file(f.path, f.content);

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Short delay before revoking the URL so the browser can start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
