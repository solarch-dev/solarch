/* NOTE: Template only — not legal advice. Have a professional review before launch,
 * especially KVKK (Turkey) + GDPR (EEA/UK) obligations and the data-controller identity. */
import { LegalShell, Section, P, Bullets } from "./LegalShell";

const UPDATED = "June 4, 2026";

export function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      updated={UPDATED}
      summary={
        <>
          This policy explains what personal data Solarch processes and why. Solarch is operated by
          an independent developer based in Turkey (under the Solidea brand), who acts as the data
          controller. We aim to collect as little as possible and we never sell your data.
        </>
      }
    >
      <Section n="01" title="Who is responsible">
        <P>
          The data controller is the independent developer operating Solarch (Solidea brand) in
          Turkey. This policy is written to align with Turkey’s KVKK (Law No. 6698) and, for users
          in the EEA/UK, the GDPR. Contact:{" "}
          <a href="mailto:privacy@solarch.dev">privacy@solarch.dev</a>.
        </P>
      </Section>

      <Section n="02" title="Data we process">
        <Bullets
          items={[
            <>
              <strong>Account data</strong> — your email address and basic profile (e.g. name), via
              our authentication provider when you sign up or sign in.
            </>,
            <>
              <strong>Your content</strong> — the projects, diagrams, nodes, and related data you
              create in Solarch.
            </>,
            <>
              <strong>AI inputs & outputs</strong> — the prompts and architecture you submit to AI
              features, and the generated results.
            </>,
            <>
              <strong>Billing data</strong> — handled by our payment provider (Merchant of Record).
              We receive limited records (e.g. plan, status, country, last digits) but{" "}
              <strong>not your full card details</strong>.
            </>,
            <>
              <strong>Usage & technical data</strong> — basic logs needed to run and secure the
              service (e.g. timestamps, error events, approximate request metadata).
            </>,
            <>
              <strong>Waitlist data</strong> — if you join the waitlist, your email and the time you
              joined.
            </>,
          ]}
        />
      </Section>

      <Section n="03" title="How and why we use it">
        <Bullets
          items={[
            "Provide, maintain, and improve the service and its AI features.",
            "Authenticate you and keep your account and projects secure.",
            "Process payments, trials, and subscriptions through our payment provider.",
            "Communicate with you about the service, support, and important changes.",
            "Prevent abuse, fraud, and security incidents, and comply with legal obligations.",
          ]}
        />
      </Section>

      <Section n="04" title="Legal bases">
        <P>
          Where GDPR applies, we rely on: <strong>performance of a contract</strong> (to provide the
          service you sign up for), <strong>legitimate interests</strong> (to secure and improve the
          service), <strong>consent</strong> (e.g. the waitlist), and{" "}
          <strong>legal obligation</strong> (e.g. tax/accounting via our Merchant of Record). Under
          KVKK we rely on the corresponding grounds in Art. 5, including processing necessary for a
          contract and our legitimate interests, or your explicit consent where required.
        </P>
      </Section>

      <Section n="05" title="Service providers (processors)">
        <P>
          We use a small number of trusted third parties to run Solarch. Rather than name each vendor
          here, we group them by function:
        </P>
        <Bullets
          items={[
            <><strong>Authentication & identity</strong> — to manage sign-in and accounts.</>,
            <><strong>Hosting & database</strong> — to store and serve your account and project data.</>,
            <><strong>AI processing</strong> — to generate suggestions and code from your inputs.</>,
            <><strong>Payments (Merchant of Record)</strong> — to sell plans and process billing and tax.</>,
            <><strong>Waitlist storage</strong> — to hold waitlist emails.</>,
          ]}
        />
        <P>
          These providers process data only to provide their service to us. We can share the specific
          providers on request — email <a href="mailto:privacy@solarch.dev">privacy@solarch.dev</a>.
        </P>
      </Section>

      <Section n="06" title="AI processing & important caution">
        <P>
          When you use AI features, the inputs you provide (your prompts and architecture) are sent to
          third-party AI providers to produce output. Some of these providers may process data on
          servers <strong>outside Turkey and the EEA</strong>, including in countries that may not
          offer the same level of data protection. <strong>Do not put secrets, credentials, or
          sensitive personal data into prompts</strong> — use environment-variable references instead
          of raw secret values.
        </P>
      </Section>

      <Section n="07" title="International transfers">
        <P>
          Because our providers operate globally, your data may be transferred to and processed in
          countries other than your own. Where required, we rely on appropriate safeguards (such as
          standard contractual clauses or equivalent mechanisms) offered by those providers.
        </P>
      </Section>

      <Section n="08" title="Cookies">
        <P>
          We use only <strong>essential cookies</strong> required to sign you in and keep your session
          secure. We do not use advertising or third-party analytics cookies. (If we add analytics in
          the future, we will update this policy and ask for consent where required.)
        </P>
      </Section>

      <Section n="09" title="Retention">
        <P>
          We keep account and project data while your account is active. If you delete your account or
          ask us to, we delete or anonymize your personal data within a reasonable period, except
          where we must keep limited records to meet legal, tax, or security obligations. Billing
          records are retained by our Merchant of Record as required by law.
        </P>
      </Section>

      <Section n="10" title="Your rights">
        <P>
          Depending on where you live (KVKK Art. 11 in Turkey; GDPR in the EEA/UK), you have rights
          to:
        </P>
        <Bullets
          items={[
            "access the personal data we hold about you and learn how it is processed;",
            "correct inaccurate data and complete incomplete data;",
            "request deletion or restriction of processing;",
            "object to certain processing and withdraw consent (without affecting prior processing);",
            "request a portable copy of data you provided;",
            "lodge a complaint with your data protection authority (in Turkey, the KVKK Board).",
          ]}
        />
        <P>
          To exercise any of these, email <a href="mailto:privacy@solarch.dev">privacy@solarch.dev</a>.
          We respond within the timeframes required by applicable law.
        </P>
      </Section>

      <Section n="11" title="Security">
        <P>
          We take reasonable technical and organizational measures to protect your data, including
          access controls and encryption in transit. No system is perfectly secure, so we cannot
          guarantee absolute security, but we work to reduce risk and respond to incidents.
        </P>
      </Section>

      <Section n="12" title="Children">
        <P>
          Solarch is not directed to anyone under 18, and we do not knowingly collect data from
          children. If you believe a child has provided us data, contact us and we will delete it.
        </P>
      </Section>

      <Section n="13" title="Changes">
        <P>
          We may update this policy. We will change the “Last updated” date and, for material changes,
          provide reasonable notice. Continued use after changes take effect means you accept the
          updated policy.
        </P>
      </Section>

      <Section n="14" title="Contact">
        <P>
          Data controller: independent developer (Solidea brand), Turkey. Privacy:{" "}
          <a href="mailto:privacy@solarch.dev">privacy@solarch.dev</a> · General:{" "}
          <a href="mailto:info@solidea.tech">info@solidea.tech</a>.
        </P>
      </Section>
    </LegalShell>
  );
}
