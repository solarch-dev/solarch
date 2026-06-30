import { cn } from "@/lib/utils";

interface Props {
  label: string;
  count?: number;
  /** true: hairline on top + extra top spacing (group separator within forms) */
  divider?: boolean;
}

/** Group heading in inspector forms — Behavior, Structure, etc.
 *  Not a mono eyebrow; a real sans-serif heading (15px semibold).
 *  Premium visual weight: hard for users to skip reading. */
export function SectionHeader({ label, count, divider }: Props) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-2.5 pb-2.5",
        divider && "border-t border-[color:var(--hairline)] pt-5 mt-3"
      )}
    >
      <h3 className="font-sans text-[15px] font-semibold tracking-tight text-[color:var(--ink)] leading-[1.2]">
        {label}
      </h3>
      {count != null && (
        <span className="font-mono text-[12px] tabular-nums bg-[var(--ins-pill-bg)] px-1.5 py-0.5 rounded text-[color:var(--ink-faint)]">
          {count}
        </span>
      )}
    </div>
  );
}
