import type { ReactNode, CSSProperties, RefObject } from "react";
import { X } from "lucide-react";
import { NodeIcon } from "../../../lib/node-icons";

interface Props {
  family: string;
  familyColor: string;
  typeLabel: string;
  typeName: string;
  title: string;
  description?: string;
  onClose: () => void;
  saveStatus?: ReactNode;
  dangerZone?: ReactNode;
  bodyRef?: RefObject<HTMLDivElement | null>;
  /** Additional header actions shown to the left of the close button (e.g. "Show Code"). */
  headerActions?: ReactNode;
  children: ReactNode;
}

/** Sidebar inspector wrapper for all 21 types.
 *  Minimalist: family color only remains as a subtle hint in the icon glyph;
 *  4px family bar and icon box tints were removed. */
export function InspectorShell({
  family, familyColor, typeLabel, typeName, title, description,
  onClose, saveStatus, dangerZone, bodyRef, headerActions, children,
}: Props) {
  const styleVars = { "--ins-family-accent": familyColor } as CSSProperties;

  return (
    <section
      aria-label="Node Inspector"
      data-family={family}
      style={styleVars}
      className="flex flex-col min-h-0 h-full overflow-hidden bg-[color:var(--paper-raised)] relative"
    >
      {/* Header — spacious modal padding + large typography */}
      <header className="flex items-start gap-4 px-7 pt-6 pb-4 shrink-0 border-b border-[color:var(--hairline)]">
        {/* Neutral icon box — 44x44, hairline border; color hint only in icon glyph */}
        <div
          className="w-11 h-11 flex items-center justify-center rounded-lg shrink-0 border border-[color:var(--hairline)] bg-[color:var(--paper)]"
          aria-hidden="true"
        >
          <NodeIcon type={typeName} size={20} color={familyColor} />
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="font-mono text-[11.5px] text-[color:var(--ink-faint)] font-medium uppercase tracking-[0.08em]">
            {typeLabel} · {typeName}
          </div>
          <div className="font-sans text-[19px] font-semibold text-[color:var(--ink)] leading-[1.2] break-words">
            {title}
          </div>
          {description && (
            <p className="text-[13.5px] text-[color:var(--ink-soft)] leading-[1.45] mt-1">
              {description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {headerActions}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close (Esc)"
            title="Close (Esc)"
            className="w-8 h-8 flex items-center justify-center border-0 bg-transparent text-[color:var(--ink-soft)] rounded-md shrink-0 transition-colors hover:bg-[var(--ins-overlay-hover)] hover:text-[color:var(--ink)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Body — spacious padding, wide area, scroll */}
      <div
        ref={bodyRef}
        className="flex-1 overflow-y-auto px-7 pt-5 pb-7 flex flex-col gap-5"
      >
        {children}
      </div>

      {saveStatus && (
        <div className="px-7 py-3 border-t border-[color:var(--hairline)] shrink-0 bg-[color:var(--paper)]">
          {saveStatus}
        </div>
      )}

      {dangerZone && (
        <div className="px-7 py-3 border-t border-dashed border-[color:var(--hairline)] shrink-0">
          {dangerZone}
        </div>
      )}
    </section>
  );
}
