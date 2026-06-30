import { ChevronRight } from "lucide-react";
import { getFieldIcon } from "../../../lib/field-icons";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  /** Field key — for icon mapping (e.g. "Methods", "Pages", "Config"). Derived from label if not provided. */
  fieldKey?: string;
  count?: number;
  onClick: () => void;
  /** Backward compatibility: no longer used (always single state in subpage navigation pattern). */
  active?: boolean;
}

/** "Open detail" button inside the Behavior section — premium card visually aligned
 *  with docs sidebar item buttons. Semantic field icon + label + count pill on the left +
 *  chevron on the right. Separate icon per field (Methods → Code2, Pages → FileText, etc.) */
export function DrawerTrigger({ label, fieldKey, count, onClick }: Props) {
  const Icon = getFieldIcon(fieldKey ?? label);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group w-full flex items-center gap-3 pl-3 pr-3.5 py-3 rounded-lg text-left",
        "border border-[color:var(--hairline)] bg-[color:var(--paper-raised)]",
        "text-[color:var(--ink)] transition-all duration-150",
        "hover:border-[color:var(--ins-family-accent,var(--accent))]/40",
        "hover:bg-[color:color-mix(in_srgb,var(--ins-family-accent,var(--accent))_4%,var(--paper-raised))]",
        "hover:-translate-y-[1px] hover:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      )}
    >
      {/* Family-tinted icon box — field-specific lucide icon */}
      <span
        className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 border"
        style={{
          background: `color-mix(in srgb, var(--ins-family-accent, var(--accent)) 10%, transparent)`,
          borderColor: `color-mix(in srgb, var(--ins-family-accent, var(--accent)) 22%, transparent)`,
          color: `var(--ins-family-accent, var(--accent))`,
        }}
        aria-hidden
      >
        <Icon size={14} />
      </span>

      {/* Label + optional count */}
      <span className="flex-1 flex items-center gap-2 min-w-0">
        <span className="font-sans text-[14.5px] font-medium text-[color:var(--ink)] truncate">
          {label}
        </span>
        {count != null && (
          <span
            className={cn(
              "font-mono text-[11.5px] tabular-nums px-1.5 py-0.5 rounded-full shrink-0",
              "bg-[var(--ins-pill-bg)] text-[color:var(--ink-faint)]",
              "group-hover:bg-[color:color-mix(in_srgb,var(--ins-family-accent,var(--accent))_12%,transparent)]",
              "group-hover:text-[color:var(--ins-family-accent,var(--accent))]"
            )}
          >
            {count}
          </span>
        )}
      </span>

      {/* Chevron — direction indicator */}
      <ChevronRight
        size={15}
        className="shrink-0 text-[color:var(--ink-faint)] group-hover:text-[color:var(--ins-family-accent,var(--accent))] group-hover:translate-x-0.5 transition-all duration-150"
      />
    </button>
  );
}
