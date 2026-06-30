import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "idle" | "pending" | "success" | "error";

interface Props {
  status: Status;
  errorMessage?: string;
}

/** 500ms debounce save status — pending / success / error from a single place. */
export function SaveStatus({ status, errorMessage }: Props) {
  return (
    <div
      className={cn(
        "font-mono text-[11px] min-h-[14px] tracking-[0.02em] inline-flex items-center gap-1",
        status === "success" && "text-[color:var(--ok)]",
        status === "error" && "text-[color:var(--danger)]",
        (status === "idle" || status === "pending") && "text-[color:var(--ink-faint)]"
      )}
      data-status={status}
    >
      {status === "pending" && "saving…"}
      {status === "success" && (
        <>
          <Check size={11} strokeWidth={2.5} aria-hidden /> saved
        </>
      )}
      {status === "error" && <span>· error: {errorMessage ?? "try again"}</span>}
    </div>
  );
}
