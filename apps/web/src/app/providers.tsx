import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
} from "@tanstack/react-query";
import { ClerkProvider } from "@clerk/clerk-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { ApiError } from "../api/client";
import { clearGuestToken, getGuestToken } from "../lib/guest";
import { AnalyticsProvider } from "../lib/analytics";
import { CLERK_PUBLISHABLE_KEY } from "../lib/env";
import { useTheme } from "../state/theme";
import { ThemeController } from "./ThemeController";

/** Skins Clerk to Solarch's look (feels like our own screens) — theme-aware.
 *  Applied to all SignIn/SignUp/UserButton/OrganizationSwitcher. */
function buildClerkAppearance(dark: boolean) {
  const cardBorder = dark ? "rgba(255,255,255,0.08)" : "rgba(15,15,14,0.08)";
  const popShadow = dark ? "0_8px_30px_rgba(0,0,0,0.6)" : "0_8px_30px_rgba(11,16,32,0.12)";
  return {
    variables: {
      colorPrimary: "#ff6b1a",
      colorText: dark ? "#e3e3e7" : "#0f0f0e",
      colorTextSecondary: dark ? "#a8abb3" : "#5b6675",
      // In dark, DERIVED neutral text/icon/border should be LIGHT (default black → panel
      // kept showing "black text"). This flips all of Clerk's neutral tones.
      colorNeutral: dark ? "#ffffff" : "#0f0f0e",
      // Text on orange primary button = black (both themes; never white on orange).
      colorTextOnPrimaryBackground: "#141414",
      colorBackground: dark ? "#20232b" : "#ffffff",
      colorInputBackground: dark ? "#16181d" : "#fafaf7",
      colorInputText: dark ? "#e3e3e7" : "#0f0f0e",
      fontFamily: '"Satoshi", system-ui, sans-serif',
      fontFamilyButtons: '"JetBrains Mono", ui-monospace, monospace',
      borderRadius: "0.5rem",
    },
    elements: {
      card: `shadow-sm border border-[${cardBorder}]`,
      userButtonPopoverCard: `border border-[${cardBorder}] shadow-[${popShadow}]`,
      organizationSwitcherPopoverCard: `border border-[${cardBorder}] shadow-[${popShadow}]`,
      formButtonPrimary: "font-mono",
      headerSubtitle: "font-mono",
    },
  } as const;
}

const codeOf = (err: unknown): string | undefined =>
  err instanceof ApiError ? err.code : (err as { code?: string } | null)?.code;

// Single redirect on 401/402; when concurrent queries throw 401, only one signOut/redirect fires.
let redirecting = false;

/** Is the active client a guest? (no Clerk user + guest token present) */
function isGuestClient(): boolean {
  const clerk = (window as unknown as { Clerk?: { user?: unknown } }).Clerk;
  return !clerk?.user && !!getGuestToken();
}

/** Auth/plan redirect. Runs on both query and mutation errors (no toast).
 *  Returns true if a redirect was performed. */
function handleAuthRedirect(err: unknown): boolean {
  const code = codeOf(err);
  if (code === "ERR_UNAUTHORIZED") {
    if (redirecting || window.location.pathname === "/sign-in") return true;
    redirecting = true;
    // Guest token invalid/expired → drop it, /start mints a new one
    // (Clerk signOut unnecessary; no session anyway). LOOP BREAKER: a second
    // guest 401 within a short window (401 even with a fresh token = persistent
    // issue) falls through to sign-in instead of an endless /start↔reset loop.
    if (isGuestClient()) {
      clearGuestToken();
      let lastReset = 0;
      try {
        lastReset = Number(sessionStorage.getItem("solarch:guest-reset") ?? 0);
        sessionStorage.setItem("solarch:guest-reset", String(Date.now()));
      } catch { /* no storage */ }
      window.location.assign(Date.now() - lastReset < 60_000 ? "/sign-in" : "/start");
      return true;
    }
    // Stale/expired session: also sign out of Clerk → client+backend stay in sync,
    // clean sign-in screen appears (otherwise "already signed in" loop).
    const clerk = (window as unknown as { Clerk?: { signOut?: () => Promise<unknown> } }).Clerk;
    if (clerk?.signOut) {
      void clerk.signOut().finally(() => window.location.assign("/sign-in"));
    } else {
      window.location.assign("/sign-in");
    }
    return true;
  }
  // All plan-permission denials redirect to /billing (including ERR_PLAN_CODEGEN;
  // future ERR_PLAN_* codes are automatically covered). Codegen 402 (stale entitlement /
  // race) falls through here; this is the contract promised by codegen.ts & CodegenPanel.tsx comments.
  // For guests, a plan limit = sign-up CTA → /sign-up instead of /billing.
  if (code?.startsWith("ERR_PLAN_")) {
    if (isGuestClient()) {
      window.location.assign("/sign-up");
      return true;
    }
    if (window.location.pathname !== "/billing") window.location.assign("/billing");
    return true;
  }
  return false;
}

/** ONLY for mutation (write) errors: auth redirect + visible toast.
 *  Query (read) errors are NOT toasted (background refetches should not bother the user). */
function handleMutationError(err: unknown) {
  if (handleAuthRedirect(err)) return;
  const code = codeOf(err);
  // Codes silently handled by the component itself (prevents double-toast / unnecessary warnings).
  if (code === "ERR_VERSION_CONFLICT" || code === "ERR_EDGE_DUPLICATE") return;
  const message = err instanceof ApiError ? err.message : "An error occurred";
  const suggestion = err instanceof ApiError ? err.suggestion : undefined;
  // Rules Engine denial (core value): message + suggestion description.
  const isRule = code === "ERR_RULES_DENIED" || code === "ERR_NOT_WHITELISTED" || /^ERR_(00[1-7]|COND_00[12])$/.test(code ?? "");
  if (isRule) toast.error(message, { description: suggestion });
  else toast.error("An error occurred", { description: message });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      // Don't retry on auth/not-found (avoids unnecessary 3x + redirect delay/noise).
      retry: (count, error) => {
        const c = codeOf(error);
        if (
          c === "ERR_UNAUTHORIZED" ||
          c === "ERR_NODE_NOT_FOUND" ||
          c === "ERR_PROJECT_NOT_FOUND" ||
          c === "ERR_PROJECT_FORBIDDEN"
        )
          return false;
        return count < 2;
      },
    },
  },
  // Query errors: auth/plan redirect only (no toast). Mutation: redirect + toast.
  queryCache: new QueryCache({ onError: handleAuthRedirect }),
  mutationCache: new MutationCache({ onError: handleMutationError }),
});

export function AppProviders({ children }: { children: ReactNode }) {
  const resolved = useTheme((s) => s.resolved);
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY ?? ""}
      // signInUrl/signUpUrl → RedirectToSignIn and all Clerk links go to our
      // /sign-in /sign-up routes; won't redirect to clerk.accounts.dev.
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignOutUrl="/sign-in"
      appearance={buildClerkAppearance(resolved === "dark")}
    >
      <AnalyticsProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeController />
          {children}
        </QueryClientProvider>
      </AnalyticsProvider>
    </ClerkProvider>
  );
}
