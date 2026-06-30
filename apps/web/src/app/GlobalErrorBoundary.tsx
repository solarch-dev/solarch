import { Component, type ErrorInfo, type ReactNode } from "react";

/** App-root render error boundary. The Router's errorElement ONLY catches loader/action
 *  errors; throws during component render crash the entire app to a white screen. This
 *  boundary (wraps RouterProvider) catches those and shows a simple recovery screen.
 *  Error catching in React 19 still requires a class component. Since this is OUTSIDE
 *  the Router context, Link/useNavigate are unavailable — recovery uses window.location. */
export class GlobalErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Single extension-point: in the future Sentry.captureException(error, { extra: info }).
    console.error("[solarch] uncaught render error:", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error.message || "Unknown error";
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center gap-3 p-6 font-mono text-sm">
        <div className="text-[color:var(--ink,#1b1b1a)]">// something went wrong</div>
        <div className="text-[color:var(--ink-faint,#94a3b8)] max-w-md text-center break-words">{message}</div>
        <div className="flex items-center gap-4">
          <button onClick={this.reset} className="underline text-[color:var(--accent,#FF8A3D)]">
            try again
          </button>
          <button onClick={() => location.reload()} className="underline text-[color:var(--ink-soft,#64748b)]">
            reload page
          </button>
        </div>
      </div>
    );
  }
}
