import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Props {
  label?: string;
  required?: boolean;
  badge?: string;
  helper?: ReactNode;
  layout?: "stack" | "row";
  children: ReactNode;
}

/** Label + required * + badge + content slot + helper.
 *  Modal-optimized form tipografisi: 13px label, 12.5px helper, ferah gap. */
export function Field({ label, required, badge, helper, layout = "stack", children }: Props) {
  return (
    <div
      className={cn(
        "flex",
        layout === "row"
          ? "flex-row items-center justify-between gap-4"
          : "flex-col gap-1.5"
      )}
    >
      {label && (
        <Label className="flex items-center gap-2 text-[14px] font-medium text-[color:var(--ink)] leading-tight">
          <span>{label}</span>
          {required && (
            <span
              className="text-[color:var(--danger)] font-semibold text-[14px] leading-none"
              aria-label="required"
            >
              *
            </span>
          )}
          {badge && (
            <span className="font-mono text-[11.5px] font-medium px-1.5 py-0.5 rounded bg-[color:var(--accent-wash)] text-[color:var(--accent-ink)] tracking-[0.02em]">
              {badge}
            </span>
          )}
        </Label>
      )}
      <div className={cn("flex flex-col", layout === "row" && "flex-shrink-0 min-w-0")}>{children}</div>
      {helper && (
        <div className="text-[13.5px] text-[color:var(--ink-soft)] leading-[1.55] mt-0.5">
          {helper}
        </div>
      )}
    </div>
  );
}
