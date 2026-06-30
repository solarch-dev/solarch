/** Codegen left EXPLORER — folder-hierarchy tree of generated files (VSCode style).
 *  Dark sidebar background; folder chevron (expand/collapse) + indent guide lines +
 *  file-type colored badge (FileIcon). Top header with project name + file count.
 *  Files with surgicalMarkers>0 show a small amber dot. */

import { useState } from "react";
import { ChevronRight, ChevronDown, Folder, FolderOpen, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GeneratedFile } from "../../api/codegen";
import { allFolderPaths, type FileFillStatus, type TreeNode } from "./lib";
import { FileIcon } from "./FileIcon";
import { EDITOR } from "./theme";

export function FileTree({
  tree,
  selectedPath,
  fileCount,
  fillStatusByPath,
  onSelect,
}: {
  tree: TreeNode[];
  selectedPath: string | null;
  fileCount: number;
  /** path → surgical fill state; badge (green check = done / amber = pending / danger = failed). */
  fillStatusByPath?: Map<string, FileFillStatus>;
  onSelect: (file: GeneratedFile) => void;
}) {
  // Default: all folders open (most readable feel for small projects).
  const [open, setOpen] = useState<Set<string>>(() => new Set(allFolderPaths(tree)));

  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="flex h-full flex-col" style={{ background: EDITOR.sidebar }}>
      {/* Explorer header — project name + file count */}
      <div
        className="flex shrink-0 items-center justify-between px-3 py-2"
        style={{ borderBottom: `1px solid ${EDITOR.border}` }}
      >
        <span
          className="truncate font-mono text-[11.5px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: EDITOR.textMuted }}
        >
          Solarch · NestJS
        </span>
        {/* File count — not a pill, just a plain dimmed number (Linear sidebar-count pattern). */}
        <span
          className="shrink-0 font-mono text-[11.5px] tabular-nums"
          style={{ color: EDITOR.textFaint }}
          title={`${fileCount} files`}
        >
          {fileCount}
        </span>
      </div>

      {/* Tree */}
      <div className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[13.5px] leading-relaxed">
        {tree.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            open={open}
            onToggle={toggle}
            selectedPath={selectedPath}
            fillStatusByPath={fillStatusByPath}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  open,
  onToggle,
  selectedPath,
  fillStatusByPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  open: Set<string>;
  onToggle: (path: string) => void;
  selectedPath: string | null;
  fillStatusByPath?: Map<string, FileFillStatus>;
  onSelect: (file: GeneratedFile) => void;
}) {
  const basePad = 10;
  const step = 12;
  const indent = basePad + depth * step;

  // Indent guide lines — VSCode signature vertical hairlines.
  const guides = Array.from({ length: depth }, (_, i) => (
    <span
      key={i}
      aria-hidden
      className="pointer-events-none absolute top-0 bottom-0 w-px"
      style={{ left: basePad + i * step + 6, background: EDITOR.indentGuide }}
    />
  ));

  // Folder
  if (!node.file) {
    const isOpen = open.has(node.path);
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          style={{ paddingLeft: indent }}
          className={cn(
            "group relative flex w-full items-center gap-1.5 py-[3px] pr-2 text-left transition-colors",
          )}
          onMouseEnter={(e) => (e.currentTarget.style.background = EDITOR.hover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          {guides}
          {isOpen ? (
            <ChevronDown size={13} className="shrink-0" style={{ color: EDITOR.textMuted }} />
          ) : (
            <ChevronRight size={13} className="shrink-0" style={{ color: EDITOR.textMuted }} />
          )}
          {isOpen ? (
            <FolderOpen size={14} className="shrink-0" style={{ color: EDITOR.accent }} />
          ) : (
            <Folder size={14} className="shrink-0" style={{ color: EDITOR.textMuted }} />
          )}
          <span className="truncate" style={{ color: EDITOR.text }}>
            {node.name}
          </span>
        </button>
        {isOpen &&
          node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              open={open}
              onToggle={onToggle}
              selectedPath={selectedPath}
              fillStatusByPath={fillStatusByPath}
              onSelect={onSelect}
            />
          ))}
      </div>
    );
  }

  // File — space instead of chevron (alignment), then icon.
  const file = node.file;
  const isSelected = selectedPath === file.path;
  return (
    <button
      type="button"
      onClick={() => onSelect(file)}
      style={{
        paddingLeft: indent + 16,
        background: isSelected ? EDITOR.selected : "transparent",
      }}
      className={cn("group relative flex w-full items-center gap-1.5 py-[3px] pr-2 text-left transition-colors")}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = EDITOR.hover;
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = "transparent";
      }}
      title={file.path}
    >
      {guides}
      <FileIcon name={file.path} language={file.language} size={15} />
      <span
        className="truncate"
        style={{ color: isSelected ? EDITOR.accent : EDITOR.text }}
      >
        {node.name}
      </span>
      {(() => {
        // Surgical fill badge: ALL filled → green check; any failed → danger dot;
        // otherwise (pending/partial) → amber dot. Counts live in the tooltip (calm look).
        const st = fillStatusByPath?.get(file.path);
        const total = st?.total ?? file.surgicalMarkers;
        if (!total || total <= 0) return null;
        const failed = st?.failed ?? 0;
        const done = st?.done ?? 0;
        if (failed > 0) {
          return (
            <span
              className="ml-auto inline-flex shrink-0 items-center"
              title={`${failed}/${total} surgical region(s) failed — still NOT_IMPLEMENTED`}
            >
              <span className="h-[6px] w-[6px] rounded-full" style={{ background: EDITOR.surgicalFailed }} />
            </span>
          );
        }
        if (done === total) {
          return (
            <span className="ml-auto inline-flex shrink-0 items-center" title={`All ${total} surgical region(s) filled`}>
              <Check size={13} style={{ color: EDITOR.surgicalDone }} />
            </span>
          );
        }
        return (
          <span
            className="ml-auto inline-flex shrink-0 items-center"
            title={done > 0 ? `${done}/${total} surgical region(s) filled` : `${total} surgical edit point(s)`}
          >
            <span className="h-[6px] w-[6px] rounded-full" style={{ background: EDITOR.surgical }} />
          </span>
        );
      })()}
    </button>
  );
}
