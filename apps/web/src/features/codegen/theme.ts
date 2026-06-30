/** Codegen editor theme — CSS-variable-backed surface tokens + language mapping.
 *
 *  THEME-AWARE: every value is a `var(--ed-*)` string defined in src/index.css under
 *  both `:root` (LIGHT = Solarch canvas/paper colors) and `.dark` (neutral near-black,
 *  minimal — no VSCode blue, sparse orange accent). The single `<html>.dark` switch
 *  flips the whole editor. Components keep reading EDITOR.* / PROVENANCE.* — no per-
 *  component theme branching.
 *
 *  Colors are single-sourced here; components never invent their own. */

import type { GeneratedFile } from "../../api/codegen";
import type { PrismTheme } from "prism-react-renderer";
import type { RegionKind } from "./lib";

/** Editor surface tokens (resolve from CSS variables — light/dark aware). */
export const EDITOR = {
  /** Editor text area background. */
  bg: "var(--ed-bg)",
  /** Left explorer / sidebar background. */
  sidebar: "var(--ed-sidebar)",
  /** Tab bar + breadcrumb background. */
  tabBar: "var(--ed-tabBar)",
  /** Active tab background (same as editor → seamless). */
  tabActive: "var(--ed-tabActive)",
  /** Top toolbar (title bar) background. */
  titleBar: "var(--ed-titleBar)",
  /** Bottom status bar background — flat (text-only, no colored bar). */
  statusBar: "var(--ed-statusBar)",
  /** Accent — focus border, active item line, primary CTA (orange). */
  accent: "var(--ed-accent)",
  /** Accent hover (darker/brighter). */
  accentHover: "var(--ed-accent-hover)",
  /** Subtle separator line. */
  border: "var(--ed-border)",
  /** Slightly more visible separator. */
  borderStrong: "var(--ed-borderStrong)",
  /** Primary text. */
  text: "var(--ed-text)",
  /** Secondary / muted text. */
  textMuted: "var(--ed-textMuted)",
  /** Very faint (line number) text. */
  textFaint: "var(--ed-textFaint)",
  /** Active line background (gutter + line). */
  activeLine: "var(--ed-activeLine)",
  /** Hover background (explorer rows, tabs). */
  hover: "var(--ed-hover)",
  /** Selected explorer row background. */
  selected: "var(--ed-selected)",
  /** Indent guide line. */
  indentGuide: "var(--ed-indentGuide)",
  /** Surgical highlight — warm amber (PENDING/unfilled stub). */
  surgical: "var(--ed-surgical)",
  /** Surgical line background (pending). */
  surgicalLine: "var(--ed-surgicalLine)",
  /** Filled (DONE) surgical region — calm teal-green. */
  surgicalDone: "var(--ed-surgicalDone)",
  surgicalDoneLine: "var(--ed-surgicalDoneLine)",
  /** FAILED (violation/error) surgical region — danger. */
  surgicalFailed: "var(--ed-surgicalFailed)",
  surgicalFailedLine: "var(--ed-surgicalFailedLine)",
  /** Subtle neutral button/badge fill (flips with theme). */
  subtle: "var(--ed-subtle)",
  subtleStrong: "var(--ed-subtle-strong)",
  /** Accent-tinted wash (selected toggle, icon chip). */
  accentWash: "var(--ed-accent-wash)",
  /** Verified/ok teal (badges). */
  ok: "var(--ed-ok)",
  okWash: "var(--ed-ok-wash)",
  /** Draft/pending amber (badges). */
  pending: "var(--ed-pending)",
  pendingWash: "var(--ed-pending-wash)",
  /** Error/danger (banners, close hover). */
  danger: "var(--ed-danger)",
  dangerWash: "var(--ed-danger-wash)",
  /** Surgical-AI action (fill button, streaming banner) — violet. */
  aiAction: "var(--ed-ai-action)",
  aiActionDim: "var(--ed-ai-action-dim)",
  aiActionWash: "var(--ed-ai-action-wash)",
} as const;

/** prism-react-renderer theme whose token colors are CSS variables (--ed-syn-*),
 *  so syntax highlighting follows light/dark WITHOUT a remount. */
export const solarchPrismTheme: PrismTheme = {
  plain: { color: "var(--ed-syn-plain)", backgroundColor: "transparent" },
  styles: [
    { types: ["comment", "prolog", "doctype", "cdata"], style: { color: "var(--ed-syn-comment)", fontStyle: "italic" } },
    { types: ["punctuation"], style: { color: "var(--ed-syn-punct)" } },
    { types: ["number", "boolean", "constant", "symbol"], style: { color: "var(--ed-syn-number)" } },
    { types: ["property", "tag", "attr-name"], style: { color: "var(--ed-syn-property)" } },
    { types: ["string", "char", "attr-value", "inserted", "url"], style: { color: "var(--ed-syn-string)" } },
    { types: ["operator", "entity", "variable", "deleted"], style: { color: "var(--ed-syn-plain)" } },
    { types: ["atrule", "keyword", "important", "regex"], style: { color: "var(--ed-syn-keyword)" } },
    { types: ["function"], style: { color: "var(--ed-syn-function)" } },
    { types: ["class-name", "maybe-class-name", "builtin"], style: { color: "var(--ed-syn-class)" } },
  ],
};

/** FileIcon language badge tokens — light/dark via --ed-lang-* CSS variables. */
export const LANG_BADGE: Record<string, { fg: string; bg: string }> = {
  tsx: { fg: "var(--ed-lang-tsx)", bg: "var(--ed-lang-tsx-bg)" },
  ts: { fg: "var(--ed-lang-ts)", bg: "var(--ed-lang-ts-bg)" },
  sql: { fg: "var(--ed-lang-sql)", bg: "var(--ed-lang-sql-bg)" },
  json: { fg: "var(--ed-lang-json)", bg: "var(--ed-lang-json-bg)" },
  md: { fg: "var(--ed-lang-md)", bg: "var(--ed-lang-md-bg)" },
  env: { fg: "var(--ed-lang-env)", bg: "var(--ed-lang-env-bg)" },
  default: { fg: "var(--ed-lang-default)", bg: "var(--ed-lang-default-bg)" },
};

/** Provenance palette — single source for the provenance-spine + rail chips + hover card.
 *  Makes each line's origin visible ("verified, not guessed"). Colors are used only on this
 *  semantic axis (status/provenance), not for decoration.
 *
 *  - constructor: deterministic — guaranteed by the generator (steel-blue: "system, solid").
 *  - ai:          filled by Surgical AI, verified (calm teal).
 *  - pending:     not filled yet (amber — attention, not alarm).
 *  - failed:      couldn't verify, left as a stub (calm danger).
 *  - human:       you edited this (violet). */
export const PROVENANCE: Record<RegionKind, { color: string; bg: string; label: string; hint: string }> = {
  constructor: { color: "var(--prov-constructor)", bg: "var(--prov-constructor-bg)", label: "Constructor", hint: "Deterministic. Guaranteed by the generator." },
  ai: { color: "var(--prov-ai)", bg: "var(--prov-ai-bg)", label: "Surgical AI", hint: "Filled by AI, verified." },
  pending: { color: "var(--prov-pending)", bg: "var(--prov-pending-bg)", label: "Pending", hint: "Not filled yet." },
  failed: { color: "var(--prov-failed)", bg: "var(--prov-failed-bg)", label: "Unverified", hint: "Couldn't verify — left as a stub." },
  human: { color: "var(--prov-human)", bg: "var(--prov-human-bg)", label: "You", hint: "You edited this." },
};

/** Is a file line a surgical (edit point) marker? Bridge from lib. */
export { isSurgicalLine } from "./lib";

/** GeneratedFile.language -> human-readable label (status bar / breadcrumb). */
export function languageLabel(language: GeneratedFile["language"]): string {
  switch (language) {
    case "typescript":
      return "TypeScript";
    case "sql":
      return "SQL";
    case "json":
      return "JSON";
    case "markdown":
      return "Markdown";
    case "env":
      return "Env";
    default:
      return "Plain text";
  }
}
