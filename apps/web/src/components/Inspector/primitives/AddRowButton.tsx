import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  onClick: () => void;
  size?: "sm" | "md";
}

/** "+ label" dashed ghost button — "add" trigger for list container. */
export function AddRowButton({ label, onClick, size = "md" }: Props) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn(
        "w-full justify-center gap-[6px] rounded-[5px] font-sans font-medium",
        "border border-dashed border-[color:var(--hairline-strong)]",
        "text-[color:var(--ink-soft)] bg-transparent",
        "hover:border-[color:var(--ins-family-accent,var(--accent))] hover:text-[color:var(--ins-family-accent,var(--accent))]",
        "hover:bg-[color:color-mix(in_srgb,var(--ins-family-accent,var(--accent))_5%,transparent)]",
        size === "sm" ? "h-7 px-[10px] text-[12px]" : "h-8 px-3 text-[12.5px]"
      )}
    >
      <span className="text-[15px] leading-none font-normal">+</span> {label}
    </Button>
  );
}
