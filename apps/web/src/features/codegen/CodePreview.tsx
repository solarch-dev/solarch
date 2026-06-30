/** CodePreview — MINIMAL read-only code preview that slides in from the right (the "code" surface of chat-primary).
 *
 *  No full IDE chrome (no FileTree/EditorTabs/StatusBar) — only a thin title strip
 *  (file name + close) + standalone <CodeViewer> (syntax color + provenance spine preserved). Clicking
 *  a region/file in the chat makes CodegenPanel slide this in from the right; ✕ closes it.
 *
 *  Region focus: focusNodeId → CodeViewer scrolls + highlights the relevant surgical line (lib.surgicalLineForNode). */

import { X } from "lucide-react";
import type { GeneratedFile } from "../../api/codegen";
import { CodeViewer } from "./CodeViewer";
import { FileIcon } from "./FileIcon";
import { EDITOR } from "./theme";

export function CodePreview({
  file,
  nodeId,
  failedMembers,
  onClose,
}: {
  file: GeneratedFile;
  /** Node UUID of the region to focus — if absent, shown from the top of the file. */
  nodeId?: string;
  failedMembers?: ReadonlySet<string>;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: EDITOR.bg }}>
      {/* Thin title strip — file name + close (no tab/statusbar/explorer) */}
      <header
        className="flex h-9 shrink-0 items-center gap-2 px-3"
        style={{ background: EDITOR.titleBar, borderBottom: `1px solid ${EDITOR.border}` }}
      >
        <FileIcon name={file.path} language={file.language} size={14} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]" style={{ color: EDITOR.text }}>
          {file.path}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          title="Close (Esc)"
          className="inline-flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-[var(--ed-hover)]"
          style={{ color: EDITOR.textMuted }}
        >
          <X size={15} />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <CodeViewer file={file} focusNodeId={nodeId} failedMembers={failedMembers} typingLine={undefined} />
      </div>
    </div>
  );
}
