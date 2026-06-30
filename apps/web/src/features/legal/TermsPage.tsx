/* NOTE: Template only — not legal advice. Have a professional review before launch,
 * especially the Turkey/KVKK + EU/GDPR + Merchant-of-Record specifics. */
import { LegalShell, Section, P, Bullets } from "./LegalShell";

const UPDATED = "June 4, 2026";

export function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      updated={UPDATED}
      summary={
        <>
          These Terms are an agreement between you and Solarch. By creating an account or using the
          service, you accept them. Solarch is an independent software product operated under the
          Solidea brand by a solo developer based in Turkey. Payments are sold and processed by our
          Merchant of Record (see §05).
        </>
      }
    >
      <Section n="01" title="Who we are & acceptance">
        <P>
          “Solarch”, “we”, “us” refers to the independent developer (operating under the{" "}
          <strong>Solidea</strong> brand, based in Turkey) who provides the Solarch product and
          website at solarch.dev. By accessing or using Solarch, you agree to these Terms and to our{" "}
          <a href="/privacy">Privacy Policy</a> and <a href="/refund">Refund Policy</a>. If you do not
          agree, do not use the service.
        </P>
      </Section>

      <Section n="02" title="Eligibility">
        <P>
          You must be at least 18 years old and able to enter into a binding contract. If you use
          Solarch on behalf of an organization, you confirm you are authorized to bind that
          organization to these Terms.
        </P>
      </Section>

      <Section n="03" title="The service">
        <P>
          Solarch is a tool for designing software architecture as a validated graph and generating
          code from it. The service is under active development and offered on an{" "}
          <strong>early-access</strong> basis; features may change, break, or be removed, and
          availability is not guaranteed. We may modify or discontinue any part of the service at any
          time.
        </P>
      </Section>

      <Section n="04" title="Accounts">
        <P>
          Authentication is handled through a third-party identity provider. You are responsible for
          your account, for keeping access credentials secure, and for all activity under your
          account. Notify us promptly of any unauthorized use. For team/organization workspaces, the
          person who creates the workspace is responsible for managing its members.
        </P>
      </Section>

      <Section n="05" title="Plans, billing & Merchant of Record">
        <Bullets
          items={[
            <>
              <strong>Merchant of Record.</strong> Paid plans are sold and processed by{" "}
              <strong>Polar</strong>, acting as our Merchant of Record. Polar is the seller of
              record for your purchase, handles billing and applicable taxes (e.g. VAT/sales tax),
              and its buyer terms also apply to the transaction. We do not receive or store your full
              payment-card details.
            </>,
            <>
              <strong>Trial.</strong> Paid plans include a 7-day free trial. You will not be charged
              if you cancel before the trial ends.
            </>,
            <>
              <strong>Subscriptions.</strong> After any trial, plans renew automatically each billing
              period (monthly, unless stated otherwise) at the then-current price until cancelled.
            </>,
            <>
              <strong>Cancellation.</strong> You can cancel at any time; access continues until the
              end of the paid period. See the <a href="/refund">Refund Policy</a> for refunds.
            </>,
            <>
              <strong>Price changes.</strong> We may change prices; changes apply to future billing
              periods and we will give reasonable notice.
            </>,
          ]}
        />
      </Section>

      <Section n="06" title="Refunds">
        <P>
          Refunds are governed by our <a href="/refund">Refund Policy</a>, which forms part of these
          Terms. In short: cancel within the 7-day trial to avoid charges, and every paid plan is
          backed by a <strong>30-day money-back guarantee</strong> — request a refund within 30 days
          of a charge and we refund it in full.
        </P>
      </Section>

      <Section n="07" title="Acceptable use">
        <P>You agree not to:</P>
        <Bullets
          items={[
            "use Solarch for unlawful purposes or to infringe others’ rights;",
            "attempt to breach, probe, or disrupt the service, its security, or other users;",
            "reverse engineer, resell, or sublicense the service except as expressly permitted by its license;",
            "scrape, overload, or abuse the service or its AI features (including automated bulk requests);",
            "upload malware or content you have no right to use.",
          ]}
        />
        <P>
          We may suspend or terminate accounts that violate this section or create risk for the
          service or others.
        </P>
      </Section>

      <Section n="08" title="Your content & intellectual property">
        <P>
          You keep ownership of the diagrams, projects, and code you create with Solarch (“Your
          Content”). You grant us a limited license to host, process, and display Your Content solely
          to operate and improve the service. We and our licensors retain all rights in Solarch
          itself — the software, brand, and underlying technology. Solarch is distributed under its
          stated license; nothing here grants you rights beyond it.
        </P>
      </Section>

      <Section n="09" title="AI features">
        <P>
          Solarch uses third-party AI providers to generate suggestions and code. AI output may be
          inaccurate, incomplete, or insecure — <strong>you are responsible for reviewing and
          testing anything generated before using it</strong>. To produce output, the inputs you
          provide (such as your architecture and prompts) are sent to third-party AI processors that
          may operate outside Turkey and the EEA. Do not submit secrets or sensitive personal data
          in prompts; use environment-variable references rather than raw secret values.
        </P>
      </Section>

      <Section n="10" title="Third-party services">
        <P>
          Solarch relies on third-party providers (for authentication, hosting, payments, and AI).
          Their services are governed by their own terms, and we are not responsible for them. See
          the <a href="/privacy">Privacy Policy</a> for the categories of providers involved.
        </P>
      </Section>

      <Section n="11" title="Disclaimers">
        <P>
          The service is provided <strong>“as is” and “as available,”</strong> without warranties of
          any kind, express or implied, including fitness for a particular purpose, accuracy, or
          non-infringement. We do not warrant that the service will be uninterrupted, error-free, or
          that generated output will be correct or secure.
        </P>
      </Section>

      <Section n="12" title="Limitation of liability">
        <P>
          To the maximum extent permitted by law, we are not liable for indirect, incidental, or
          consequential damages, or for lost data, profits, or business. Our total liability for any
          claim relating to the service is limited to the amount you paid for the service in the 12
          months before the event giving rise to the claim (or USD 100 if you paid nothing). Nothing
          here limits liability that cannot be limited under applicable law.
        </P>
      </Section>

      <Section n="13" title="Indemnification">
        <P>
          You agree to indemnify and hold us harmless from claims arising out of your misuse of the
          service, your violation of these Terms, or Your Content.
        </P>
      </Section>

      <Section n="14" title="Termination">
        <P>
          You may stop using Solarch at any time. We may suspend or terminate access if you breach
          these Terms or to protect the service or others. On termination, your right to use the
          service ends; sections that by nature should survive (IP, disclaimers, liability,
          governing law) continue to apply.
        </P>
      </Section>

      <Section n="15" title="Changes to these Terms">
        <P>
          We may update these Terms from time to time. We will update the “Last updated” date and,
          for material changes, provide reasonable notice. Continued use after changes take effect
          means you accept the updated Terms.
        </P>
      </Section>

      <Section n="16" title="Governing law & disputes">
        <P>
          These Terms are governed by the laws of the Republic of Turkey, without regard to
          conflict-of-laws rules. The courts and enforcement offices of Turkey have jurisdiction,
          except where mandatory consumer-protection law gives you the right to bring a claim in your
          country of residence. We will try to resolve disputes informally first — email{" "}
          <a href="mailto:legal@solarch.dev">legal@solarch.dev</a>.
        </P>
      </Section>

      <Section n="17" title="Contact">
        <P>
          Solarch (Solidea brand) — independent developer, Turkey. General:{" "}
          <a href="mailto:info@solidea.tech">info@solidea.tech</a>. Legal:{" "}
          <a href="mailto:legal@solarch.dev">legal@solarch.dev</a>.
        </P>
      </Section>
    </LegalShell>
  );
}
