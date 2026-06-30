import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  variant?: "inline" | "boxed";
}

/** Empty list hint — boxed (dashed border) or inline (mono mute). */
export function EmptyHint({ children, variant = "boxed" }: Props) {
  return (
    <div
      className={cn(
        "font-mono text-[11.5px] text-[color:var(--ink-faint)] tracking-[0.02em]",
        variant === "boxed" && "px-3 py-[10px] text-center border border-dashed border-[color:var(--hairline)] rounded-[5px]"
      )}
    >
      {children}
    </div>
  );
}
