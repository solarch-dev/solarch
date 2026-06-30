/** ActivityFeed — opencode-style LIVE activity stream: shows every Surgical AI tool action
 *  (read/grep/glob/lookup_members/verify_fill) chronologically. When the user hits fill they
 *  transparently watch "what it did": which file it read, what it searched, which attempt got TS2322, filled.
 *
 *  OBSERVE-ONLY (no writes). SAFE: backend summaries carry no code body / secret.
 *  NO AI-SLOP: no pill/badge/gradient — mono + dot + icon + PROVENANCE color discipline,
 *  matching the existing SurgicalRail/CodeViewer aesthetic (single-source EDITOR/PROVENANCE token). */

import { useEffect, useRef } from "react";
import { Check, FileText, FolderTree, Loader2, ScanSearch, Search, X } from "lucide-react";
import type { FillActivity } from "../../api/codegen";
import { EDITOR, PROVENANCE } from "./theme";

/** Tool → icon (read-only exploration calm/muted; verify result carries color). */
function toolIcon(a: FillActivity) {
  if (a.tool === "verify_fill") {
    return a.ok
      ? <Check size={12} style={{ color: PROVENANCE.ai.color }} />
      : <X size={12} style={{ color: PROVENANCE.failed.color }} />;
  }
  const c = EDITOR.textFaint;
  switch (a.tool) {
    case "read": return <FileText size={12} style={{ color: c }} />;
    case "grep": return <Search size={12} style={{ color: c }} />;
    case "glob": return <FolderTree size={12} style={{ color: c }} />;
    case "lookup_members": return <ScanSearch size={12} style={{ color: c }} />;
    default: return <FileText size={12} style={{ color: c }} />;
  }
}

export function ActivityFeed({ activity, streaming }: { activity: FillActivity[]; streaming: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Scroll to bottom as new actions arrive (live stream feel).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activity.length]);

  if (activity.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        {streaming ? (
          <Loader2 size={16} className="animate-spin" style={{ color: PROVENANCE.ai.color }} />
        ) : null}
        <p className="font-sans text-[12.5px] leading-relaxed" style={{ color: EDITOR.textMuted }}>
          {streaming ? "Watching the Surgical AI work…" : "Press Fill to watch the Surgical AI work."}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-2 py-2"
      style={{ scrollbarWidth: "thin" }}
    >
      <div className="flex flex-col gap-[3px]">
        {activity.map((a, i) => {
          const failed = a.tool === "verify_fill" && a.ok === false;
          return (
            <div key={i} className="flex items-start gap-1.5 font-mono text-[12.5px] leading-[1.5]">
              <span className="mt-[2px] shrink-0">{toolIcon(a)}</span>
              <span className="min-w-0 flex-1">
                {/* Region prefix (distinguishes lines in a parallel stream) — faint. */}
                <span style={{ color: EDITOR.textFaint }}>{a.member}</span>
                <span style={{ color: EDITOR.textFaint }}>  </span>
                <span style={{ color: failed ? PROVENANCE.failed.color : EDITOR.text }}>{a.summary}</span>
                {a.tool === "verify_fill" && a.attempt ? (
                  <span style={{ color: EDITOR.textFaint }}> · attempt {a.attempt}</span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
