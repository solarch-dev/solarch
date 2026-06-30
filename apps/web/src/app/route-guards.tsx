import { useRouteError, Link } from "react-router-dom";
import type { ReactNode } from "react";

export function RequireAuth({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

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
