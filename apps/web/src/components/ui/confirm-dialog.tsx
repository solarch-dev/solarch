/** In-app confirm dialog — Radix Dialog based replacement for native window.confirm.
 *  Imperative API: const confirm = useConfirm(); const ok = await confirm({ title, message }); */

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, Check } from "lucide-react";
import { Z_LAYERS } from "../../lib/z-layers";
import { cn } from "@/lib/utils";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" = red confirm button (delete etc.); default = brand-colored */
  variant?: "default" | "danger";
}

type ConfirmContext = (options: ConfirmOptions) => Promise<boolean>;

const Ctx = createContext<ConfirmContext | null>(null);

/** Imperative confirm — Promise<boolean>. Must be used under ConfirmProvider. */
export function useConfirm(): ConfirmContext {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fallback: use native browser confirm if no provider
    return (opts) =>
      Promise.resolve(window.confirm(`${opts.title}\n\n${opts.description ?? ""}`));
  }
  return ctx;
}

interface PendingState {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);

  const confirm = useCallback<ConfirmContext>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ options, resolve });
    });
  }, []);

  const handleClose = (ok: boolean) => {
    if (pending) {
      pending.resolve(ok);
      setPending(null);
    }
  };

  const o = pending?.options;
  const isDanger = o?.variant === "danger";

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <DialogPrimitive.Root
        open={!!pending}
        onOpenChange={(v) => { if (!v) handleClose(false); }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              "fixed inset-0 bg-[rgba(11,16,32,0.55)] backdrop-blur-sm",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
              "duration-200",
            )}
            style={{ zIndex: Z_LAYERS.POPOVER + 5 }}
          />
          <DialogPrimitive.Content
            onEscapeKeyDown={(e) => { e.preventDefault(); handleClose(false); }}
            className={cn(
              "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
              "w-[min(440px,92vw)] flex flex-col overflow-hidden",
              "rounded-xl border border-border bg-[color:var(--paper-raised)]",
              "shadow-[0_24px_80px_-20px_rgba(11,16,32,0.40)]",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
              "duration-150 focus:outline-none",
            )}
            style={{ zIndex: Z_LAYERS.POPOVER + 6 }}
          >
            {o && (
              <>
                <div className="flex items-start gap-3 px-6 pt-6 pb-2">
                  <span
                    className={cn(
                      "w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border",
                      isDanger
                        ? "bg-[color:var(--danger)]/10 border-[color:var(--danger)]/25 text-[color:var(--danger)]"
                        : "bg-brand-500/10 border-brand-500/25 text-brand-500",
                    )}
                  >
                    {isDanger ? <AlertTriangle size={17} /> : <Check size={17} />}
                  </span>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <DialogPrimitive.Title className="font-sans text-[16.5px] font-semibold text-[color:var(--ink)] leading-tight">
                      {o.title}
                    </DialogPrimitive.Title>
                    {o.description && (
                      <DialogPrimitive.Description className="mt-1.5 text-[14.5px] text-[color:var(--ink-soft)] leading-[1.55]">
                        {o.description}
                      </DialogPrimitive.Description>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 px-6 py-4 mt-2 bg-[color:var(--paper)] border-t border-[color:var(--hairline)]">
                  <button
                    type="button"
                    onClick={() => handleClose(false)}
                    className="inline-flex items-center h-9 px-3.5 rounded-md text-[14px] font-medium text-[color:var(--ink-soft)] hover:bg-[rgba(22,29,40,0.06)] hover:text-[color:var(--ink)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {o.cancelLabel ?? "Cancel"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleClose(true)}
                    autoFocus
                    className={cn(
                      "inline-flex items-center h-9 px-4 rounded-md text-[14px] font-semibold text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isDanger
                        ? "bg-[color:var(--danger)] hover:opacity-90"
                        : "bg-brand-500 hover:bg-brand-600",
                    )}
                  >
                    {o.confirmLabel ?? "Confirm"}
                  </button>
                </div>
              </>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </Ctx.Provider>
  );
}
