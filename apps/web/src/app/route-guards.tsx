import { useRouteError, Link, useLocation } from "react-router-dom";
import { SignedIn, SignedOut, RedirectToSignIn, RedirectToTasks } from "@clerk/clerk-react";
import { useEffect, useState, type ReactNode } from "react";
import { ensureGuestToken, getGuestToken } from "../lib/guest";

/** Pages open only to registered users — not accessible with a guest ticket. */
const AUTH_ONLY_PATHS = new Set(["/billing"]);

/** Signed-in → app. Signed-out → get a guest ticket and continue as a
 *  single-project trial (lead flow); if no ticket (guest mode off) Clerk sign-in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  return (
    <>
      <SignedIn>
        <RedirectToTasks />
        {children}
      </SignedIn>
      <SignedOut>
        <GuestGate>{children}</GuestGate>
      </SignedOut>
    </>
  );
}

/** Visitor without login: guarantee the ticket, then open the app as a guest. */
function GuestGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [state, setState] = useState<"loading" | "guest" | "redirect">(
    getGuestToken() ? "guest" : "loading",
  );

  useEffect(() => {
    if (state !== "loading") return;
    let cancelled = false;
    void ensureGuestToken().then((token) => {
      if (!cancelled) setState(token ? "guest" : "redirect");
    });
    return () => {
      cancelled = true;
    };
  }, [state]);

  if (AUTH_ONLY_PATHS.has(pathname)) return <RedirectToSignIn />;
  if (state === "redirect") return <RedirectToSignIn />;
  if (state === "loading") return null; // ticket issuance ~one request, instant
  return <>{children}</>;
}

/** Minimal route error screen — prevents a single render error from crashing the whole app. */
export function RouteError() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : "Unknown error";
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center gap-3 p-6 font-mono text-sm">
      <div className="text-[color:var(--ink,#1b1b1a)]">// something went wrong</div>
      <div className="text-[color:var(--ink-faint,#94a3b8)] max-w-md text-center break-words">{message}</div>
      <Link to="/start" className="underline text-[color:var(--accent,#FF8A3D)]" onClick={() => location.reload()}>
        reload
      </Link>
    </div>
  );
}
