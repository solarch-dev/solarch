/** Segmented control — 2-5 mutually-exclusive options (visibility, HTTP verb). Research:
 *  segmented > dropdown for enum/exclusive-set (single click, instant effect, always one active). Replaces
 *  the pill-preset (vis and http colors). Active option is colored via `colorVar` (verb=http colors,
 *  vis=ok/warn/danger). Style: DrawerShell tab pattern (track + lifted active chip) — theme-aware --ins token. */

import { cn } from "@/lib/utils";

export interface SegOption {
  value: string;
  label: string;
  /** Text color CSS variable when active (e.g. "--http-get", "--ok"). Falls back to --ink. */
  colorVar?: string;
}

export function Segmented({
  value,
  onChange,
  options,
  ariaLabel,
  size = "sm",
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SegOption[];
  ariaLabel?: string;
  size?: "xs" | "sm";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-px rounded-md p-[2px]"
      style={{ background: "var(--ins-track)" }}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center justify-center rounded font-mono font-semibold uppercase tracking-[0.04em] outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-[color:var(--ins-family-accent,var(--accent))]/40",
              size === "xs" ? "h-5 px-1.5 text-[10px]" : "h-[26px] px-2.5 text-[11px]",
            )}
            style={
              active
                ? {
                    background: "var(--ins-tab-active)",
                    boxShadow: "var(--ins-tab-shadow)",
                    color: o.colorVar ? `var(${o.colorVar})` : "var(--ink)",
                  }
                : { background: "transparent", color: "var(--ink-faint)" }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
