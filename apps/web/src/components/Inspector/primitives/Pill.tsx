import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export type PillTone = "neutral" | "accent" | "family" | "success" | "warn" | "danger";

const pillVariants = cva(
  [
    "inline-flex items-center gap-1 h-[22px] px-[9px] rounded-full",
    "font-mono text-[11px] font-semibold uppercase tracking-[0.04em] whitespace-nowrap select-none",
    "border transition-colors",
  ],
  {
    variants: {
      tone: {
        neutral: "border-[color:var(--hairline-strong)] text-[color:var(--ink-soft)] bg-transparent",
        accent:  "border-[color:color-mix(in_srgb,var(--accent)_32%,transparent)] text-[color:var(--ink-soft)] bg-transparent",
        family:  "border-[color:color-mix(in_srgb,var(--ins-family-accent,var(--accent))_32%,transparent)] text-[color:var(--ins-family-accent,var(--accent))] bg-[color:color-mix(in_srgb,var(--ins-family-accent,var(--accent))_8%,transparent)]",
        success: "border-[color:var(--ok-border)] text-[color:var(--ok)] bg-[color:var(--ok-wash)]",
        warn:    "border-[color:var(--warn-border)] text-[color:var(--warn)] bg-[color:var(--warn-wash)]",
        danger:  "border-[color:var(--danger-border)] text-[color:var(--danger)] bg-[color:var(--danger-wash)]",
      },
      interactive: { true: "cursor-pointer", false: "cursor-default" },
      active: { true: "", false: "" },
    },
    compoundVariants: [
      { interactive: true, active: false, className: "hover:border-[color:var(--ink-soft)] hover:text-[color:var(--ink)]" },
      { tone: "accent", active: true, className: "bg-[color:var(--accent)] border-[color:var(--accent)] text-black" },
      { tone: "family", active: true, className: "bg-[color:var(--ins-family-accent,var(--accent))] border-[color:var(--ins-family-accent,var(--accent))] text-white" },
      { tone: "neutral", active: true, className: "bg-[var(--ins-pill-bg)] border-[color:var(--hairline-strong)] text-[color:var(--ink)]" },
      { tone: "danger", active: true, className: "bg-[color:var(--danger)] border-[color:var(--danger)] text-white" },
    ],
    defaultVariants: { tone: "neutral", interactive: false, active: false },
  }
);

/** HTTP method & visibility preset classes — applied via variant attr. */
const PRESET_CLASSES: Record<string, string> = {
  "http-get":      "bg-[color:var(--http-get-wash)] border-[color:var(--http-get-border)] text-[color:var(--http-get)]",
  "http-post":     "bg-[color:var(--http-post-wash)] border-[color:var(--http-post-border)] text-[color:var(--http-post)]",
  "http-put":      "bg-[color:var(--http-put-wash)] border-[color:var(--http-put-border)] text-[color:var(--http-put)]",
  "http-delete":   "bg-[color:var(--http-delete-wash)] border-[color:var(--http-delete-border)] text-[color:var(--http-delete)]",
  "http-patch":    "bg-[color:var(--http-patch-wash)] border-[color:var(--http-patch-border)] text-[color:var(--http-patch)]",
  "vis-public":    "text-[color:var(--ok)] border-[color:var(--ok-border)] bg-[color:var(--ok-wash)]",
  "vis-private":   "text-[color:var(--danger)] border-[color:var(--danger-border)] bg-[color:var(--danger-wash)]",
  "vis-protected": "text-[color:var(--warn)] border-[color:var(--warn-border)] bg-[color:var(--warn-wash)]",
};

interface Props extends VariantProps<typeof pillVariants> {
  variant?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}

export function Pill({ tone, variant, active, interactive, onClick, disabled, title, children }: Props) {
  const preset = variant ? PRESET_CLASSES[variant] : undefined;
  const className = cn(pillVariants({ tone, interactive, active }), preset);

  if (interactive) {
    return (
      <button
        type="button"
        className={className}
        title={title}
        onClick={onClick}
        disabled={disabled}
        aria-pressed={active ?? false}
      >
        {children}
      </button>
    );
  }

  return <span className={className} title={title}>{children}</span>;
}
