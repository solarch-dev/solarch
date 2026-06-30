/** Moves the guest drawing into the account after sign-up/sign-in (final step of lead conversion).
 *  When signed in and a guest ticket exists in localStorage, POST /projects/claim-guest
 *  is called; on success the ticket is cleared, the project list is refreshed, and the user is
 *  taken to the moved project. An invalid ticket is cleared silently. */

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getClerkToken } from "../../api/client";
import { clearGuestToken, getGuestToken } from "../../lib/guest";
import type { ProjectSummary } from "../../api/projects";

export function useClaimGuestProject(): void {
  const { isLoaded, isSignedIn } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const attempted = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || attempted.current) return;
    const guestToken = getGuestToken();
    if (!guestToken) return;
    attempted.current = true;

    void (async () => {
      try {
        const bearer = await getClerkToken();
        const res = await fetch("/api/v1/projects/claim-guest", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          },
          body: JSON.stringify({ token: guestToken }),
        });
        const body = (await res.json().catch(() => null)) as {
          data?: { projects?: ProjectSummary[] };
          error?: { code?: string };
        } | null;

        if (res.ok) {
          clearGuestToken();
          const claimed = body?.data?.projects ?? [];
          if (claimed.length > 0) {
            await qc.invalidateQueries({ queryKey: ["projects"] });
            toast.success("Your guest drawing was added to your account.");
            navigate(`/p/${claimed[0].id}`, { replace: true });
          }
          return;
        }
        // 402: the user's own limit is full — clear the ticket and break the loop; the drawing
        // stays in the backend for its TTL, the user can't free up space and retry, but
        // that's better than an infinite toast/redirect loop.
        clearGuestToken();
        if (res.status === 402) {
          toast.error("Project limit reached", {
            description: "Your guest drawing could not be transferred. Upgrade or delete a project.",
          });
        }
      } catch {
        attempted.current = false; // network error — retry on the next render
      }
    })();
  }, [isLoaded, isSignedIn, qc, navigate]);
}
