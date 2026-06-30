/** Auth split-screen shell:
 *  LEFT — flat orange (#ff6b1a) background + black (#0f0f0e) text, solarch-landing footer language
 *  (CRT scanline + mono terminal + ASCII node diagram). RIGHT — light form (unchanged). */

import { Check } from "lucide-react";
import type { ReactNode } from "react";

const SCANLINES = "repeating-linear-gradient(to bottom, rgba(0,0,0,0.05) 0 1px, transparent 1px 3px)";

const ASCII = `┌───────────┐
│Controller │
└─────┬─────┘
      │ calls
      ▼
┌───────────┐
│  Service  │
└─────┬─────┘
      │ queries
      ▼
┌───────────┐
│  orders   │
└───────────┘`;

function Prompt() {
  return <span className="text-[#0f0f0e]/55">solarch@architecture:~$ </span>;
}

function Wordmark({
  className = "", dot = "text-[#ff6b1a]", logoPx = 28, black = false,
}: { className?: string; dot?: string; logoPx?: number; black?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-mono font-bold tracking-[-0.02em] ${className}`}>
      <img
        src="/logo.svg"
        alt=""
        aria-hidden
        style={{ width: logoPx, height: logoPx, ...(black ? { filter: "brightness(0)" } : null) }}
      />
      <span>Solarch<span className={dot}>.</span></span>
    </span>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-[var(--paper)]">
      {/* LEFT — flat orange brand panel */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-[#0f0f0e]/15 bg-[#ff6b1a] p-12 text-[#0f0f0e] lg:flex">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-50" style={{ backgroundImage: SCANLINES }} />

        {/* top: wordmark + tagline */}
        <div className="relative flex items-center justify-between gap-4 border-b border-[#0f0f0e]/15 pb-6">
          <Wordmark className="text-[35px] text-[#0f0f0e]" dot="text-[#0f0f0e]/70" logoPx={34} black />
          <span className="font-mono text-[12px] uppercase tracking-[0.16em] text-[#0f0f0e]/65">
            draw it · ship it
          </span>
        </div>

        {/* middle: slogan + terminal */}
        <div className="relative">
          <h2 className="max-w-md font-sans text-[31px] font-semibold leading-[1.12] tracking-[-0.02em] text-[#0f0f0e]">
            Architecture that's <span className="text-white">verified</span>, not guessed.
          </h2>

          <div className="mt-8 font-mono text-[14px] leading-[1.85] text-[#0f0f0e]">
            <div><Prompt />whoami</div>
            <div className="pl-4">→ AI suggests · rules validate · only correct graphs ship</div>
            <div className="mt-4"><Prompt />cat status</div>
            <div className="flex items-center gap-1.5 pl-4"><Check size={12} strokeWidth={2.5} aria-hidden /> rules engine online</div>
            <div className="flex items-center gap-1.5 pl-4"><Check size={12} strokeWidth={2.5} aria-hidden /> 8 node families · 16 semantic edges</div>
            <div className="mt-4 flex items-center">
              <Prompt />
              <span className="ml-0.5 inline-block h-[1.05em] w-[0.55em] translate-y-[1px] bg-[#0f0f0e] motion-safe:animate-pulse" />
            </div>
          </div>
        </div>

        {/* bottom: ASCII diagram */}
        <pre className="relative self-start overflow-x-auto font-mono text-[12.5px] leading-[1.4] text-[#0f0f0e]/80">
          {ASCII}
        </pre>
      </aside>

      {/* RIGHT — form panel (unchanged) */}
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[400px] animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="mb-7 flex justify-center lg:hidden">
            <Wordmark className="text-[27px] text-[color:var(--ink)]" logoPx={26} />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
