/** OnboardingTour — spotlighted interactive tour on the new user's first canvas.
 *
 *  Flow (in real user-journey order): welcome → project menu → right-click to
 *  add a node → double-click editor → port-drag connection (Rules Engine) → tabs →
 *  ⌘K command palette → node library (Docs) → AI omni-bar.
 *
 *  Mechanics: the target element is marked with `data-tour="..."`; the tour shows
 *  a dimmed "hole" (box-shadow spotlight) around the element + a pulsing orange
 *  ring + a positioned description card. Advances via Next/Back/Skip;
 *  Esc = skip, →/Enter = next. Once completed/skipped, a localStorage flag is
 *  written and it never shows again. Steps whose target is not in the DOM are skipped. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { X, ArrowRight, ArrowLeft, MousePointerClick, Sparkles } from "lucide-react";
import { Z_LAYERS } from "../../lib/z-layers";

const TOUR_KEY = "solarch:tour-done";

interface TourStep {
  id: string;
  /** CSS selector (data-tour anchor). null → centered welcome card. */
  target: string | null;
  title: string;
  body: string;
  /** Optional shortcut badge (e.g. "⌘K"). */
  kbd?: string;
}

const STEPS: TourStep[] = [
  {
    id: "welcome",
    target: null,
    title: "Welcome to Solarch",
    body: "This canvas is your architecture workspace. Here's a 60-second tour of the essentials — skip anytime.",
  },
  {
    id: "project-menu",
    target: '[data-tour="project-menu"]',
    title: "Your projects live here",
    body: "Click to switch between projects or create a new one. Everything you draw is saved automatically.",
  },
  {
    id: "add-node",
    target: '[data-tour="canvas"]',
    title: "Right-click to add a node",
    body: "Right-click anywhere on the canvas to open the node menu — tables, services, controllers and 18 more building blocks.",
  },
  {
    id: "editor",
    target: '[data-tour="canvas"]',
    title: "Double-click to edit",
    body: "Every node has a purpose-built editor: column grids for tables, method tables for services, endpoint rows for controllers.",
    kbd: "\u2318E",
  },
  {
    id: "edges",
    target: '[data-tour="canvas"]',
    title: "Connect nodes — legally",
    body: "Hover a node, drag from its port to another node. The Rules Engine validates every connection — illegal ones never land.",
  },
  {
    id: "tabs",
    target: '[data-tour="new-tab"]',
    title: "Organize with tabs",
    body: "Split a big architecture into tabs. A node lives in one tab and can be referenced from others — one source of truth.",
  },
  {
    id: "cmdk",
    target: '[data-tour="cmdk"]',
    title: "Command palette",
    body: "One search box for everything: create nodes, jump between tabs, run canvas actions.",
    kbd: "\u2318K",
  },
  {
    id: "docs",
    target: '[data-tour="docs"]',
    title: "Node library & docs",
    body: "Browse all node types, the 16 edge kinds, and keyboard shortcuts whenever you need a reference.",
  },
  {
    id: "ai",
    target: '[data-tour="omnibar"]',
    title: "AI architect",
    body: "Type what you want to build into this bar — e.g. \"a blog API with users, posts and auth\" — and the AI draws the whole graph. Every change is validated by the Rules Engine.",
  },
  {
    id: "generate",
    target: '[data-tour="generate"]',
    title: "Then generate a real backend",
    body: "That's the point of the diagram: when it's ready, Generate Code turns it into a real, type-checked NestJS project — then surgical AI fills the algorithmic gaps. Draw → Refine → Generate.",
  },
];

const HINT_KEY = "solarch:omnibar-hint-done";

function shouldShowHint(): boolean {
  try {
    return !localStorage.getItem(HINT_KEY);
  } catch {
    return false;
  }
}

function markHintDone(): void {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    /* no storage */
  }
}

function shouldShowTour(): boolean {
  try {
    return !localStorage.getItem(TOUR_KEY);
  } catch {
    return false;
  }
}

function markTourDone(): void {
  try {
    localStorage.setItem(TOUR_KEY, "1");
  } catch {
    /* no storage */
  }
}

const CARD_W = 340;
const PAD = 8; // breathing room around the spotlight target

export function OnboardingTour() {
  const [active, setActive] = useState(false);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Post-tour OmniBar hint — even after the tour ends, the AI bar stays
  // highlighted for a while, saying "type your idea here" until the user touches
  // (or dismisses) the bar.
  const [hintVisible, setHintVisible] = useState(false);

  // First visit: start with a short delay so the chrome settles; filter out
  // steps whose target doesn't exist (e.g. depending on route) up front.
  useEffect(() => {
    if (!shouldShowTour()) {
      // Tour already finished but the hint was never dismissed → highlight the bar again.
      if (shouldShowHint()) {
        const t = setTimeout(() => setHintVisible(true), 1_200);
        return () => clearTimeout(t);
      }
      return;
    }
    const t = setTimeout(() => {
      const available = STEPS.filter((s) => !s.target || document.querySelector(s.target));
      if (available.length === 0) return;
      setSteps(available);
      setActive(true);
    }, 1_000);
    return () => clearTimeout(t);
  }, []);

  const step = steps[idx];

  const finish = useCallback(() => {
    markTourDone();
    setActive(false);
    if (shouldShowHint()) setHintVisible(true);
  }, []);

  const next = useCallback(() => {
    setIdx((i) => {
      if (i + 1 >= steps.length) {
        finish();
        return i;
      }
      return i + 1;
    });
  }, [steps.length, finish]);

  const back = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);

  // Measure the target; re-measure when the window size changes.
  useLayoutEffect(() => {
    if (!active || !step) return;
    const measure = () => {
      if (!step.target) {
        setRect(null);
        return;
      }
      const el = document.querySelector(step.target);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active, step]);

  // Keyboard: Esc skip, →/Enter next, ← back.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, next, back, finish]);

  // Card placement: below the target → if it doesn't fit, above → if that
  // doesn't fit either (target fills the screen, like the whole canvas), center
  // it INSIDE the target. Clamped to the viewport in every case — the card never
  // spills off-screen.
  const cardStyle = useMemo<React.CSSProperties>(() => {
    const vh = window.innerHeight;
    const common: React.CSSProperties = { maxHeight: vh - 16, overflowY: "auto" };
    if (!rect) {
      return { ...common, left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
    }
    const vw = window.innerWidth;
    const estH = 240; // card ~210-230px; with margin
    const gap = PAD + 14;

    let top: number;
    if (vh - rect.bottom > estH + gap) {
      top = rect.bottom + gap; // below it
    } else if (rect.top > estH + gap) {
      top = rect.top - gap - estH; // above it
    } else {
      top = rect.top + rect.height / 2 - estH / 2; // center inside the target
    }
    top = Math.min(Math.max(8, top), vh - estH - 8);

    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - CARD_W / 2), vw - CARD_W - 12);
    return { ...common, left, top };
  }, [rect]);

  if (!active || !step) {
    return hintVisible ? (
      <OmniBarHint
        onDismiss={() => {
          markHintDone();
          setHintVisible(false);
        }}
      />
    ) : null;
  }

  const isLast = idx === steps.length - 1;

  return (
    <div className="fixed inset-0" style={{ zIndex: Z_LAYERS.TOUR }} role="dialog" aria-label="Onboarding tour">
      {/* Dimming: a holed spotlight if there's a target, otherwise a flat scrim. */}
      {rect ? (
        <>
          <div
            className="absolute rounded-[10px] transition-all duration-300 ease-out"
            style={{
              left: rect.left - PAD,
              top: rect.top - PAD,
              width: rect.width + PAD * 2,
              height: rect.height + PAD * 2,
              boxShadow: "0 0 0 9999px rgba(15,15,14,0.5)",
            }}
          />
          {/* Pulsing highlight ring */}
          <div
            aria-hidden
            className="absolute rounded-[10px] border-2 border-[#ff6b1a] animate-pulse pointer-events-none transition-all duration-300 ease-out"
            style={{
              left: rect.left - PAD,
              top: rect.top - PAD,
              width: rect.width + PAD * 2,
              height: rect.height + PAD * 2,
              boxShadow: "0 0 18px rgba(255,107,26,0.35)",
            }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-[rgba(15,15,14,0.5)]" />
      )}

      {/* Description card */}
      <div
        className="absolute rounded-[12px] border border-[color:var(--hairline)] bg-[var(--paper-raised)]
                   shadow-[0_12px_40px_rgba(11,16,32,0.25)] animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ ...cardStyle, width: CARD_W }}
      >
        {/* Terminal chrome strip — same as the auth/brand language */}
        <div className="flex items-center gap-2 border-b border-[color:var(--hairline)] px-4 py-2">
          <span className="h-2 w-2 rounded-full bg-[#ff6b1a]" />
          <span className="h-2 w-2 rounded-full bg-[color:var(--hairline-strong)]" />
          <span className="h-2 w-2 rounded-full bg-[color:var(--hairline-strong)]" />
          <span className="ml-1 font-mono text-[11.5px] tracking-[0.04em] text-[color:var(--ink-faint)]">
            solarch@tour:~ {idx + 1}/{steps.length}
          </span>
          <button
            type="button"
            onClick={finish}
            aria-label="Skip tour"
            className="ml-auto inline-flex items-center gap-1 font-mono text-[11.5px] text-[color:var(--ink-faint)]
                       transition-colors hover:text-[#ff6b1a]"
          >
            skip
            <X size={11} />
          </button>
        </div>

        <div className="p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#ff6b1a]/10 text-[#ff6b1a]">
              {step.id === "ai" ? <Sparkles size={13} /> : <MousePointerClick size={13} />}
            </span>
            <h2 className="font-sans text-[16px] font-semibold tracking-[-0.01em] text-[color:var(--ink)]">
              {step.title}
            </h2>
            {step.kbd && (
              <kbd className="ml-auto rounded border border-[color:var(--hairline)] bg-[var(--paper)] px-1.5 py-0.5 font-mono text-[11.5px] text-[color:var(--ink-soft)]">
                {step.kbd}
              </kbd>
            )}
          </div>
          <p className="mt-2.5 font-mono text-[13px] leading-relaxed text-[color:var(--ink-soft)]">
            {step.body}
          </p>

          <div className="mt-4 flex items-center gap-2">
            {/* Progress dots */}
            <div className="flex items-center gap-1" aria-hidden>
              {steps.map((s, i) => (
                <span
                  key={s.id}
                  className={
                    i === idx
                      ? "h-1.5 w-4 rounded-full bg-[#ff6b1a] transition-all duration-200"
                      : "h-1.5 w-1.5 rounded-full bg-[color:var(--hairline-strong)] transition-all duration-200"
                  }
                />
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              {idx > 0 && (
                <button
                  type="button"
                  onClick={back}
                  className="inline-flex h-8 items-center gap-1 rounded-[7px] border border-[color:var(--hairline)]
                             px-2.5 font-mono text-[13px] text-[color:var(--ink-soft)] transition-colors
                             hover:border-[#ff6b1a]/40 hover:text-[color:var(--ink)]"
                >
                  <ArrowLeft size={12} />
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={next}
                autoFocus
                className="group inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-[#ff6b1a] px-3.5
                           font-mono text-[13px] font-medium text-white transition-colors hover:bg-[#d94d00]"
              >
                {isLast ? "Start building" : "Next"}
                <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Post-tour OmniBar hint — a soft pulsing ring around the bar + a "type your
 *  idea here" bubble above it. Dismissed permanently (localStorage) when the user
 *  touches/focuses the bar or clicks X. NO spotlight scrim — the canvas stays
 *  fully usable, it only draws attention. */
function OmniBarHint({ onDismiss }: { onDismiss: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const el = document.querySelector('[data-tour="omnibar"]');
    if (!el) return;

    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    window.addEventListener("resize", measure);

    // Any touch/focus on the bar → the hint did its job, dismiss it.
    const dismiss = () => onDismiss();
    el.addEventListener("pointerdown", dismiss);
    el.addEventListener("focusin", dismiss);
    return () => {
      window.removeEventListener("resize", measure);
      el.removeEventListener("pointerdown", dismiss);
      el.removeEventListener("focusin", dismiss);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!rect) return null;

  return (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: Z_LAYERS.TOUR }} aria-hidden={false}>
      {/* Pulsing highlight ring — no scrim, attention only */}
      <div
        aria-hidden
        className="absolute rounded-[10px] border-2 border-[#ff6b1a]/70 animate-pulse pointer-events-none"
        style={{
          left: rect.left - PAD,
          top: rect.top - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
          boxShadow: "0 0 16px rgba(255,107,26,0.25)",
        }}
      />
      {/* Bubble — above the bar, centered */}
      <div
        className="absolute pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{
          left: rect.left + rect.width / 2,
          top: rect.top - PAD - 10,
          transform: "translate(-50%, -100%)",
        }}
      >
        <div
          className="flex items-center gap-2 rounded-[10px] border border-[color:var(--hairline)]
                     bg-[var(--paper-raised)] py-2 pl-3 pr-2 shadow-[0_8px_28px_rgba(11,16,32,0.18)]"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#ff6b1a]/10 text-[#ff6b1a]">
            <Sparkles size={13} />
          </span>
          <p className="font-mono text-[12.5px] leading-snug text-[color:var(--ink-soft)] whitespace-nowrap">
            Have an idea? Type it here — <span className="text-[color:var(--ink)]">AI draws it for you</span>
          </p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss hint"
            className="ml-1 shrink-0 rounded p-1 text-[color:var(--ink-faint)] transition-colors hover:text-[#ff6b1a]"
          >
            <X size={11} />
          </button>
        </div>
        {/* Small arrow pointing down */}
        <div
          aria-hidden
          className="mx-auto h-2 w-2 -mt-1 rotate-45 border-b border-r border-[color:var(--hairline)] bg-[var(--paper-raised)]"
        />
      </div>
    </div>
  );
}
