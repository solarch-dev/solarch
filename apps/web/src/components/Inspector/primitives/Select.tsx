import {
  Select as UiSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Option {
  value: string;
  label?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: readonly Option[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  /** "cell" → dense grid cell: borderless/transparent, hover affordance, compact. */
  density?: "default" | "cell";
}

/** Radix Select — popover content, keyboard nav, screen reader compatible.
 *  If value is not found, undefined is passed (Radix doesn't like empty strings → shows placeholder). */
export function Select({ value, onChange, options, placeholder, disabled, ariaLabel, className, density = "default" }: Props) {
  const hasCurrent = options.some((o) => o.value === value);
  const cell = density === "cell";

  return (
    <UiSelect
      value={hasCurrent ? value : undefined}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          cell
            ? "h-8 px-2 text-[13px] rounded border-transparent bg-transparent hover:bg-[var(--ins-overlay-hover)] focus:ring-1 focus:ring-[color:var(--ins-family-accent,var(--accent))]/30 focus:border-[color:var(--ins-family-accent,var(--accent))]"
            : "h-10 px-3.5 text-[15px] rounded-md border-[color:var(--hairline-strong)] hover:border-[color:var(--ink-faint)] focus:ring-2 focus:ring-[color:var(--ins-family-accent,var(--accent))]/25 focus:border-[color:var(--ins-family-accent,var(--accent))]",
          className
        )}
      >
        <SelectValue placeholder={placeholder ?? "select…"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="text-[14.5px] py-2">
            {opt.label ?? opt.value}
          </SelectItem>
        ))}
      </SelectContent>
    </UiSelect>
  );
}
