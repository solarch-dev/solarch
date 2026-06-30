import type { ReactNode } from "react";

/** 10px mono uppercase 0.08em — section heading / type label. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-eyebrow text-[color:var(--ink-faint)] font-semibold uppercase tracking-[0.08em]">
      {children}
    </span>
  );
}
