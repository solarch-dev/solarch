/**
 * MethodBadge — the HTTP-method chip used across the API reference (sidebar
 * operation rows + operation headers).
 *
 * Replicates Scalar's `HttpMethod.vue` behavior in React:
 *   - normalize the method string (trim + lowercase) before lookup
 *   - render an uppercase short label in a mono font (DELETE -> DEL, OPTIONS -> OPTS)
 *   - color the chip by method
 * Scalar binds a per-method CSS color var (`getHttpMethodInfo(method).colorVar`).
 * We map to Solarch's existing `--http-*` design tokens instead of Scalar's
 * palette, so the reference matches the Inspector's verb coloring and flips
 * automatically with the `.dark` theme.
 *
 * Color-map note (adaptation): the plan listed nominal colors
 * (GET=blue, POST=green, PATCH=amber, ...). Solarch already ships HTTP-verb
 * tokens used by the Inspector (`--http-get` teal, `--http-post` blue,
 * `--http-put` orange, `--http-patch` purple, `--http-delete` red, each with a
 * `-wash` background and `-border`). Reusing those tokens is the correct
 * design-token choice: it keeps the API reference visually consistent with the
 * rest of the app and inherits dark/light flipping for free, so we map to them
 * rather than inventing a parallel palette. Verbs without a dedicated token
 * (OPTIONS / HEAD / TRACE / unknown) fall back to a calm neutral tone.
 *
 * Portable (props-only): no app store / router / util imports, so Plan B can
 * bundle this file standalone for the generated app's `/docs`.
 */

export type MethodBadgeSize = "sm" | "md";

/** Uppercase short labels, mirroring Scalar's `getHttpMethodInfo(method).short`. */
const SHORT_LABEL: Record<string, string> = {
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  delete: "DEL",
  options: "OPTS",
  head: "HEAD",
  trace: "TRACE",
};

/**
 * The single method -> color map for the whole reference. Each entry uses the
 * Solarch `--http-*` token triple (text + faint wash background + soft border).
 * No gradients, no fully-rounded pill — a quiet rounded-rectangle chip.
 */
const TONE: Record<string, string> = {
  get: "bg-[color:var(--http-get-wash)] border-[color:var(--http-get-border)] text-[color:var(--http-get)]",
  post: "bg-[color:var(--http-post-wash)] border-[color:var(--http-post-border)] text-[color:var(--http-post)]",
  put: "bg-[color:var(--http-put-wash)] border-[color:var(--http-put-border)] text-[color:var(--http-put)]",
  patch: "bg-[color:var(--http-patch-wash)] border-[color:var(--http-patch-border)] text-[color:var(--http-patch)]",
  delete:
    "bg-[color:var(--http-delete-wash)] border-[color:var(--http-delete-border)] text-[color:var(--http-delete)]",
};

const NEUTRAL_TONE =
  "bg-[color:var(--paper-sunken)] border-[color:hsl(var(--border))] text-[color:var(--ink-soft)]";

const SIZE: Record<MethodBadgeSize, string> = {
  sm: "h-[18px] min-w-[34px] px-1.5 text-[10px]",
  md: "h-[22px] min-w-[42px] px-2 text-[11px]",
};

/** Normalize a method string the way Scalar does: trim + lowercase. */
function normalize(method: string): string {
  return String(method ?? "").trim().toLowerCase();
}

/**
 * The base color CSS var for a method, so other reference components can color
 * by method from this single source (e.g. tint a path or an accent) without
 * redefining the map. Falls back to `--ink-soft` for verbs without a token.
 */
export function methodColorVar(method: string): string {
  const key = normalize(method);
  return key in TONE ? `var(--http-${key})` : "var(--ink-soft)";
}

export function MethodBadge({ method, size = "md" }: { method: string; size?: MethodBadgeSize }) {
  const key = normalize(method);
  const tone = TONE[key] ?? NEUTRAL_TONE;
  // Show the real verb when it is unknown (more honest than coercing to GET);
  // only an empty/missing method falls back to GET, matching Scalar.
  const label = SHORT_LABEL[key] ?? (key ? key.toUpperCase() : "GET");

  return (
    <span
      className={[
        "inline-flex items-center justify-center rounded-[4px] border",
        "font-mono font-semibold uppercase tracking-[0.04em] leading-none whitespace-nowrap select-none",
        SIZE[size],
        tone,
      ].join(" ")}
    >
      {label}
    </span>
  );
}
