/** EditorTabs — top tab bar for open files (VSCode editor tabs).
 *  Active tab merges with editor background + top accent line. Each tab has a close (x) button.
 *  Files containing surgical markers show a small dot. Lucide X + colored FileIcon. */

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GeneratedFile } from "../../api/codegen";
import { FileIcon } from "./FileIcon";
import { EDITOR } from "./theme";
import { baseName } from "./lib";

export function EditorTabs({
  openFiles,
  activePath,
  onSelect,
  onClose,
}: {
  openFiles: GeneratedFile[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex h-9 shrink-0 items-stretch overflow-x-auto"
      style={{ background: EDITOR.tabBar, borderBottom: `1px solid ${EDITOR.border}` }}
    >
      {openFiles.map((file) => {
        const isActive = file.path === activePath;
        return (
          // Wrapper: tab button + close button are siblings (no nested <button>).
          <div
            key={file.path}
            className={cn(
              "group relative flex shrink-0 items-stretch border-r text-[13.5px] transition-colors",
            )}
            style={{
              borderRight: `1px solid ${EDITOR.border}`,
              background: isActive ? EDITOR.tabActive : "transparent",
              color: isActive ? EDITOR.text : EDITOR.textMuted,
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.background = EDITOR.hover;
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.background = "transparent";
            }}
          >
            {/* Active tab top accent line */}
            {isActive && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[2px]"
                style={{ background: EDITOR.accent }}
              />
            )}
            {/* Tab itself: real <button> → focusable, Enter/Space work natively.
                Roving tabindex: only the active tab is in the Tab order. Arrow key navigation. */}
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelect(file.path)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const idx = openFiles.findIndex((f) => f.path === file.path);
                  const delta = e.key === "ArrowRight" ? 1 : -1;
                  const next = openFiles[(idx + delta + openFiles.length) % openFiles.length];
                  if (next) onSelect(next.path);
                }
              }}
              className={cn(
                "flex items-center gap-2 py-0 pl-3 pr-1 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ed-accent)]",
              )}
              style={{ color: "inherit" }}
              title={file.path}
            >
              <FileIcon name={file.path} language={file.language} size={14} />
              <span className="max-w-[180px] truncate font-mono">{baseName(file.path)}</span>
              {file.surgicalMarkers > 0 && (
                <span
                  aria-hidden
                  className="h-[6px] w-[6px] shrink-0 rounded-full"
                  style={{ background: EDITOR.surgical }}
                  title={`${file.surgicalMarkers} surgical edit points`}
                />
              )}
            </button>
            <button
              type="button"
              aria-label={`Close ${baseName(file.path)} tab`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(file.path);
              }}
              className={cn(
                "mr-2 inline-flex h-5 w-5 shrink-0 items-center justify-center self-center rounded transition-opacity",
                "focus-visible:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ed-accent)]",
                isActive ? "opacity-70" : "opacity-0 group-hover:opacity-70",
              )}
              style={{ color: EDITOR.text }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = EDITOR.hover;
                e.currentTarget.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.opacity = isActive ? "0.7" : "";
              }}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
