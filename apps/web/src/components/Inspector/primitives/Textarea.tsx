import type { ChangeEvent, TextareaHTMLAttributes } from "react";
import { Textarea as UiTextarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  variant?: "text" | "mono";
  rows?: number;
}

export function Textarea({ value, onChange, variant = "text", rows = 3, className, ...rest }: Props) {
  return (
    <UiTextarea
      {...rest}
      rows={rows}
      value={value}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
      className={cn(
        "min-h-[96px] px-3.5 py-2.5 text-[15px] rounded-md resize-y leading-[1.55]",
        "border-[color:var(--hairline-strong)] hover:border-[color:var(--ink-faint)]",
        "focus-visible:border-[color:var(--ins-family-accent,var(--accent))]",
        "focus-visible:ring-2 focus-visible:ring-[color:var(--ins-family-accent,var(--accent))]/25 focus-visible:ring-offset-0",
        "placeholder:text-[color:var(--ink-faint)]",
        variant === "mono" && "font-mono text-[14px] tracking-[-0.01em]",
        className
      )}
    />
  );
}
