/** FileIcon — distinctive badge per file type (VSCode icon set feel).
 *  Colored letter badge: background + short label based on file extension/language.
 *  Pure color + mono letter. Checks lib's language field and file extension. */

import type { GeneratedFile } from "../../api/codegen";
import { LANG_BADGE } from "./theme";

type Lang = GeneratedFile["language"];

/** Extension-based fine distinction (e.g. .tsx vs .ts, .yml vs .json).
 *  Colors are theme-aware CSS-var tokens (LANG_BADGE → --ed-lang-*). */
function variantFor(name: string, language: Lang): {
  label: string;
  fg: string;
  bg: string;
} {
  const lower = name.toLowerCase();
  const badge = (key: keyof typeof LANG_BADGE, label: string) => ({ label, ...LANG_BADGE[key] });

  if (lower.endsWith(".tsx")) return badge("tsx", "TX");
  if (lower.endsWith(".ts")) return badge("ts", "TS");
  if (lower.endsWith(".sql")) return badge("sql", "DB");
  if (lower.endsWith(".json")) return badge("json", "{}");
  if (lower.endsWith(".md")) return badge("md", "MD");
  if (lower.startsWith(".env") || lower.endsWith(".env") || language === "env")
    return badge("env", "EN");

  // Language-based fallback (when extension doesn't match).
  switch (language) {
    case "typescript":
      return badge("ts", "TS");
    case "sql":
      return badge("sql", "DB");
    case "json":
      return badge("json", "{}");
    case "markdown":
      return badge("md", "MD");
    default:
      return badge("default", "F");
  }
}

export function FileIcon({
  name,
  language,
  size = 16,
}: {
  name: string;
  language: Lang;
  size?: number;
}) {
  const v = variantFor(name, language);
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[3px] font-mono font-semibold leading-none"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        color: v.fg,
        background: v.bg,
        letterSpacing: "-0.04em",
      }}
    >
      {v.label}
    </span>
  );
}
