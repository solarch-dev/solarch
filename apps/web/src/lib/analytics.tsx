/** PostHog analytics — product analytics + lead funnel measurement.
 *  With no key (VITE_POSTHOG_PROJECT_TOKEN empty) fully disabled: init is not called,
 *  provider is passthrough — dev environment and forks are unaffected.
 *  defaults '2026-01-30' → automatic pageview on SPA route changes
 *  (history_change), autocapture, the full current recommendation set. */

import posthog from "posthog-js";
import { PostHogProvider, usePostHog } from "@posthog/react";
import { useEffect, type ReactNode } from "react";
import { useAuth, useUser } from "@clerk/clerk-react";
import { getGuestToken } from "./guest";
import { POSTHOG } from "./env";

const analyticsEnabled = POSTHOG.enabled;

if (analyticsEnabled) {
  posthog.init(POSTHOG.token!, {
    api_host: POSTHOG.host!,
    // SPA pageview (history_change) + current recommendations; the explicit values
    // below override defaults.
    defaults: "2026-01-30",
    // Restricted mode required by the privacy policy:
    persistence: "memory", // no cookies/localStorage — identity limited to tab lifetime
    person_profiles: "identified_only", // no profile for anonymous visitors
    disable_session_recording: true, // recording off by default
    autocapture: false, // no automatic click/form capture; pageview + explicit capture only
    respect_dnt: true, // respect the browser's Do-Not-Track
  });
}

/** Must be wrapped INSIDE ClerkProvider (identity binding uses Clerk hooks). */
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  if (!analyticsEnabled) return <>{children}</>;
  return (
    <PostHogProvider client={posthog}>
      <AnalyticsIdentity />
      {children}
    </PostHogProvider>
  );
}

/** Identity binding:
 *  - Clerk sign-in → identify (anonymous history produced while a guest is linked to the
 *    same person → the "guest → signup" conversion funnel is measured)
 *  - Sign-out → reset (so the next visitor in the same browser does not inherit the prior identity)
 *  - Guest → guest_mode super property (tags events without opening a person profile) */
function AnalyticsIdentity() {
  const ph = usePostHog();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    if (!ph || !isLoaded) return;
    if (isSignedIn && user) {
      ph.unregister("guest_mode");
      if (!ph._isIdentified()) {
        ph.identify(user.id, {
          email: user.primaryEmailAddress?.emailAddress,
          name: user.fullName ?? undefined,
        });
      }
    } else {
      if (ph._isIdentified()) ph.reset();
      if (getGuestToken()) ph.register({ guest_mode: true });
    }
  }, [ph, isLoaded, isSignedIn, user]);

  return null;
}
