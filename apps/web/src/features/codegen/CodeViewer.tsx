/** Codegen EDITOR area — syntax-highlighted view of the selected file (VSCode Dark+).
 *  prism-react-renderer v2 (Highlight render-prop + solarchPrismTheme — CSS-var/theme-aware). Left gutter with
 *  line numbers. SIGNATURE: a provenance "spine" — a thin colored band down the left of
 *  each surgical region, colored by ORIGIN (Constructor / Surgical AI / You / pending /
 *  unverified), with a labeled chip on the marker line. Makes "verified, not guessed"
 *  literally visible. Top BREADCRUMB (path segments). */

import { useEffect, useMemo, useRef, useState } from "react";
import { Highlight } from "prism-react-renderer";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GeneratedFile } from "../../api/codegen";
import { prismLanguageFor, pathSegments, regionSpans, surgicalLineForNode, type RegionKind, type RegionSpan } from "./lib";
import { FileIcon } from "./FileIcon";
import { EDITOR, PROVENANCE, solarchPrismTheme } from "./theme";

/** If focusNodeId is provided: finds the surgical line containing `id=<focusNodeId>`
 *  in the content, auto-scrolls to it and highlights it as active ("Show Code" flow). */
export function CodeViewer({
  file,
  focusNodeId,
  failedMembers,
  typingLine,
}: {
  file: GeneratedFile;
  focusNodeId?: string;
  /** Failed (violation/error) surgical members in this file — for danger painting. */
  failedMembers?: ReadonlySet<string>;
  /** Surgical fill live typewriter: blinking cursor on this line (0-based) + follow-scroll. */
  typingLine?: number | null;
}) {
  const language = prismLanguageFor(file.language);
  const segments = pathSegments(file.path);
  // ORIGIN-SPINE data: collapse each region's method body range (startLine..endLine) to a
  // single color axis (kind). spineKindByLine = EVERY line in the range → kind (continuous
  // band); markerSpanByLine = marker line → region (origin chip + card live here).
  const { spineKindByLine, markerSpanByLine } = useMemo(() => {
    const spine = new Map<number, RegionKind>();
    const marker = new Map<number, RegionSpan>();
    for (const r of regionSpans(file.content, failedMembers)) {
      for (let ln = r.startLine; ln <= r.endLine; ln++) spine.set(ln, r.kind);
      marker.set(r.line, r);
    }
    return { spineKindByLine: spine, markerSpanByLine: marker };
  }, [file.content, failedMembers]);
  // Active (cursor) line — clicked line is highlighted with gutter + line background.
  const [activeLine, setActiveLine] = useState<number | null>(null);
  // DOM ref for the focus line so it can be scrolled into view.
  const focusLineRef = useRef<HTMLDivElement | null>(null);
  // Typewriter cursor line — keep it visible as it gets written.
  const typingLineRef = useRef<HTMLDivElement | null>(null);

  // When the file (or focus node) changes, compute the focus line; null if not found.
  // Set active line to the focus line → gutter + line background highlight opens at focus.
  const focusLine =
    focusNodeId != null ? surgicalLineForNode(file.content, focusNodeId) : null;

  useEffect(() => {
    setActiveLine(focusLine);
  }, [file.path, focusLine]);

  // After the focus line is rendered, scroll it into view (smooth, centered).
  useEffect(() => {
    if (focusLine == null) return;
    const handle = requestAnimationFrame(() => {
      focusLineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(handle);
  }, [file.path, focusLine]);

  // Keep the cursor line visible as the typewriter writes (nearest → won't constantly recenter).
  useEffect(() => {
    if (typingLine == null) return;
    const h = requestAnimationFrame(() => {
      typingLineRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(h);
  }, [typingLine, file.content]);

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: EDITOR.bg }}>
      {/* Breadcrumb — path segments */}
      <div
        className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto px-3 font-mono text-[12.5px]"
        style={{ background: EDITOR.bg, borderBottom: `1px solid ${EDITOR.border}`, color: EDITOR.textMuted }}
      >
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          return (
            <span key={i} className="flex shrink-0 items-center gap-1">
              {i > 0 && <ChevronRight size={12} style={{ color: EDITOR.textFaint }} />}
              {isLast && <FileIcon name={file.path} language={file.language} size={13} />}
              <span style={{ color: isLast ? EDITOR.text : EDITOR.textMuted }}>{seg}</span>
            </span>
          );
        })}
      </div>

      {/* Editor body */}
      <div className="min-h-0 flex-1 overflow-auto" style={{ background: EDITOR.bg }}>
        <Highlight theme={solarchPrismTheme} code={file.content} language={language}>
          {({ className, style, tokens, getLineProps, getTokenProps }) => {
            const gutterWidth = Math.max(2, String(tokens.length).length) + 1; // ch
            return (
              <pre
                className={cn(className, "min-w-full py-2 font-mono text-[13.5px] leading-[1.6]")}
                style={{ ...style, background: "transparent", margin: 0 }}
              >
                {tokens.map((line, i) => {
                  // ORIGIN-SPINE: if this line is inside a region range, kind → color (continuous band).
                  const kind = spineKindByLine.get(i);
                  const prov = kind ? PROVENANCE[kind] : undefined;
                  const markerRegion = markerSpanByLine.get(i); // is this line the region's marker (chip + title)
                  const isActive = activeLine === i;
                  const lineProps = getLineProps({ line });
                  const isFocusLine = focusLine === i;
                  const isTypingLine = typingLine === i;
                  return (
                    <div
                      key={i}
                      {...lineProps}
                      ref={isFocusLine ? focusLineRef : isTypingLine ? typingLineRef : undefined}
                      onClick={() => setActiveLine(i)}
                      className={cn(lineProps.className, "group/line relative flex cursor-text")}
                      style={{
                        // Body lines carry ONLY the spine (left band) → calm; the title (marker)
                        // line is highlighted with its origin tint; typewriter purple; active line gray.
                        background: isTypingLine
                          ? PROVENANCE.human.bg
                          : markerRegion && prov
                            ? prov.bg
                            : isActive
                              ? EDITOR.activeLine
                              : undefined,
                      }}
                    >
                      {/* Gutter — line no + ORIGIN-SPINE band (left border). sticky + opaque bg →
                          fixed on horizontal scroll; origin tint layers over the opaque background. */}
                      <span
                        className="sticky left-0 z-[1] shrink-0 select-none border-r pr-3 pl-3 text-right tabular-nums"
                        style={{
                          width: `calc(${gutterWidth}ch + 1.5rem)`,
                          borderRight: `1px solid ${EDITOR.border}`,
                          borderLeft: `${prov ? 3 : 2}px solid ${prov ? prov.color : isActive ? EDITOR.accent : "transparent"}`,
                          color: markerRegion && prov ? prov.color : isActive ? EDITOR.text : EDITOR.textFaint,
                          background: markerRegion && prov
                            ? `linear-gradient(${prov.bg}, ${prov.bg}), ${EDITOR.bg}`
                            : isActive
                              ? `linear-gradient(${EDITOR.activeLine}, ${EDITOR.activeLine}), ${EDITOR.bg}`
                              : EDITOR.bg,
                        }}
                      >
                        {i + 1}
                      </span>
                      {/* Code */}
                      <span className="min-w-0 flex-1 whitespace-pre pl-4 pr-4">
                        {line.map((token, key) => {
                          const tokenProps = getTokenProps({ token });
                          return <span key={key} {...tokenProps} />;
                        })}
                        {/* ORIGIN LABEL — on the marker line, after the comment (inline). Who wrote it
                            (Constructor / Surgical AI / You / Pending / Unverified). NOT A PILL: Geist
                            status-dot + Zed inline-blame pattern — small dot + dimmed flat-colored label
                            (no capsule/border/background). "color is never the only signal" → color + label. */}
                        {markerRegion && prov && (
                          <span
                            title={prov.hint}
                            className="ml-3 inline-flex select-none items-center gap-1.5 align-middle font-sans text-[11px] font-medium uppercase tracking-[0.08em] opacity-80"
                            style={{ color: prov.color }}
                          >
                            <span className="h-[5px] w-[5px] rounded-full" style={{ background: prov.color }} />
                            {prov.label}
                          </span>
                        )}
                        {/* Typewriter cursor — blinks at the end of the line being written. */}
                        {isTypingLine && (
                          <span
                            className="ml-px inline-block w-[2px] animate-pulse align-middle"
                            style={{ height: "1.1em", background: PROVENANCE.human.color }}
                          />
                        )}
                      </span>
                    </div>
                  );
                })}
              </pre>
            );
          }}
        </Highlight>
      </div>
    </div>
  );
}
