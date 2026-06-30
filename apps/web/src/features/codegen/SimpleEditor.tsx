/** SimpleEditor — the "Editor" sub-view of Code mode: FILE TREE on the left (FileTree, VSCode-style),
 *  EDITABLE code on the right (CodeEditor). No tabs/statusbar — minimal. Clicking a region in chat
 *  also switches here and selects that file (target). Edits flow up via `onEdit`
 *  (CodegenPanel override layer → also reflected in Download .zip). */

import { useEffect, useMemo, useState } from "react";
import { Code2, Eye } from "lucide-react";
import type { GeneratedFile } from "../../api/codegen";
import { CodeEditor } from "./CodeEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { FileTree } from "./FileTree";
import { buildFileTree, fileFillStatus, baseName, type FileFillStatus } from "./lib";
import { EDITOR } from "./theme";

export function SimpleEditor({
  files,
  failedByPath,
  target,
  onEdit,
}: {
  files: GeneratedFile[];
  failedByPath: Map<string, Set<string>>;
  /** Focus file coming from chat/Show-code (nodeId unused in v1; file selection is enough). */
  target: { path: string; nodeId?: string } | null;
  onEdit: (path: string, content: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(target?.path ?? files[0]?.path ?? null);
  // Top Raw ↔ Preview switch for markdown files (default: preview directly).
  const [mdView, setMdView] = useState<"raw" | "preview">("preview");

  // when target changes (chat region click / Show code), select that file.
  useEffect(() => {
    if (target?.path) setSelected(target.path);
  }, [target]);

  const tree = useMemo(() => buildFileTree(files), [files]);
  const fillStatusByPath = useMemo(() => {
    const m = new Map<string, FileFillStatus>();
    for (const f of files) if (f.surgicalMarkers > 0) m.set(f.path, fileFillStatus(f.content, failedByPath.get(f.path)));
    return m;
  }, [files, failedByPath]);

  const file = files.find((f) => f.path === selected) ?? null;

  return (
    <div className="flex min-h-0 flex-1" style={{ background: EDITOR.bg }}>
      {/* Left — file tree */}
      <aside className="w-[240px] shrink-0 overflow-hidden" style={{ borderRight: `1px solid ${EDITOR.border}` }}>
        <FileTree
          tree={tree}
          selectedPath={selected}
          fileCount={files.length}
          fillStatusByPath={fillStatusByPath}
          onSelect={(f) => setSelected(f.path)}
        />
      </aside>

      {/* Right — editable code; for markdown, TOP Raw ↔ Preview switch + rendered preview */}
      <div className="flex min-h-0 flex-1 flex-col">
        {!file ? (
          <div className="flex h-full items-center justify-center font-mono text-[13px]" style={{ color: EDITOR.textFaint }}>
            select a file from the left
          </div>
        ) : file.language === "markdown" ? (
          <>
            <div className="flex h-9 shrink-0 items-center gap-2 px-3" style={{ background: EDITOR.titleBar, borderBottom: `1px solid ${EDITOR.border}` }}>
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" style={{ color: EDITOR.textMuted }}>{baseName(file.path)}</span>
              <RawPreviewSwitch value={mdView} onChange={setMdView} />
            </div>
            <div className="min-h-0 flex-1">
              {mdView === "preview" ? (
                <MarkdownPreview content={file.content} />
              ) : (
                <CodeEditor key={file.path} file={file} onEdit={(content) => onEdit(file.path, content)} />
              )}
            </div>
          </>
        ) : (
          <CodeEditor key={file.path} file={file} onEdit={(content) => onEdit(file.path, content)} />
        )}
      </div>
    </div>
  );
}

/** Raw ↔ Preview segmented switch — in the markdown file's top strip. */
function RawPreviewSwitch({ value, onChange }: { value: "raw" | "preview"; onChange: (v: "raw" | "preview") => void }) {
  return (
    <div className="inline-flex items-center rounded-md p-0.5" style={{ background: EDITOR.subtle, border: `1px solid ${EDITOR.border}` }}>
      {([
        { v: "preview" as const, label: "Preview", icon: <Eye size={12} /> },
        { v: "raw" as const, label: "Raw", icon: <Code2 size={12} /> },
      ]).map(({ v, label, icon }) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={active}
            className="inline-flex h-6 items-center gap-1.5 rounded px-2.5 text-[12px] font-medium transition-colors"
            style={active ? { background: EDITOR.bg, color: EDITOR.text } : { color: EDITOR.textMuted }}
          >
            {icon}
            {label}
          </button>
        );
      })}
    </div>
  );
}
