/** LockedAiBar — premium upgrade CTA shown in OmniBar's center slot when the AI
 *  architect is locked (Draw plan, canUseAI === false).
 *
 *  Synthesis of three explored variants:
 *   - base surface & bold two-line copy  ← v1 "Shimmer border glow" (light paper tokens)
 *   - masked @property conic AURORA ring ← v3 (crisp 1px rotating border, no full-element spin)
 *   - gradient CTA pill + arrow nudge    ← v3
 *   - Lock badge over the sparkle chip   ← v1/v2 (one-glance "gated" cue)
 *
 *  Calm-premium (Linear/Vercel): a slow rotating orange aurora ring + a soft warm
 *  bloom, restrained — no neon bombardment. Bold inviting copy. Click → onUpgrade().
 *
 *  Footprint matches OmniBar: w-full max-w-[560px], a single button-like row.
 *  Self-contained — all keyframes live in a component-scoped <style> (the shared
 *  index.css is never touched, so there are no collisions). lucide icons only, no
 *  emoji. Honours prefers-reduced-motion (keeps the warm border, drops motion).
 */

import { Sparkles, ArrowRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

const HOT = "#ff6b1a"; // brand accent — hot orange
const AMBER = "#ff8a3d"; // brand-500 tone — amber

export function LockedAiBar({
  onUpgrade,
  title = "Unlock AI architecture",
  subtitle = "Generate & refine your system with AI",
  ctaLabel = "Upgrade",
}: {
  onUpgrade: () => void;
  /** Title — e.g. "AI limit reached" in the quota variant. */
  title?: string;
  /** Sub-line — carries the countdown in the quota variant. */
  subtitle?: string;
  /** CTA pill text — "Sign up" for guests. */
  ctaLabel?: string;
}) {
  return (
    <div className="lab-root relative w-full max-w-[560px]">
      <style>{labStyles}</style>

      <button
        type="button"
        onClick={onUpgrade}
        aria-label={`${title} — ${ctaLabel}`}
        className={cn(
          "lab-ring group relative block w-full rounded-[10px] p-px text-left",
          "outline-none focus-visible:ring-2 focus-visible:ring-[var(--lab-hot)]/45",
          "focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
          "transition-transform duration-200 active:scale-[0.992]",
        )}
        style={
          {
            ["--lab-hot" as string]: HOT,
            ["--lab-amber" as string]: AMBER,
          } as React.CSSProperties
        }
      >
        {/* Inner paper surface — content sits on top of the 1px aurora ring. */}
        <span
          className={cn(
            "lab-surface relative z-[1] flex h-9 items-center gap-2.5 rounded-[9px] px-2.5",
            "overflow-hidden bg-paper-raised/95 backdrop-blur-sm",
          )}
        >
          {/* Diagonal sheen — sweeps across the surface on hover. */}
          <span aria-hidden className="lab-shimmer pointer-events-none absolute inset-0 rounded-[9px]" />

          {/* Sparkles chip with a small Lock badge — the "gated" cue. */}
          <span className="lab-icon relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md">
            <Sparkles size={14} strokeWidth={2.2} className="lab-spark text-[var(--lab-hot)]" />
            <Lock
              size={8}
              strokeWidth={2.6}
              aria-hidden
              className="absolute -bottom-0.5 -right-0.5 text-[var(--lab-hot)]"
            />
          </span>

          {/* Bold inviting copy — two lines: title + supporting line. */}
          <span className="relative flex min-w-0 flex-1 flex-col justify-center">
            <span className="lab-title font-sans text-[14px] font-bold leading-tight tracking-[-0.01em]">
              {title}
            </span>
            <span className="truncate font-mono text-[11px] leading-tight text-ink-soft/90">
              {subtitle}
            </span>
          </span>

          {/* Gradient CTA pill — arrow nudges on hover. */}
          <span
            aria-hidden
            className={cn(
              "lab-cta relative flex h-7 shrink-0 items-center gap-1.5 rounded-md pl-2.5 pr-2",
              "font-sans text-[13px] font-semibold text-white",
              "bg-gradient-to-r from-[var(--lab-hot)] to-[var(--lab-amber)]",
            )}
          >
            <span>{ctaLabel}</span>
            <ArrowRight size={13} strokeWidth={2.4} className="lab-arrow" />
          </span>
        </span>
      </button>
    </div>
  );
}

/* ── Scoped styles — everything namespaced under .lab-* / .lab-root so nothing
 * leaks into the shared stylesheet. ─────────────────────────────────────────── */
const labStyles = `
.lab-root { --lab-hot: ${HOT}; --lab-amber: ${AMBER}; }

/* Frame: soft warm shadow that swells on hover. */
.lab-ring {
  isolation: isolate;
  box-shadow:
    0 1px 2px rgba(11, 16, 32, 0.05),
    0 8px 22px -12px color-mix(in srgb, var(--lab-hot) 45%, transparent);
  transition: box-shadow 280ms cubic-bezier(0.22, 1, 0.36, 1),
              transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.lab-ring:hover {
  transform: translateY(-1px);
  box-shadow:
    0 2px 4px rgba(11, 16, 32, 0.06),
    0 14px 34px -10px color-mix(in srgb, var(--lab-hot) 58%, transparent);
}
.lab-ring:active { transform: translateY(0); }

/* Aurora ring — a conic gradient rotated via @property, masked to a crisp 1px
 * border. This is the glow that forms the frame (no full-element spin). */
.lab-ring::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: conic-gradient(
    from var(--lab-angle, 0deg),
    transparent 0deg,
    color-mix(in srgb, var(--lab-amber) 70%, transparent) 60deg,
    var(--lab-hot) 120deg,
    #ffd9b0 150deg,
    var(--lab-hot) 190deg,
    transparent 250deg,
    var(--lab-amber) 320deg,
    transparent 360deg
  );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  animation: lab-spin 6s linear infinite;
  opacity: 0.9;
}

/* Soft outer bloom — warm halo on the paper background; breathes, brighter on hover. */
.lab-ring::after {
  content: "";
  position: absolute;
  inset: -7px;
  border-radius: 16px;
  background: radial-gradient(
    60% 120% at 50% 50%,
    color-mix(in srgb, var(--lab-hot) 24%, transparent),
    color-mix(in srgb, var(--lab-amber) 10%, transparent) 45%,
    transparent 70%
  );
  filter: blur(9px);
  opacity: 0.5;
  z-index: -1;
  animation: lab-breathe 4.5s ease-in-out infinite;
  transition: opacity 0.3s ease;
}
.lab-ring:hover::after { opacity: 0.85; }

@property --lab-angle {
  syntax: "<angle>";
  inherits: false;
  initial-value: 0deg;
}

@keyframes lab-spin { to { --lab-angle: 360deg; } }
@keyframes lab-breathe {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50%      { opacity: 0.8; transform: scale(1.03); }
}

/* Inner surface fine top highlight. */
.lab-surface { box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.65); }

/* Sparkles chip. */
.lab-icon {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--lab-hot) 16%, transparent),
    color-mix(in srgb, var(--lab-amber) 8%, transparent)
  );
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--lab-hot) 22%, transparent);
}
.lab-spark { animation: lab-twinkle 2.8s ease-in-out infinite; }
@keyframes lab-twinkle {
  0%, 100% { opacity: 0.88; transform: scale(1); }
  50%      { opacity: 1;    transform: scale(1.12); }
}

/* Title — dark ink base with a warm sheen band travelling across it. */
.lab-title {
  --lab-ink: #1b1b1a;
  background-image: linear-gradient(
    100deg,
    var(--lab-ink) 0%,
    var(--lab-ink) 38%,
    var(--lab-hot) 50%,
    var(--lab-ink) 62%,
    var(--lab-ink) 100%
  );
  background-size: 220% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  animation: lab-sheen 4.5s ease-in-out infinite;
}
@keyframes lab-sheen {
  0%, 100% { background-position: 200% 0; }
  50%      { background-position: 0% 0; }
}

/* Diagonal shimmer — fades in and sweeps across the surface on hover. */
.lab-shimmer {
  background: linear-gradient(
    105deg,
    transparent 35%,
    color-mix(in srgb, var(--lab-amber) 22%, transparent) 50%,
    transparent 65%
  );
  background-size: 220% 100%;
  background-position: 160% 0;
  opacity: 0;
  transition: opacity 0.25s ease;
}
.lab-ring:hover .lab-shimmer {
  opacity: 1;
  animation: lab-sweep 1.5s ease-in-out infinite;
}
@keyframes lab-sweep {
  0%   { background-position: 160% 0; }
  100% { background-position: -60% 0; }
}

/* CTA pill — subtle lift + arrow nudge on hover. */
.lab-cta {
  box-shadow: 0 1px 8px -2px color-mix(in srgb, var(--lab-hot) 55%, transparent);
  transition: filter 0.2s ease, box-shadow 0.2s ease;
}
.lab-ring:hover .lab-cta {
  filter: brightness(1.05);
  box-shadow: 0 2px 14px -2px color-mix(in srgb, var(--lab-hot) 70%, transparent);
}
.lab-arrow { transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1); }
.lab-ring:hover .lab-arrow { transform: translateX(2px); }

/* Honour reduced-motion — keep the warm border + glow, drop all movement. */
@media (prefers-reduced-motion: reduce) {
  .lab-ring::before,
  .lab-ring::after,
  .lab-spark,
  .lab-title,
  .lab-arrow { animation: none !important; transition: none !important; }
  .lab-ring:hover .lab-shimmer { animation: none !important; }
  .lab-shimmer { transition: none !important; }
  .lab-ring::before { opacity: 0.9; }
}
`;
