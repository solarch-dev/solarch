/** Surgical AI handoff — shown after the in-app fill completes.
 *
 *  In-app fill now runs server-side tsc (and optional jest) — verified when the deps
 *  cache is available, otherwise a strong contract-checked draft. Either way the
 *  CONTINUOUS workflow (drift guard / watch / editor codelens) lives in the local dev
 *  tools: this panel teaches the three paths (CLI / VS Code / MCP) + the code-sync loop,
 *  as copy-able commands + CTAs. Purely presentational. */

import { useState } from "react";
import { Terminal, Boxes, Plug, Check, Copy, Download, ArrowRight, RefreshCw } from "lucide-react";
import { EDITOR, PROVENANCE } from "./theme";

type Tab = "cli" | "vscode" | "mcp";

function CopyCmd({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(cmd).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="group flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-[13px] transition-colors"
      style={{ background: EDITOR.subtle, color: EDITOR.text, border: `1px solid ${EDITOR.border}` }}
      title="Copy command"
    >
      <span className="truncate"><span style={{ color: EDITOR.textMuted }}>$ </span>{cmd}</span>
      {copied ? <Check size={13} style={{ color: EDITOR.surgicalDone }} /> : <Copy size={13} style={{ color: EDITOR.textMuted }} className="opacity-0 transition-opacity group-hover:opacity-100" />}
    </button>
  );
}

const TABS: { id: Tab; label: string; icon: typeof Terminal }[] = [
  { id: "cli", label: "CLI", icon: Terminal },
  { id: "vscode", label: "VS Code", icon: Boxes },
  { id: "mcp", label: "MCP", icon: Plug },
];

export function SurgicalHandoff({
  filled,
  total,
  violations,
  verified = false,
  withTests = false,
  tscClean,
  onDownload,
  zipping,
}: {
  filled: number;
  total: number;
  violations: number;
  /** Did tsc run on the server (deps cache present) → verified; otherwise a draft. */
  verified?: boolean;
  /** Was jest "deep verify" enabled. */
  withTests?: boolean;
  /** Is the last tsc gate clean (when verified). */
  tscClean?: boolean;
  onDownload: () => void;
  zipping: boolean;
}) {
  const [tab, setTab] = useState<Tab>("cli");

  return (
    <div
      className="flex flex-col gap-3 p-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
      style={{ background: EDITOR.titleBar, borderTop: `1px solid ${EDITOR.border}` }}
    >
      {/* Header — result + download the draft */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md" style={{ background: PROVENANCE.ai.bg, color: PROVENANCE.ai.color }}>
          <Check size={15} strokeWidth={2.5} />
        </span>
        <div className="mr-auto">
          <div className="font-sans text-[14px] font-semibold" style={{ color: EDITOR.text }}>
            Surgical AI filled {filled}/{total} regions
          </div>
          <div className="font-mono text-[12px]" style={{ color: EDITOR.textMuted }}>
            {verified ? (
              <>
                {tscClean === false ? (
                  <>Verified with <b>tsc</b>{withTests ? " + jest" : ""} — a few residual type errors remain; the CLI repair loop or your editor closes them.</>
                ) : (
                  <>Verified — compiles with <b>tsc</b>{withTests ? " + passes jest" : ""}. Keep it <b>in sync</b> with your editor below.</>
                )}
              </>
            ) : (
              <>Strong draft (grounded + contract-checked). Ship it <b>verified</b> (tsc + jest) via the local tools and keep it <b>in sync</b> with your editor below.</>
            )}
            {violations > 0 ? ` · ${violations} region(s) need a manual pass.` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={onDownload}
          disabled={zipping}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold text-black transition-colors disabled:opacity-60"
          style={{ background: EDITOR.accent }}
        >
          <Download size={14} /> Download .zip
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors"
              style={{
                background: active ? EDITOR.subtle : "transparent",
                color: active ? EDITOR.text : EDITOR.textMuted,
                border: `1px solid ${active ? EDITOR.border : "transparent"}`,
              }}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab body */}
      {tab === "cli" && (
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-[12px]" style={{ color: EDITOR.textMuted }}>
            Unzip the project, then in its folder run the verified fill (real tsc + jest gates) and keep it synced:
          </p>
          <CopyCmd cmd="npm i -g @solarch/cli" />
          <CopyCmd cmd="solarch init" />
          <CopyCmd cmd="solarch fill --all --with-tests" />
          <CopyCmd cmd="solarch watch" />
          <p className="font-mono text-[11.5px]" style={{ color: EDITOR.textMuted }}>
            <code>fill --with-tests</code> verifies each body against a generated jest spec; <code>watch</code> guards drift between the diagram and the code.
          </p>
        </div>
      )}

      {tab === "vscode" && (
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-[12px]" style={{ color: EDITOR.textMuted }}>
            Install the Solarch extension — fill regions, see drift, and live-bind the diagram to your code inside the editor:
          </p>
          <CopyCmd cmd="code --install-extension solarch.solarch-vscode" />
          <a
            href="https://marketplace.visualstudio.com/items?itemName=solarch.solarch-vscode"
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors"
            style={{ background: EDITOR.subtle, color: EDITOR.text, border: `1px solid ${EDITOR.border}` }}
          >
            Open in Marketplace <ArrowRight size={13} />
          </a>
          <p className="font-mono text-[11.5px]" style={{ color: EDITOR.textMuted }}>
            The extension surfaces every <code>@solarch:surgical</code> region as a codelens and runs the same verified fill.
          </p>
        </div>
      )}

      {tab === "mcp" && (
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-[12px]" style={{ color: EDITOR.textMuted }}>
            Wire Solarch into Claude / Cursor — the agent can fill regions via the <code>fill_surgical_region</code> tool. Add to your MCP config:
          </p>
          <CopyCmd cmd='{ "solarch": { "command": "npx", "args": ["-y", "@solarch/mcp"] } }' />
          <p className="font-mono text-[11.5px]" style={{ color: EDITOR.textMuted }}>
            Set <code>DEEPSEEK_API_KEY</code> in the server env; the tool runs the same contract-aware fill locally.
          </p>
        </div>
      )}

      {/* Code sync footer */}
      <div className="mt-1 flex items-start gap-2 rounded-md px-3 py-2" style={{ background: EDITOR.accentWash, border: `1px solid ${EDITOR.border}` }}>
        <RefreshCw size={14} style={{ color: EDITOR.accent, marginTop: 1 }} />
        <div className="font-mono text-[12px]" style={{ color: EDITOR.textMuted }}>
          <b style={{ color: EDITOR.text }}>Code sync:</b> <code>solarch pull</code> pulls diagram changes into your code; <code>solarch watch</code> flags drift when code and diagram diverge — so your architecture stays the single source of truth.
        </div>
      </div>
    </div>
  );
}
