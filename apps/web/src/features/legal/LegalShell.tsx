/* In-app legal page shell (Terms / Refund / Privacy) — public, no login required.
 * Same aesthetic as solarch-landing legal pages (LP palette). NOTE: not legal advice. */

import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";

const LP_PALETTE: CSSProperties = {
  ["--lp-paper" as string]: "#fbfaf7",
  ["--lp-ink" as string]: "#0f0f0e",
  ["--lp-ink-soft" as string]: "#4a4845",
  ["--lp-ink-faint" as string]: "#8a8784",
  ["--lp-accent" as string]: "#ff6b1a",
  ["--lp-hairline" as string]: "rgba(15, 15, 14, 0.08)",
};

export function LegalShell({
  title,
  updated,
  summary,
  children,
}: {
  title: string;
  updated: string;
  summary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      style={LP_PALETTE}
      className="min-h-screen w-full overflow-y-auto bg-[var(--lp-paper)] px-5 pb-24 pt-16 sm:px-8 sm:pt-20"
    >
      <div className="mx-auto max-w-3xl">
        <Link
          to="/start"
          className="font-mono text-[13px] text-[var(--lp-ink-faint)] underline-offset-4 transition-colors hover:text-[var(--lp-ink)] hover:underline"
        >
          {"<-"} Solarch
        </Link>

        <div className="mt-8 font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--lp-ink-faint)]">// legal</div>
        <h1 className="mt-3 font-sans text-[clamp(28px,5vw,42px)] font-bold tracking-[-0.02em] text-[var(--lp-ink)]">
          {title}
        </h1>
        <p className="mt-3 font-mono text-[13.5px] text-[var(--lp-ink-faint)]">Last updated: {updated}</p>

        {summary && <p className="mt-6 text-[16px] leading-[1.75] text-[var(--lp-ink-soft)]">{summary}</p>}

        <div className="mt-12 space-y-10">{children}</div>

        <div className="mt-16 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--lp-hairline)] pt-6 font-mono text-[13px] text-[var(--lp-ink-faint)]">
          <Link to="/terms" className="transition-colors hover:text-[var(--lp-accent)]">Terms</Link>
          <Link to="/refund" className="transition-colors hover:text-[var(--lp-accent)]">Refund</Link>
          <Link to="/privacy" className="transition-colors hover:text-[var(--lp-accent)]">Privacy</Link>
          <a href="mailto:legal@solarch.dev" className="transition-colors hover:text-[var(--lp-accent)]">legal@solarch.dev</a>
        </div>
      </div>
    </div>
  );
}

export function Section({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className="scroll-mt-24">
      <h2 className="flex items-baseline gap-3 font-sans text-[20px] font-semibold tracking-[-0.01em] text-[var(--lp-ink)]">
        <span className="font-mono text-[14px] font-medium text-[var(--lp-accent)]">{n}</span>
        <span>{title}</span>
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return (
    <p className="text-[16px] leading-[1.75] text-[var(--lp-ink-soft)] [&_a]:text-[var(--lp-accent)] [&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-semibold [&_strong]:text-[var(--lp-ink)]">
      {children}
    </p>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-[16px] leading-[1.7] text-[var(--lp-ink-soft)] [&_a]:text-[var(--lp-accent)] [&_a]:underline [&_strong]:font-semibold [&_strong]:text-[var(--lp-ink)]">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}
