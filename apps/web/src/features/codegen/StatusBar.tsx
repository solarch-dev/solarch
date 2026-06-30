/** StatusBar — VSCode-style bottom status bar.
 *  Left: active file language, line count, surgical areas. Right: total files + skipped nodes.
 *  VSCode signature blue background. Lucide icons + mono text. */

import { Scissors, Files, GitBranch, MinusCircle } from "lucide-react";
import type { GeneratedFile } from "../../api/codegen";
import { EDITOR, languageLabel } from "./theme";

export function StatusBar({
  file,
  fileCount,
  totalSurgical,
  skippedTotal,
  skippedTitle,
}: {
  file: GeneratedFile | undefined;
  fileCount: number;
  totalSurgical: number;
  skippedTotal: number;
  skippedTitle: string;
}) {
  const lineCount = file ? file.content.split("\n").length : 0;

  return (
    <div
      className="flex h-[24px] shrink-0 items-center gap-0 px-0 text-[12px] font-medium"
      style={{ background: EDITOR.statusBar, color: EDITOR.textMuted, borderTop: `1px solid ${EDITOR.border}` }}
    >
      {/* Left group */}
      <Item icon={<GitBranch size={12} />} label="nestjs" />
      {file && <Item label={languageLabel(file.language)} />}
      {file && <Item label={`${lineCount} lines`} />}
      {totalSurgical > 0 && (
        <Item
          icon={<Scissors size={12} />}
          label={`${totalSurgical} surgical areas`}
        />
      )}

      <div className="flex-1" />

      {/* Right group */}
      {skippedTotal > 0 && (
        <Item
          icon={<MinusCircle size={12} />}
          label={`${skippedTotal} nodes skipped`}
          title={skippedTitle}
        />
      )}
      <Item icon={<Files size={12} />} label={`${fileCount} files`} />
    </div>
  );
}

function Item({
  icon,
  label,
  title,
}: {
  icon?: React.ReactNode;
  label: string;
  title?: string;
}) {
  return (
    <span
      className="inline-flex h-full items-center gap-1.5 px-2.5 font-mono tabular-nums transition-colors hover:bg-[var(--ed-hover)]"
      title={title}
    >
      {icon}
      {label}
    </span>
  );
}
