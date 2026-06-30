import { useQuery, useMutation } from "@tanstack/react-query";
import { getClerkToken } from "./client";
import { guestHeaders } from "../lib/guest";

export type Plan = "guest" | "free" | "draw" | "build" | "code";

export interface BillingState {
  plan: Plan;
  status: string;
  entitlements: {
    canUseAI: boolean;
    canCodegen: boolean;
    /** Generate Code / ZIP export — Build and above. */
    canGenerateCode: boolean;
    projectCap: number;
  };
  /** 4-hour window caps (0 = disabled meter). codegen = Constructor
   *  "Generate Code" free preview (tiers without canGenerateCode get 1 per 4h). */
  meters: { generations: number; edits: number; questions: number; codegen: number };
  /** Usage in the active window. */
  usage: { generations: number; edits: number; questions: number; codegen?: number };
  /** End of the active 4h window (ISO) — "resets in Xh Ym" countdown. */
  windowResetAt: string;
  periodEnd: string | null;
  /** Trial end date (ISO) — only set while trialing (from Polar). */
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
}

async function getJSON<T>(path: string): Promise<T> {
  const token = await getClerkToken();
  const res = await fetch(`/api/v1${path}`, {
    credentials: "include",
    // Guests can read subscription status too (guest plan: 1 project, no AI).
    headers: token ? { Authorization: `Bearer ${token}` } : guestHeaders(),
  });
  const body = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(body?.error?.message ?? "Request failed"), { code: body?.error?.code });
  }
  return body.data as T;
}

export function useSubscription() {
  return useQuery({
    queryKey: ["subscription"],
    queryFn: () => getJSON<BillingState>("/billing/subscription"),
    staleTime: 30_000,
  });
}

export function useCheckout() {
  return useMutation({
    mutationFn: async (plan: Exclude<Plan, "free" | "guest">) => {
      const token = await getClerkToken();
      const res = await fetch("/api/v1/billing/checkout", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ plan, returnUrl: `${window.location.origin}/billing` }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(body?.error?.message ?? "Could not start checkout"), { code: body?.error?.code });
      }
      // Polar hosted-redirect: backend returns the Polar checkout session URL.
      return body.data as { url: string };
    },
  });
}

export async function openPortal() {
  const d = await getJSON<{ url: string | null }>("/billing/portal");
  if (d.url) window.location.assign(d.url);
}

/** Checkout success return — verify with Polar and persist the subscription; returns current state. */
export async function confirmCheckout(checkoutId: string): Promise<BillingState> {
  const token = await getClerkToken();
  const res = await fetch("/api/v1/billing/checkout/confirm", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ checkoutId }),
  });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body?.error?.message ?? "Could not confirm purchase"), { code: body?.error?.code });
  return body.data as BillingState;
}
