/** OmniBar — AI architect chat bar. Embeds into BottomBar center slot.
 *  Agent mode: generates architecture via tool calling. Instruct mode: text-only chat
 *  + [[node:ID|name]] markup → NodeChip + canvas focus.
 *  Compact live progress during streaming, spacious panel after done/error. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, CornerDownLeft, X, AlertCircle, Wand2, MessageSquareText, ChevronRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import Markdown from "react-markdown";
import { useAiChatStream, type AiMode } from "../../api/ai";
import { useSubscription } from "../../api/billing";
import type { TabGraphData } from "../../api/tabs";
import { useCanvasCommands } from "../../canvas/canvas-commands";
import { useIsGuest, openGuestSignupModal } from "../../lib/guest";
import { processChildren, splitSentences, extractMarkers } from "./markdown-chips";
import { LockedAiBar } from "./LockedAiBar";
import { cn } from "@/lib/utils";

const MARKER_FOCUS_DELAY_MS = 2000; // delay between markers within the same sentence

// Fraction of the viewport height the instruct explanation panel occupies at the
// bottom. focusNode keeps the highlighted node above this band so the node and the
// explanation text never overlap. (panel max-h is 60vh + h-12 BottomBar underneath.)
const INSTRUCT_PANEL_RESERVE = 0.46;

const MODE_STORAGE_KEY = "solarch:ai-mode";

export function OmniBar({ projectId, tabId }: { projectId: string; tabId: string | null }) {
  const [text, setText] = useState("");
  const [resultDismissed, setResultDismissed] = useState(false);
  const [mode, setMode] = useState<AiMode>(() => {
    if (typeof window === "undefined") return "agent";
    const saved = window.sessionStorage.getItem(MODE_STORAGE_KEY);
    return saved === "instruct" ? "instruct" : "agent";
  });
  const stream = useAiChatStream(projectId, tabId);
  const qc = useQueryClient();
  const navigate = useNavigate();

  // AI is no longer plan-locked — everyone uses a 4-hour window quota.
  // Lock only when the quota is exhausted: remaining allowance per mode (agent=generations,
  // instruct=questions). Wait on subLoading (don't show a false-negative lock).
  const { data: subscription, isLoading: subLoading } = useSubscription();
  const isGuest = useIsGuest();
  const meterKey = mode === "agent" ? "generations" : "questions";
  const meterCap = subscription?.meters[meterKey] ?? 0;
  const meterUsed = subscription?.usage[meterKey] ?? 0;
  const remaining = Math.max(0, meterCap - meterUsed);
  const aiLocked = !subLoading && !!subscription && remaining <= 0;
  const resetCountdown = useResetCountdown(aiLocked ? subscription?.windowResetAt : undefined, () =>
    qc.invalidateQueries({ queryKey: ["subscription"] }),
  );

  const isStreaming = stream.status === "streaming";
  const isError = stream.status === "error";
  const isDone = stream.status === "done";
  const isPaused = stream.status === "paused";
  const showResult = (isDone || isError || (isStreaming && stream.mode === "instruct" && stream.accumulatedText)) && !resultDismissed;

  // Persist mode change to sessionStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(MODE_STORAGE_KEY, mode);
    }
  }, [mode]);

  const send = () => {
    if (subLoading) return; // wait for plan info — don't false-negative
    if (aiLocked) {
      if (isGuest) openGuestSignupModal();
      else navigate("/billing");
      return;
    }
    const m = text.trim();
    if (!m || isStreaming) return;
    // Last allowance being spent → instant "almost out" warning on request (no persistent counter UI).
    if (meterCap > 0 && remaining === 1) {
      toast.warning(
        mode === "agent" ? "This is your last AI build for now" : "This is your last AI question for now",
        { description: "Your allowance refreshes every few hours." },
      );
    }
    setResultDismissed(false);
    stream.start(m, mode);
    setText("");
  };

  // Graph cache reference for instruct mode (type lookup for chip family color)
  const graph = qc.getQueryData<TabGraphData>(["tab-graph", projectId, tabId]) ?? null;

  // Live progress during streaming (compact popover)
  const progressText = (() => {
    if (!isStreaming) return null;
    const { nodes, edges } = stream.progress;
    if (nodes === 0 && edges === 0) return "AI architect is thinking…";
    const parts: string[] = [];
    if (nodes > 0) parts.push(`${nodes} node`);
    if (edges > 0) parts.push(`${edges} edge`);
    return `${parts.join(", ")} created…`;
  })();

  return (
    <div className="relative w-full max-w-[560px]">
      {/* Result panel — agent done or instruct stream/done */}
      {showResult && (
        <ResultPanel
          mode={stream.mode}
          variant={isError ? "error" : "done"}
          isStreaming={isStreaming}
          counts={stream.progress}
          summaryText={isError ? (stream.error ?? "AI connection lost.") : (stream.message ?? "Completed.")}
          liveText={stream.accumulatedText}
          graph={graph}
          onClose={() => setResultDismissed(true)}
          onRetry={isError && stream.retryable ? () => { setResultDismissed(false); stream.retry(); } : undefined}
        />
      )}

      {/* Step limit (MAX_TURNS) — partial architecture preserved; "Continue" resumes where it left off */}
      {isPaused && !resultDismissed && (
        <div
          className={cn(
            "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-auto max-w-[520px]",
            "flex items-center gap-3 px-3 py-2 rounded-md",
            "bg-card/95 backdrop-blur-xl border border-border shadow-card",
            "animate-in fade-in slide-in-from-bottom-1 duration-200"
          )}
        >
          <span className="font-mono text-[12px] text-muted-foreground whitespace-normal">
            {stream.message ?? "Step limit reached."}
          </span>
          <button
            type="button"
            onClick={() => { setResultDismissed(false); stream.continueRun(); }}
            className={cn(
              "shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded font-mono text-[12px] font-medium",
              "bg-brand-500 text-black hover:bg-brand-600 transition-colors"
            )}
          >
            <ChevronRight size={12} />
            Continue
          </button>
          <button
            type="button"
            onClick={() => setResultDismissed(true)}
            aria-label="Close"
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Agent mode streaming live progress — in instruct mode ResultPanel already acts as typewriter */}
      {isStreaming && stream.mode === "agent" && progressText && (
        <div
          className={cn(
            "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-auto whitespace-nowrap",
            "px-3 py-1.5 rounded-md font-mono text-[12px]",
            "bg-card/95 backdrop-blur-xl border border-border text-muted-foreground shadow-card",
            "animate-in fade-in slide-in-from-bottom-1 duration-200"
          )}
        >
          {progressText}
        </div>
      )}

      {/* 4h quota exhausted → quota bar instead of input: countdown + CTA.
          Guest → targeted signup modal (2x limit), signed-in → /billing (Build). */}
      {aiLocked ? (
        <LockedAiBar
          title={mode === "agent" ? "AI build limit reached" : "AI question limit reached"}
          subtitle={
            (resetCountdown ? `Resets in ${resetCountdown}` : "Resets every 4 hours") +
            (isGuest ? " — sign up for 2x limits" : " — upgrade for more")
          }
          ctaLabel={isGuest ? "Sign up" : "Upgrade"}
          onUpgrade={() => (isGuest ? openGuestSignupModal() : navigate("/billing"))}
        />
      ) : (
      <div
        className={cn(
          "flex items-center gap-1.5 h-8 pl-1 pr-2 rounded-md border bg-card/80 backdrop-blur-xl transition-colors",
          "focus-within:border-brand-500/60 focus-within:bg-card",
          isStreaming ? "border-brand-500/40" : "border-border"
        )}
      >
        {/* Mode switch — segmented control */}
        <ModeSwitch mode={mode} onChange={setMode} disabled={isStreaming} />
        <Sparkles size={14} className={cn("shrink-0 ml-0.5", isStreaming ? "text-brand-500 animate-pulse" : "text-brand-500")} />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder={
            mode === "agent"
              ? 'Build or refactor — e.g. "add auth" or "rename UserService"'
              : "What do you want to learn about the architecture?"
          }
          spellCheck={false}
          disabled={isStreaming}
          className="flex-1 bg-transparent outline-none border-0 text-[13px] placeholder:text-muted-foreground/70 disabled:opacity-60"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={stream.abort}
            aria-label="Cancel"
            className={cn(
              "shrink-0 inline-flex items-center justify-center w-6 h-6 rounded transition-colors",
              "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            )}
          >
            <X size={12} />
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!text.trim()}
            aria-label="Send"
            className={cn(
              "shrink-0 inline-flex items-center justify-center w-6 h-6 rounded transition-colors",
              "text-muted-foreground hover:bg-muted hover:text-foreground",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            <CornerDownLeft size={12} />
          </button>
        )}
      </div>
      )}
    </div>
  );
}

/** 4h window countdown in "2h 13m" format — runs every 30s only while the quota
 *  lock is active (when resetAt is given). When the window closes onExpired fires
 *  once (subscription cache refreshes → bar opens by itself). */
function useResetCountdown(resetAt: string | undefined, onExpired?: () => void): string | null {
  const [now, setNow] = useState(() => Date.now());
  const expiredRef = useRef<string | null>(null);
  const onExpiredRef = useRef(onExpired);
  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  useEffect(() => {
    if (!resetAt) return;
    const tick = () => {
      setNow(Date.now());
      if (Date.now() >= new Date(resetAt).getTime() && expiredRef.current !== resetAt) {
        expiredRef.current = resetAt;
        onExpiredRef.current?.();
      }
    };
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [resetAt]);

  if (!resetAt) return null;
  const ms = new Date(resetAt).getTime() - now;
  if (ms <= 0) return "a moment";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.ceil((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Mode switch — segmented control (Agent / Instruct).
 *  Linear/Vercel style: active button soft-shadow + brand color; inactive muted. */
function ModeSwitch({ mode, onChange, disabled }: { mode: AiMode; onChange: (m: AiMode) => void; disabled: boolean }) {
  const Btn = ({ value, icon, label, title }: { value: AiMode; icon: React.ReactNode; label: string; title: string }) => {
    const active = mode === value;
    return (
      <button
        type="button"
        onClick={() => !disabled && onChange(value)}
        disabled={disabled}
        title={title}
        aria-pressed={active}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11.5px] font-medium transition-all duration-150",
          active
            ? "bg-card text-brand-500 shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/30",
          disabled && "opacity-60 cursor-not-allowed"
        )}
      >
        {icon}
        <span>{label}</span>
      </button>
    );
  };
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded bg-muted/40 border border-border/40 shrink-0">
      <Btn value="agent" icon={<Wand2 size={10} />} label="Agent" title="Build architecture" />
      <Btn value="instruct" icon={<MessageSquareText size={10} />} label="Instruct" title="Chat about architecture" />
    </div>
  );
}

/** Mode-aware result panel. Agent → final summary. Instruct → sentence player
 *  (each sentence with smooth fade-in, markers focus canvas every 2s, step by step with Next). */
function ResultPanel({
  mode,
  variant,
  isStreaming,
  counts,
  summaryText,
  liveText,
  graph,
  onClose,
  onRetry,
}: {
  mode: AiMode;
  variant: "done" | "error";
  isStreaming: boolean;
  counts: { nodes: number; edges: number };
  summaryText: string;
  liveText: string;
  graph: TabGraphData | null;
  onClose: () => void;
  onRetry?: () => void;
}) {
  const isError = variant === "error";
  const isInstruct = mode === "instruct";

  // Smart focus tracker — if same id appears in multiple sentences: first zoom, then highlight
  const focusedSetRef = useRef(new Set<string>());

  // Sentence player state — instruct mode
  const [revealedCount, setRevealedCount] = useState(0);
  const focusTimersRef = useRef<number[]>([]);

  // Text from backend → sentences + incomplete buffer
  const { sentences } = useMemo(
    () => (isInstruct ? splitSentences(liveText) : { sentences: [], buffer: "" }),
    [liveText, isInstruct],
  );

  // State reset when new stream starts (when liveText begins filling from empty)
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current) {
      // New session — old narration's spotlight must drop before the new one lights up.
      focusedSetRef.current.clear();
      setRevealedCount(0);
      useCanvasCommands.getState().clearInstructFocus?.();
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Auto-reveal when first sentence is ready (so user sees it before pressing Next)
  useEffect(() => {
    if (isInstruct && revealedCount === 0 && sentences.length > 0) {
      setRevealedCount(1);
    }
  }, [isInstruct, sentences.length, revealedCount]);

  // New sentence revealed → sequential marker focus (2s intervals)
  useEffect(() => {
    if (!isInstruct || revealedCount === 0) return;
    const sentence = sentences[revealedCount - 1];
    if (!sentence) return;
    // Clear previous timers (may remain from previous sentence)
    focusTimersRef.current.forEach((id) => clearTimeout(id));
    focusTimersRef.current = [];

    const markers = extractMarkers(sentence);
    const cmds = useCanvasCommands.getState();
    markers.forEach((m, i) => {
      const tid = window.setTimeout(() => {
        if (m.kind === "node") {
          const isFirst = !focusedSetRef.current.has(m.id);
          focusedSetRef.current.add(m.id);
          // instruct: spotlight the node + zoom-out + lift above this panel.
          cmds.focusNode?.(m.id, { zoom: isFirst, instruct: true, reserveBottom: INSTRUCT_PANEL_RESERVE });
        } else {
          focusedSetRef.current.add(m.id);
          cmds.focusEdge?.(m.id);
        }
      }, i * MARKER_FOCUS_DELAY_MS);
      focusTimersRef.current.push(tid);
    });

    return () => {
      focusTimersRef.current.forEach((id) => clearTimeout(id));
      focusTimersRef.current = [];
    };
  }, [revealedCount, isInstruct, sentences]);

  // Unmount cleanup — panel gone (closed / dismissed / stream reset) → lift the
  // instruct spotlight so the canvas returns to its selection (or no-dim) state.
  useEffect(() => () => {
    focusTimersRef.current.forEach((id) => clearTimeout(id));
    useCanvasCommands.getState().clearInstructFocus?.();
  }, []);

  // Have all markers in active sentence been focused (for Next button to be active)
  const activeSentence = isInstruct ? sentences[revealedCount - 1] : null;
  const activeMarkerCount = activeSentence ? extractMarkers(activeSentence).length : 0;
  const activeFocusDurationMs = activeMarkerCount * MARKER_FOCUS_DELAY_MS;
  const [focusDoneTick, setFocusDoneTick] = useState(0);
  useEffect(() => {
    if (!isInstruct) return;
    if (activeFocusDurationMs === 0) {
      setFocusDoneTick(revealedCount);
      return;
    }
    const tid = window.setTimeout(() => setFocusDoneTick(revealedCount), activeFocusDurationMs);
    return () => clearTimeout(tid);
  }, [revealedCount, activeFocusDurationMs, isInstruct]);

  const focusSettled = focusDoneTick === revealedCount;
  const hasNext = isInstruct && revealedCount < sentences.length;
  const waitingForNext = isInstruct && !hasNext && isStreaming;
  const allRevealed = isInstruct && !isStreaming && revealedCount >= sentences.length;

  const advance = () => {
    if (hasNext) setRevealedCount((c) => c + 1);
  };

  // Render text
  const renderText = isInstruct
    ? sentences.slice(0, revealedCount).join("")
    : summaryText;

  const focusedSet = focusedSetRef.current;

  return (
    <div
      className={cn(
        "absolute bottom-full left-1/2 -translate-x-1/2 mb-2",
        "w-[min(640px,92vw)] max-h-[60vh] flex flex-col",
        "rounded-lg border bg-card/95 backdrop-blur-xl shadow-float overflow-hidden",
        "animate-in fade-in slide-in-from-bottom-2 duration-250",
        isError ? "border-destructive/40" : "border-border"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          {isError ? (
            <AlertCircle size={13} className="text-destructive shrink-0" />
          ) : isInstruct ? (
            <MessageSquareText size={13} className="text-brand-500 shrink-0" />
          ) : (
            <Sparkles size={13} className="text-brand-500 shrink-0" />
          )}
          <span className="text-[12px] font-mono uppercase tracking-[0.08em] text-muted-foreground">
            {isError ? "AI architect — error" : isInstruct ? "AI architect · chat" : "AI architect"}
          </span>
          {!isError && !isInstruct && (counts.nodes > 0 || counts.edges > 0) && (
            <span className="text-[12px] text-muted-foreground/70 truncate">
              · {counts.nodes} node, {counts.edges} edge
            </span>
          )}
          {!isError && isInstruct && sentences.length > 0 && (
            <span className="text-[12px] text-muted-foreground/70">
              · sentence {revealedCount}/{sentences.length}
              {isStreaming && " · typing…"}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded transition-colors text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X size={12} />
        </button>
      </div>

      {/* Content — Markdown */}
      <div className={cn("px-4 py-3 overflow-y-auto flex-1", isError ? "text-destructive" : "text-foreground")}>
        {isError ? (
          <div className="space-y-2.5">
            <p className="text-[13.5px] leading-relaxed">{renderText}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded font-mono text-[12px] font-medium bg-brand-500 text-black hover:bg-brand-600 transition-colors"
              >
                <RefreshCw size={11} />
                Try again
              </button>
            )}
          </div>
        ) : (
          <div
            key={revealedCount /* soft fade-in on each new sentence reveal */}
            className={cn(
              "text-foreground space-y-2",
              isInstruct && revealedCount > 0 && "animate-in fade-in duration-300"
            )}
          >
            <Markdown
              components={{
                h1: ({ children }) => <h2 className="text-[15px] font-semibold mt-4 first:mt-0 text-foreground">{processChildren(children, focusedSet, graph, !isInstruct)}</h2>,
                h2: ({ children }) => <h2 className="text-[14px] font-semibold mt-3 first:mt-0 text-foreground">{processChildren(children, focusedSet, graph, !isInstruct)}</h2>,
                h3: ({ children }) => <h3 className="text-[13.5px] font-semibold mt-2.5 first:mt-0 text-foreground">{processChildren(children, focusedSet, graph, !isInstruct)}</h3>,
                p: ({ children }) => <p className="text-[13.5px] leading-relaxed text-foreground/90">{processChildren(children, focusedSet, graph, !isInstruct)}</p>,
                ul: ({ children }) => <ul className="text-[13.5px] space-y-0.5 my-1.5 pl-4 list-disc marker:text-muted-foreground/60">{children}</ul>,
                ol: ({ children }) => <ol className="text-[13.5px] space-y-0.5 my-1.5 pl-5 list-decimal marker:text-muted-foreground/60">{children}</ol>,
                li: ({ children }) => <li className="leading-relaxed text-foreground/90">{processChildren(children, focusedSet, graph, !isInstruct)}</li>,
                strong: ({ children }) => <strong className="font-semibold text-foreground">{processChildren(children, focusedSet, graph, !isInstruct)}</strong>,
                em: ({ children }) => <em className="italic text-foreground/85">{processChildren(children, focusedSet, graph, !isInstruct)}</em>,
                code: ({ children }) => <code className="font-mono text-[12.5px] bg-muted/60 px-1 py-0.5 rounded text-foreground">{children}</code>,
                hr: () => <hr className="my-3 border-border/60" />,
                a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-brand-500 hover:underline">{children}</a>,
              }}
            >
              {renderText}
            </Markdown>
          </div>
        )}
      </div>

      {/* Sentence player footer — Next button (instruct mode) */}
      {isInstruct && !isError && (hasNext || waitingForNext || activeMarkerCount > 0) && (
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-border/60 bg-muted/20">
          <div className="text-[11.5px] text-muted-foreground/80 font-mono">
            {activeMarkerCount > 0 && !focusSettled
              ? `${activeMarkerCount} focusing references…`
              : waitingForNext
                ? "AI is typing…"
                : allRevealed
                  ? "Completed"
                  : "Ready"}
          </div>
          <button
            type="button"
            onClick={advance}
            disabled={!hasNext || !focusSettled}
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-[12.5px] font-medium transition-all duration-150",
              hasNext && focusSettled
                ? "bg-brand-500 text-black hover:bg-brand-600 shadow-sm hover:shadow"
                : "bg-muted/50 text-muted-foreground/60 cursor-not-allowed"
            )}
          >
            <span>Continue</span>
            <ChevronRight size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
