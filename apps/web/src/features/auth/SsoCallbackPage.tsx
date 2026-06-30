import { AuthenticateWithRedirectCallback } from "@clerk/clerk-react";
import { AuthShell } from "./AuthShell";
import { TerminalChrome } from "./auth-ui";
import { AUTH_COMPLETE_PATH } from "./oauth-flow";

/** OAuth redirect handler — Clerk completes sign-in/sign-up then navigates away. */
export function SsoCallbackPage() {
  return (
    <AuthShell>
      <div className="overflow-hidden rounded-[12px] border border-[color:var(--hairline)] bg-[var(--paper-raised)] shadow-[var(--shadow-card)]">
        <TerminalChrome label="solarch@auth:~ oauth-callback" />
        <div className="p-6 sm:p-7 text-center">
          <p className="font-mono text-[14px] text-[color:var(--ink-faint)] animate-pulse">
            // finishing sign-in…
          </p>
          <AuthenticateWithRedirectCallback
            signInUrl="/sign-in"
            signUpUrl="/sign-up"
            continueSignUpUrl="/sign-up"
            signInFallbackRedirectUrl={AUTH_COMPLETE_PATH}
            signUpFallbackRedirectUrl={AUTH_COMPLETE_PATH}
          />
          <div id="clerk-captcha" className="mt-4" />
        </div>
      </div>
    </AuthShell>
  );
}
