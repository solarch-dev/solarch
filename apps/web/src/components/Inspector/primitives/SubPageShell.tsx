/** SubPageShell — "page within a page" wrapper inside EditorModal.
 *  Replaced the vaul bottom drawer: covers the modal, spacious header
 *  (← Back + title + Save) + tabs (optional) + scroll body. */

import type { ReactNode } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface Props {
  /** "Methods", "Endpoints", "Columns" vb. */
  title: string;
  /** Subtitle — usually the node name: "UserService" */
  subtitle?: string;
  tabs?: readonly Tab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  onBack: () => void;
  /** Save button — closes subpage when pressed + optional async flush. */
  onSave: () => void | Promise<void>;
  /** Save button disabled (while pending) */
  saveDisabled?: boolean;
  /** Status text like "saving…" / "saved ✓" / error */
  saveStatusText?: string;
  saveStatusTone?: "idle" | "pending" | "success" | "error";
  children: ReactNode;
}

export function SubPageShell({
  title, subtitle,
  tabs, activeTab, onTabChange,
  onBack, onSave, saveDisabled,
  saveStatusText, saveStatusTone = "idle",
  children,
}: Props) {
  return (
    <section
      aria-label={`${title} editor`}
      className="flex flex-col min-h-0 h-full overflow-hidden bg-[color:var(--paper-raised)] relative animate-in fade-in slide-in-from-right-2 duration-200"
    >
      {/* Header: ← Back + title/subtitle + tabs + Save */}
      <header className="flex items-center gap-4 px-7 py-4 shrink-0 border-b border-[color:var(--hairline)]">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          title="Back (Esc)"
          className="inline-flex items-center gap-1.5 h-9 px-3 -ml-2 rounded-md text-[13.5px] font-medium text-[color:var(--ink-soft)] hover:bg-[var(--ins-overlay-hover)] hover:text-[color:var(--ink)] transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ArrowLeft size={14} />
          <span>Back</span>
        </button>

        <div className="flex flex-col min-w-0 flex-1">
          {subtitle && (
            <div className="font-mono text-[11.5px] uppercase tracking-[0.12em] text-[color:var(--ink-faint)] font-medium truncate">
              {subtitle}
            </div>
          )}
          <div className="font-sans text-[17px] font-semibold text-[color:var(--ink)] leading-[1.2] truncate">
            {title}
          </div>
        </div>

        {tabs && tabs.length > 0 && (
          <div className="flex items-center gap-0.5 p-0.5 bg-[var(--ins-track)] rounded-md" role="tablist">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onTabChange?.(tab.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 h-7 px-3 rounded text-[12.5px] font-medium transition-colors",
                    isActive
                      ? "bg-[color:var(--ins-tab-active)] text-[color:var(--ink)] shadow-[var(--ins-tab-shadow)]"
                      : "text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
                  )}
                >
                  <span>{tab.label}</span>
                  {tab.count != null && (
                    <span
                      className={cn(
                        "text-[11px] px-1.5 rounded-full",
                        isActive ? "bg-[var(--ins-pill-bg)] text-[color:var(--ink-soft)]" : "bg-[var(--ins-overlay-hover)] text-[color:var(--ink-faint)]"
                      )}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-3 shrink-0">
          {saveStatusText && (
            <span
              className={cn(
                "text-[12px] font-mono",
                saveStatusTone === "pending" && "text-[color:var(--ink-faint)] animate-pulse",
                saveStatusTone === "success" && "text-[color:var(--ok,_#16a34a)]",
                saveStatusTone === "error" && "text-[color:var(--danger,_#dc2626)]",
              )}
            >
              {saveStatusText}
            </span>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={saveDisabled}
            className={cn(
              "inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-[13.5px] font-semibold transition-all duration-150",
              "bg-brand-500 text-black shadow-sm hover:bg-brand-600 hover:shadow",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-500"
            )}
          >
            <Check size={14} />
            <span>Save</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-7 pt-5 pb-7 flex flex-col gap-5">
        {children}
      </div>
    </section>
  );
}
