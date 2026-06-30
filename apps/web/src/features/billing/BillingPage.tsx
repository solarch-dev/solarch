import { useEffect, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSubscription, useCheckout, openPortal, confirmCheckout, type Plan } from "../../api/billing";
import { AsciiCardFx } from "./AsciiCardFx";
import { useTheme } from "../../state/theme";

/* Plan & Billing — pixel-for-pixel identical to solarch-landing's pricing-section.
 * The landing's color values (different from frontend tokens: accent #ff6b1a vs
 * #ff8a3d) are carried via scoped CSS vars. Theme-aware: since inline style
 * overrides the stylesheet, the component picks the light/dark palette (per resolved). */

const LP_PALETTE_LIGHT: CSSProperties = {
  ["--lp-paper" as string]: "#fbfaf7",
  ["--lp-paper-raised" as string]: "#ffffff",
  ["--lp-ink" as string]: "#0f0f0e",
  ["--lp-ink-soft" as string]: "#4a4845",
  ["--lp-ink-faint" as string]: "#8a8784",
  ["--lp-accent" as string]: "#ff6b1a",
  ["--lp-accent-hover" as string]: "#d94d00",
  ["--lp-accent-wash" as string]: "rgba(255, 107, 26, 0.08)",
  ["--lp-on-accent" as string]: "#141414",
  ["--lp-hairline" as string]: "rgba(15, 15, 14, 0.08)",
  ["--lp-hairline-strong" as string]: "rgba(15, 15, 14, 0.18)",
  ["--lp-hover" as string]: "rgba(15, 15, 14, 0.04)",
  ["--lp-shadow-card" as string]: "0 1px 2px rgba(11,16,32,0.04), 0 6px 16px -8px rgba(11,16,32,0.14)",
  ["--lp-shadow-float" as string]: "0 12px 32px -10px rgba(11,16,32,0.20)",
};

const LP_PALETTE_DARK: CSSProperties = {
  ["--lp-paper" as string]: "#0e0e10",
  ["--lp-paper-raised" as string]: "#18181b",
  ["--lp-ink" as string]: "#e4e4e7",
  ["--lp-ink-soft" as string]: "#a1a1aa",
  ["--lp-ink-faint" as string]: "#71717a",
  ["--lp-accent" as string]: "#ff8a3d",
  ["--lp-accent-hover" as string]: "#ff9a52",
  ["--lp-accent-wash" as string]: "rgba(255, 138, 61, 0.12)",
  ["--lp-on-accent" as string]: "#141414",
  ["--lp-hairline" as string]: "rgba(255, 255, 255, 0.08)",
  ["--lp-hairline-strong" as string]: "rgba(255, 255, 255, 0.14)",
  ["--lp-hover" as string]: "rgba(255, 255, 255, 0.06)",
  ["--lp-shadow-card" as string]: "0 1px 2px rgba(0,0,0,0.4), 0 6px 16px -8px rgba(0,0,0,0.5)",
  ["--lp-shadow-float" as string]: "0 12px 32px -10px rgba(0,0,0,0.6)",
};

type PlanCard = {
  id?: Exclude<Plan, "free" | "guest">;
  name: string;
  price: string;
  per?: string;
  tagline: string;
  features: string[];
  cta: string;
  highlight?: boolean;
  invert?: boolean;
  badge?: string;
};

const PLANS: PlanCard[] = [
  {
    name: "Free",
    price: "$0",
    per: "/ forever",
    tagline: "Start sketching for free — the Rules Engine validates every connection. Upgrade when you need more.",
    features: ["2 projects", "AI architect included", "22 node types · 16 edges", "Default-deny rules validation"],
    cta: "start free",
  },
  {
    id: "draw",
    name: "Draw",
    price: "$5",
    per: "/ mo",
    tagline: "The drawing tool. Sketch backend architecture as a node/edge graph — the Rules Engine auto-validates every connection.",
    features: ["Unlimited projects", "AI architect included", "22 node types · 16 edges", "Default-deny rules validation"],
    cta: "start drawing",
  },
  {
    id: "build",
    name: "Build",
    price: "$20",
    per: "/ mo",
    tagline: "Everything in Draw, plus AI that scaffolds your project — ~80% ships as boilerplate; the algorithmic logic stays yours.",
    features: ["Everything in Draw", "Extended AI usage", "Code Generation + ZIP export"],
    cta: "start building",
  },
  {
    id: "code",
    name: "Code",
    price: "$100",
    per: "/ mo",
    tagline: "Everything in Build, but Solarch writes the whole codebase — full generation, not just the skeleton. Extend any limit at discounted pricing.",
    features: ["Everything in Build", "Solarch writes the whole codebase", "Maximum AI usage", "Extend limits at a discount"],
    cta: "go pro",
    highlight: true,
    invert: true,
    badge: "most popular",
  },
];

const TEAMS: PlanCard[] = [
  {
    name: "Team",
    price: "$30",
    per: "/ seat",
    tagline: "Build together — shared projects with single-home nodes and ghost references across the org.",
    features: [],
    cta: "coming soon",
  },
  {
    name: "Enterprise",
    price: "Contact us",
    tagline: "Self-host, SSO, audit logs, a custom rules matrix, and dedicated support.",
    features: [],
    cta: "contact us",
  },
];

// Hierarchical plan order — you can't subscribe to a lower plan (downgrade) via checkout.
// guest: login-less trial; can't reach this page but sits at the bottom of the order for type integrity.
const PLAN_RANK: Record<Plan, number> = { guest: -1, free: 0, draw: 1, build: 2, code: 3 };

/** Time left until trial ends, human-readable ("in 5 days" / "in 18 hours" / "today").
 *  Past/null → null (don't show). From Polar trialEndsAt. */
function trialCountdown(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `in ${days} day${days > 1 ? "s" : ""}`;
  // <1 day: round up (don't under-promise; floor showed 90min as "1 hour").
  const hours = Math.ceil(ms / 3_600_000);
  return `in ${hours} hour${hours > 1 ? "s" : ""}`;
}

export function BillingPage() {
  const { data: sub } = useSubscription();
  const checkout = useCheckout();
  const qc = useQueryClient();
  const palette = useTheme((s) => s.resolved) === "dark" ? LP_PALETTE_DARK : LP_PALETTE_LIGHT;

  // Polar checkout success return (?checkout_id=...): verify immediately + refresh entitlement
  // (without depending on the webhook; the webhook also processes async as the source of truth).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutId = params.get("checkout_id");
    if (!checkoutId) return;
    confirmCheckout(checkoutId)
      .then(() => {
        qc.invalidateQueries({ queryKey: ["subscription"] });
        qc.invalidateQueries({ queryKey: ["codegen-status"] });
        toast.success("Plan activated — welcome aboard.");
      })
      .catch(() => toast.error("Payment received; your plan may take a moment to reflect."))
      .finally(() => {
        params.delete("checkout_id");
        const qs = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
      });
  }, [qc]);

  // If redirected here due to a plan/quota limit, show the reason (ai.ts puts it in sessionStorage).
  useEffect(() => {
    let notice: string | null = null;
    try {
      notice = sessionStorage.getItem("solarch:billing-notice");
      if (notice) sessionStorage.removeItem("solarch:billing-notice");
    } catch {
      /* no sessionStorage */
    }
    if (notice) toast.error(notice);
  }, []);

  const buy = async (plan: Exclude<Plan, "free" | "guest">) => {
    const { url } = await checkout.mutateAsync(plan);
    window.location.href = url;
  };

  /** CTA — landing Cta pattern + live behavior (current plan / checkout). */
  const Cta = ({ plan }: { plan: PlanCard }) => {
    const isCurrent = !!plan.id && sub?.plan === plan.id;
    const base = "group inline-flex w-full items-center justify-center gap-1.5 rounded-md px-5 py-2.5 font-mono text-[14.5px] font-medium transition-colors";

    // Free — default starting tier (no purchase). If on it, "current plan".
    if (plan.name === "Free") {
      return (
        <span className={`${base} border border-[var(--lp-hairline)] text-[var(--lp-ink-faint)] cursor-default`}>
          {sub?.plan === "free" ? "current plan" : "free tier"}
        </span>
      );
    }

    if (isCurrent) {
      return (
        <span className={`${base} border border-[var(--lp-hairline)] text-[var(--lp-ink-faint)] cursor-default`}>
          current plan
        </span>
      );
    }
    // Hierarchical: can't subscribe to a plan LOWER than the current one (Draw is "included" when on Build).
    if (plan.id && sub && PLAN_RANK[sub.plan] > PLAN_RANK[plan.id]) {
      return (
        <span className={`${base} border border-[var(--lp-hairline)] text-[var(--lp-ink-faint)] cursor-default`}>
          included
        </span>
      );
    }
    if (plan.name === "Team") {
      return (
        <span className={`${base} border border-[var(--lp-hairline)] text-[var(--lp-ink-faint)] cursor-default`}>
          coming soon
        </span>
      );
    }
    if (plan.name === "Enterprise") {
      return (
        <a href="mailto:info@solidea.tech" className={`${base} border border-[var(--lp-hairline-strong)] text-[var(--lp-ink)] hover:bg-[var(--lp-hover)]`}>
          {plan.cta}
          <span className="transition-transform group-hover:translate-x-0.5">{"-->"}</span>
        </a>
      );
    }
    const cls = plan.invert
      ? "bg-[var(--lp-on-accent)] text-white hover:opacity-90"
      : plan.highlight
        ? "bg-[var(--lp-accent)] text-black hover:bg-[var(--lp-accent-hover)]"
        : "border border-[var(--lp-hairline-strong)] text-[var(--lp-ink)] hover:bg-[var(--lp-hover)]";
    return (
      <button
        type="button"
        disabled={checkout.isPending}
        onClick={() => void buy(plan.id!)}
        className={`${base} ${cls} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {plan.cta}
        <span className="transition-transform group-hover:translate-x-0.5">{"-->"}</span>
      </button>
    );
  };

  return (
    <section style={palette} className="h-full w-full overflow-y-auto bg-[var(--lp-paper)] px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <p className="text-center font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--lp-ink-faint)]">Pricing</p>
        <h2 className="mx-auto mt-2 max-w-[20ch] text-center text-[clamp(22px,3vw,34px)] font-bold leading-[1.05] tracking-[-0.03em] text-[var(--lp-ink)]">
          Pick where you start.
        </h2>
        <p className="mx-auto mt-2 max-w-[60ch] text-center font-mono text-[13.5px] leading-relaxed text-[var(--lp-ink-soft)]">
          From a $5 sketchpad to a self-correcting code engine — pay for as much of the
          pipeline as you need. Every plan starts with a 7-day trial.
        </p>

        {/* current plan + subscription management */}
        {sub && (
          <p className="mx-auto mt-3 text-center font-mono text-[13.5px] text-[var(--lp-ink-faint)]">
            Current plan: <span className="font-medium text-[var(--lp-accent)]">{sub.plan}</span>
            {trialCountdown(sub.trialEndsAt) && !sub.cancelAtPeriodEnd && (
              <span className="ml-2 text-[var(--lp-accent)]">· trial ends {trialCountdown(sub.trialEndsAt)}</span>
            )}
            {sub.cancelAtPeriodEnd && (
              <span className="ml-2 text-[var(--lp-ink-faint)]">· cancels at period end</span>
            )}
            {sub.plan !== "free" && (
              <button onClick={() => void openPortal()} className="ml-3 underline underline-offset-2 hover:text-[var(--lp-accent)]">
                manage subscription
              </button>
            )}
          </p>
        )}

        {/* primary plans */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((p) => {
            const inv = p.invert;
            return (
              <div
                key={p.name}
                className={`relative flex flex-col overflow-hidden rounded-[12px] p-5 ${
                  inv
                    ? "bg-[var(--lp-accent)] text-[var(--lp-on-accent)] shadow-[var(--lp-shadow-float)]"
                    : p.highlight
                      ? "border-2 border-[var(--lp-accent)] bg-[var(--lp-paper-raised)] shadow-[var(--lp-shadow-float)]"
                      : "border border-[var(--lp-hairline)] bg-[var(--lp-paper-raised)] shadow-[var(--lp-shadow-card)]"
                }`}
              >
                {inv ? <AsciiCardFx className="pointer-events-none absolute inset-0 z-0 h-full w-full" /> : null}

                <div className="relative z-10 flex flex-1 flex-col">
                  {p.badge ? (
                    <span
                      className={`mb-3 inline-flex w-fit rounded-full px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] ${
                        inv ? "bg-[var(--lp-on-accent)] text-white" : "bg-[var(--lp-accent-wash)] text-[var(--lp-accent)]"
                      }`}
                    >
                      {p.badge}
                    </span>
                  ) : null}
                  <div className={`font-mono text-[12px] uppercase tracking-[0.16em] ${inv ? "text-[var(--lp-on-accent)]/60" : "text-[var(--lp-ink-faint)]"}`}>
                    Solarch
                  </div>
                  <h3 className={`mt-1 text-[25px] font-semibold tracking-[-0.02em] ${inv ? "text-[var(--lp-on-accent)]" : "text-[var(--lp-ink)]"}`}>{p.name}</h3>
                  <div className="mt-3 flex items-baseline gap-1.5">
                    <span className={`font-mono text-[33px] font-medium ${inv ? "text-[var(--lp-on-accent)]" : "text-[var(--lp-ink)]"}`}>{p.price}</span>
                    {p.per ? <span className={`font-mono text-[14px] ${inv ? "text-[var(--lp-on-accent)]/70" : "text-[var(--lp-ink-soft)]"}`}>{p.per}</span> : null}
                  </div>
                  <p className={`mt-1.5 flex items-center gap-1 font-mono text-[12px] ${inv ? "text-[var(--lp-on-accent)]/75" : "text-[var(--lp-accent)]"}`}>
                    <Check size={12} strokeWidth={2.5} aria-hidden /> 7-day trial
                  </p>
                  <p className={`mt-3 font-mono text-[14px] leading-relaxed ${inv ? "text-[var(--lp-on-accent)]/80" : "text-[var(--lp-ink-soft)]"}`}>{p.tagline}</p>
                  <ul className="mt-4 flex flex-col gap-2">
                    {p.features.map((f) => (
                      <li key={f} className={`flex items-start gap-2 font-mono text-[13.5px] leading-snug ${inv ? "text-[var(--lp-on-accent)]/85" : "text-[var(--lp-ink-soft)]"}`}>
                        <Check className={`mt-0.5 size-3.5 shrink-0 ${inv ? "text-[var(--lp-on-accent)]" : "text-[var(--lp-accent)]"}`} strokeWidth={2.4} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-5">
                    <Cta plan={p} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* team + enterprise */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {TEAMS.map((p) => (
            <div
              key={p.name}
              className="flex flex-col gap-5 rounded-[12px] border border-[var(--lp-hairline)] bg-[var(--lp-paper-raised)] p-6 shadow-[var(--lp-shadow-card)] sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="font-mono text-[12px] uppercase tracking-[0.16em] text-[var(--lp-ink-faint)]">Solarch</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <h3 className="text-[23px] font-semibold tracking-[-0.02em] text-[var(--lp-ink)]">{p.name}</h3>
                  <span className="font-mono text-[16px] text-[var(--lp-ink-soft)]">
                    {p.price}
                    {p.per ? ` ${p.per}` : ""}
                  </span>
                </div>
                <p className="mt-2 max-w-[46ch] font-mono text-[14px] leading-relaxed text-[var(--lp-ink-soft)]">{p.tagline}</p>
                <p className="mt-2 flex items-center gap-1 font-mono text-[12px] text-[var(--lp-accent)]">
                  <Check size={12} strokeWidth={2.5} aria-hidden /> 7-day trial
                </p>
              </div>
              <div className="shrink-0 sm:w-[180px]">
                <Cta plan={p} />
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center font-mono text-[12px] text-[var(--lp-ink-faint)]">
          Payments via Polar (Merchant of Record); 7-day free trial + 30-day money-back guarantee.{" "}
          <a href="/refund" className="underline underline-offset-2 hover:text-[var(--lp-accent)]">Refund</a>
          {" · "}
          <a href="/terms" className="underline underline-offset-2 hover:text-[var(--lp-accent)]">Terms</a>
          {" · "}
          <a href="/privacy" className="underline underline-offset-2 hover:text-[var(--lp-accent)]">Privacy</a>.
        </p>
      </div>
    </section>
  );
}
