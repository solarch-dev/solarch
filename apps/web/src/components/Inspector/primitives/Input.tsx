import type { ChangeEvent, InputHTMLAttributes } from "react";
import { Input as UiInput } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Variant = "text" | "mono" | "number";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> {
  value: string | number;
  onChange: (value: string) => void;
  variant?: Variant;
  type?: "text" | "url" | "email" | "date" | "datetime-local" | "color" | "number";
  /** "cell" → dense grid cell: borderless/transparent, editability signal on hover, ring on focus. */
  density?: "default" | "cell";
}

/** shadcn Input overridden to Solarch dimensions.
 *  variant=mono → JetBrains Mono. variant=number → type=number. density=cell → compact grid cell. */
export function Input({ value, onChange, variant = "text", type, density = "default", className, ...rest }: Props) {
  const finalType = type ?? (variant === "number" ? "number" : "text");
  const cell = density === "cell";

  return (
    <UiInput
      {...rest}
      type={finalType}
      value={value as string | number}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      className={cn(
        cell
          ? // Dense cell: 32px, borderless+transparent, hover bg = "click here to edit" affordance
            "h-8 px-2 text-[13px] rounded border-transparent bg-transparent cursor-text hover:bg-[var(--ins-overlay-hover)] focus-visible:bg-[color:var(--ins-card-sunken)] focus-visible:border-[color:var(--ins-family-accent,var(--accent))] focus-visible:ring-1 focus-visible:ring-[color:var(--ins-family-accent,var(--accent))]/30 focus-visible:ring-offset-0"
          : // Modal-optimized form input: 40px
            "h-10 px-3.5 py-2 text-[15px] rounded-md border-[color:var(--hairline-strong)] hover:border-[color:var(--ink-faint)] focus-visible:border-[color:var(--ins-family-accent,var(--accent))] focus-visible:ring-2 focus-visible:ring-[color:var(--ins-family-accent,var(--accent))]/25 focus-visible:ring-offset-0",
        "placeholder:text-[color:var(--ink-faint)]",
        variant === "mono" && (cell ? "font-mono tracking-[-0.01em]" : "font-mono text-[14px] tracking-[-0.01em]"),
        className
      )}
    />
  );
}
