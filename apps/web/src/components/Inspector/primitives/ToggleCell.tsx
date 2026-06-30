/** ToggleCell — compact boolean cell for a dense grid (aligned across PK/NN/UQ/AI… columns).
 *  Instead of a pill-toggle + Switch: an 18px checkbox-style square. On = filled (family/accent) + check;
 *  off = thin border. Research: boolean→toggle, instant effect, high-contrast on/off signal. */

import { Check } from "lucide-react";

export function ToggleCell({
  checked,
  onChange,
  ariaLabel,
  tone = "accent",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
  /** family → node family color + white check (PK); accent → orange + black check (NN/UQ/AI). */
  tone?: "family" | "accent";
}) {
  const onColor = tone === "family" ? "var(--ins-family-accent, var(--accent))" : "var(--accent)";
  const checkColor = tone === "family" ? "#fff" : "#000"; // black on orange, white on family
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={() => onChange(!checked)}
      className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ins-family-accent,var(--accent))]/40"
      style={
        checked
          ? { background: onColor, borderColor: "transparent", color: checkColor }
          : { background: "transparent", borderColor: "var(--hairline-strong)", color: "transparent" }
      }
    >
      <Check size={12} strokeWidth={3} />
    </button>
  );
}
