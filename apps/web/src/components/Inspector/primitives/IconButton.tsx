import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Tone = "default" | "danger" | "accent";

interface Props {
  onClick: () => void;
  title?: string;
  ariaLabel?: string;
  tone?: Tone;
  disabled?: boolean;
  size?: "sm" | "md";
  children: ReactNode;
}

/** Ghost icon button — shadcn Button variant=ghost + Solarch toning. */
export function IconButton({
  onClick, title, ariaLabel, tone = "default", disabled, size = "md", children,
}: Props) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      disabled={disabled}
      className={cn(
        // Solarch baseline: 22×22 (md) or 20×20 (sm), compact
        size === "md" ? "h-[22px] w-[22px]" : "h-5 w-5",
        "p-0 rounded-[4px] text-[14px] font-sans shrink-0",
        "text-[color:var(--ink-soft)] hover:bg-[var(--ins-overlay-hover)] hover:text-[color:var(--ink)]",
        "disabled:opacity-30 disabled:cursor-not-allowed",
        tone === "danger" && "hover:bg-[rgba(194,55,31,0.10)] hover:text-[color:var(--danger)]",
        tone === "accent" && "hover:bg-[color:color-mix(in_srgb,var(--ins-family-accent,var(--accent))_12%,transparent)] hover:text-[color:var(--ins-family-accent,var(--accent))]"
      )}
    >
      {children}
    </Button>
  );
}
