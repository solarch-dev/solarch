/** Shared primitives for auth screens — Solarch blueprint aesthetics
 *  (ivory background, orange accent, JetBrains Mono labels, terminal motif). */

import type { ReactNode } from "react";

/** Terminal header: three dots + mono label. */
export function TerminalChrome({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-[color:var(--hairline)] px-4 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff6b1a]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--hairline-strong)]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--hairline-strong)]" />
      <span className="ml-2 font-mono text-[12.5px] tracking-[0.02em] text-[color:var(--ink-faint)]">{label}</span>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
  autoComplete?: string;
  inputMode?: "text" | "numeric";
  maxLength?: number;
}

export function AuthField({
  label, value, onChange, type = "text", placeholder, autoFocus, autoComplete, inputMode, maxLength,
}: FieldProps) {
  return (
    <label className="block">
      <span className="font-mono text-[11.5px] font-medium uppercase tracking-[0.14em] text-[color:var(--ink-faint)]">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        spellCheck={false}
        className="mt-1.5 w-full rounded-[7px] border border-[color:var(--hairline)] bg-[var(--paper)] px-3.5 py-2.5
                   font-mono text-[15px] text-[color:var(--ink)] outline-none transition-all
                   placeholder:text-[color:var(--ink-faint)]
                   focus:border-[#ff6b1a] focus:bg-[var(--paper-raised)] focus:ring-2 focus:ring-[#ff6b1a]/15"
      />
    </label>
  );
}

export function AuthButton({
  children, loading, type = "submit", onClick,
}: { children: ReactNode; loading?: boolean; type?: "submit" | "button"; onClick?: () => void }) {
  return (
    <button
      type={type}
      disabled={loading}
      onClick={onClick}
      className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-[7px]
                 bg-[#ff6b1a] px-6 font-mono text-[15px] font-medium text-black
                 shadow-[0_1px_2px_rgba(217,77,0,0.28)] transition-all
                 hover:bg-[#d94d00] active:translate-y-px disabled:cursor-wait disabled:opacity-60"
    >
      {loading ? (
        <span className="inline-block animate-pulse">working…</span>
      ) : (
        <>
          {children}
          <span className="transition-transform group-hover:translate-x-0.5">{"->"}</span>
        </>
      )}
    </button>
  );
}

const TERMS_URL = "https://www.solarch.dev/terms";
const PRIVACY_URL = "https://www.solarch.dev/privacy";

const legalLinkClass =
  "text-[#ff6b1a] underline-offset-2 hover:underline";

/** Checkbox label with links to Solarch Terms and Privacy. */
export function LegalAcceptLabel() {
  return (
    <span className="font-mono text-[12.5px] leading-relaxed text-[color:var(--ink-soft)]">
      I accept the{" "}
      <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className={legalLinkClass}>
        Terms of Service
      </a>{" "}
      and{" "}
      <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className={legalLinkClass}>
        Privacy Policy
      </a>
      .
    </span>
  );
}

/** Implied-consent note under OAuth buttons — continuing with a provider counts
 *  as accepting the terms (standard sign-in-wrap; no checkbox needed for OAuth). */
export function OAuthLegalNote() {
  return (
    <p className="text-center font-mono text-[12px] leading-relaxed text-[color:var(--ink-faint)]">
      By continuing with Google or GitHub, you agree to the{" "}
      <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className={legalLinkClass}>
        Terms of Service
      </a>{" "}
      and{" "}
      <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className={legalLinkClass}>
        Privacy Policy
      </a>
      .
    </p>
  );
}

/** Divider between OAuth and email/password forms. */
export function AuthDivider({ label = "or continue with email" }: { label?: string }) {
  return (
    <div className="relative py-1">
      <div className="absolute inset-0 flex items-center" aria-hidden>
        <div className="w-full border-t border-[color:var(--hairline)]" />
      </div>
      <p className="relative mx-auto w-fit bg-[var(--paper-raised)] px-3 font-mono text-[12px] text-[color:var(--ink-faint)]">
        {label}
      </p>
    </div>
  );
}

export function AuthError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      className="rounded-[7px] px-3.5 py-2.5 font-mono text-[13.5px] leading-snug"
      style={{ background: "rgba(194,55,31,0.06)", border: "1px solid rgba(194,55,31,0.28)", color: "var(--danger)" }}
      role="alert"
    >
      {message}
    </div>
  );
}
