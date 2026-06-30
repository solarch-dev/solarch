import { Switch as UiSwitch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

/** Radix Switch — family-accent on (--ins-family-accent), gri off. */
export function Switch({ checked, onChange, ariaLabel, disabled }: Props) {
  return (
    <UiSwitch
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "h-[22px] w-[38px] data-[state=checked]:bg-[color:var(--ins-family-accent,var(--accent))]",
        "data-[state=unchecked]:bg-[var(--ins-track-off)]"
      )}
    />
  );
}
