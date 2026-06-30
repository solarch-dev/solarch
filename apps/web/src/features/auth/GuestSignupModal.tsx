/** GuestSignupModal — sign-up/sign-in modal shown when the guest limit (1 project) is hit.
 *  Lead conversion moment: "your drawing won't be lost, it moves to your account" promise + two CTAs.
 *  Closable via X (Radix Dialog's built-in close); the guest keeps drawing. */

import { useNavigate } from "react-router-dom";
import { ArrowRight, FolderPlus, Sparkles, Bot } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function PerkRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 font-mono text-[13px] text-[color:var(--ink-soft)]">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#ff6b1a]/10 text-[#ff6b1a]">
        {icon}
      </span>
      {children}
    </li>
  );
}

export function GuestSignupModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px] gap-0 overflow-hidden p-0 bg-[var(--paper-raised)]">
        {/* Terminal chrome — same language as the auth pages */}
        <div className="flex items-center gap-2 border-b border-[color:var(--hairline)] px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff6b1a]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--hairline-strong)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--hairline-strong)]" />
          <span className="ml-2 font-mono text-[12.5px] tracking-[0.02em] text-[color:var(--ink-faint)]">
            solarch@guest:~ limit
          </span>
        </div>

        <div className="p-6">
          <DialogHeader className="space-y-1.5 text-left sm:text-left">
            <DialogTitle className="font-sans text-[21px] font-semibold tracking-[-0.02em] text-[color:var(--ink)]">
              You're drawing as a guest
            </DialogTitle>
            <DialogDescription className="font-mono text-[13.5px] leading-relaxed text-[color:var(--ink-faint)]">
              // guest mode is limited to 1 project — create a free account to keep going
            </DialogDescription>
          </DialogHeader>

          <ul className="mt-5 space-y-2.5">
            <PerkRow icon={<Sparkles size={13} />}>Your current drawing moves to your account</PerkRow>
            <PerkRow icon={<FolderPlus size={13} />}>2 projects on the free plan</PerkRow>
            <PerkRow icon={<Bot size={13} />}>2x AI usage when you sign up</PerkRow>
          </ul>

          <div className="mt-6 space-y-2.5">
            <button
              type="button"
              onClick={() => navigate("/sign-up")}
              className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-[7px]
                         bg-[#ff6b1a] px-6 font-mono text-[15px] font-medium text-black
                         shadow-[0_1px_2px_rgba(217,77,0,0.28)] transition-all
                         hover:bg-[#d94d00] active:translate-y-px"
            >
              Create free account
              <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </button>
            <button
              type="button"
              onClick={() => navigate("/sign-in")}
              className="inline-flex h-11 w-full items-center justify-center rounded-[7px]
                         border border-[color:var(--hairline)] bg-[var(--paper)] px-6
                         font-mono text-[14px] text-[color:var(--ink)] transition-all
                         hover:border-[#ff6b1a]/40 hover:bg-[var(--paper-raised)] active:translate-y-px"
            >
              I already have an account — Sign in
            </button>
          </div>

          <p className="mt-4 text-center font-mono text-[12px] leading-relaxed text-[color:var(--ink-faint)]">
            Your guest drawing is kept and transferred after sign-up.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
