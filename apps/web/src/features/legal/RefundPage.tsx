/* NOTE: Template only — not legal advice. Have a professional review before launch. */
import { LegalShell, Section, P, Bullets } from "./LegalShell";

const UPDATED = "June 4, 2026";

export function RefundPage() {
  return (
    <LegalShell
      title="Refund Policy"
      updated={UPDATED}
      summary={
        <>
          We want billing to be fair. Every paid plan comes with a 7-day free trial and a{" "}
          <strong>30-day money-back guarantee</strong> — if Solarch isn’t right for you, we refund
          you. This page explains how trials, cancellations, and refunds work. It is part of our{" "}
          <a href="/terms">Terms of Service</a>.
        </>
      }
    >
      <Section n="01" title="Merchant of Record">
        <P>
          Purchases are sold and processed by <strong>Polar</strong> as our Merchant of Record.
          Refunds are issued through Polar to your original payment method, and Polar’s buyer terms
          apply alongside this policy.
        </P>
      </Section>

      <Section n="02" title="Free trial">
        <P>
          Paid plans include a <strong>7-day free trial</strong>. If you cancel before the trial
          ends, you are not charged.
        </P>
      </Section>

      <Section n="03" title="30-day money-back guarantee">
        <P>
          If you are not satisfied for any reason, request a refund within <strong>30 days</strong>{" "}
          of a charge and we will refund it <strong>in full — no questions asked</strong>. This
          applies to your first purchase and to subscription renewals alike.
        </P>
        <Bullets
          items={[
            <>
              <strong>Full refund within 30 days</strong> — for any reason, on request, no qualifiers.
            </>,
            <>
              <strong>Duplicate or incorrect charges</strong> — always refunded, with no time limit.
            </>,
            <>
              <strong>Service failures</strong> — if a paid feature was substantially unavailable due
              to our fault, we refund the affected period.
            </>,
          ]}
        />
      </Section>

      <Section n="04" title="Subscriptions & cancellation">
        <Bullets
          items={[
            "Plans renew automatically each billing period until you cancel.",
            "You can cancel at any time from your account; access continues until the end of the period you already paid for.",
            "Cancelling stops future charges. If a renewal falls within the 30-day window above, you are covered by the money-back guarantee.",
          ]}
        />
      </Section>

      <Section n="05" title="How to request a refund">
        <P>
          Email <a href="mailto:legal@solarch.dev">legal@solarch.dev</a> from your account email
          within <strong>30 days</strong> of the charge, with your order or receipt reference. You do
          not need to give a reason. We aim to respond within a few business days, and approved
          refunds are processed by Polar to your original payment method (typically within 5–10
          business days, depending on your bank).
        </P>
      </Section>

      <Section n="06" title="Your statutory rights">
        <P>
          This policy is in addition to — and never removes — any rights you have under mandatory
          consumer law, including statutory withdrawal rights for digital services in the EU, UK,
          Turkey, and other regions. Where those rights are more generous than this policy, they
          apply.
        </P>
      </Section>

      <Section n="07" title="Chargebacks">
        <P>
          If you believe a charge is wrong, please contact us first — we offer a full 30-day refund
          and can usually resolve any issue faster than a bank dispute.
        </P>
      </Section>

      <Section n="08" title="Contact">
        <P>
          Billing & refunds: <a href="mailto:legal@solarch.dev">legal@solarch.dev</a> · General:{" "}
          <a href="mailto:info@solidea.tech">info@solidea.tech</a>.
        </P>
      </Section>
    </LegalShell>
  );
}
