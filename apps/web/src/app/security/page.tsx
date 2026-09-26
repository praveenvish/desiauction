import {
  IconKey,
  IconLedger,
  IconLock,
  IconMail,
  IconRefresh,
  IconShieldCheck,
} from "@desiauction/ui";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { env } from "../../env";
import { LEGAL_IDENTITY } from "../../content/company";
import { LANDING } from "../../content/marketing";
import { ContentPage } from "../../components/public/content-page";
import { SideCard } from "../../components/public/public-kit";
import "../content.css";

export const metadata: Metadata = {
  title: "Security · DesiAuction",
  description: "How DesiAuction keeps the auction and the money trustworthy.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/security` },
};

/** A distinct glyph per guarantee, in the order `LANDING.foundation` lists them. */
const FOUNDATION_ICONS: readonly ReactNode[] = [
  <IconShieldCheck key="verified" size={24} weight="duotone" />,
  <IconLedger key="ledger" size={24} weight="duotone" />,
  <IconRefresh key="recovers" size={24} weight="duotone" />,
];

const SECURITY_FACTS = [
  {
    title: "Sign-in codes are short-lived",
    body: "A code lasts five minutes and allows five tries. A number can be sent at most five codes an hour.",
  },
  {
    title: "Codes are never stored as digits",
    body: "What we keep is a keyed digest tied to the code's purpose — a copy of the database cannot turn it back into a code.",
  },
  {
    title: "Sessions you can see and end",
    body: "Only a hash of each session token is stored, a new token is issued at every sign-in, and every signed-in device is listed on your account with a sign-out.",
  },
  {
    title: "Cookies scripts cannot read",
    body: "Session cookies are HTTP-only and secure-only, so a script on a page cannot lift them.",
  },
  {
    title: "A content policy on every page",
    body: "Each response carries a Content-Security-Policy with a fresh nonce, so only the scripts we served can run.",
  },
  {
    title: "Your number stays private",
    body: "Public player and team pages never show a mobile number or email address.",
  },
] as const;

/**
 * Real, certified architecture facts — the same guarantees /features states,
 * as a 2×2 of cards rather than a wall of four headings, with the two things a
 * security-minded visitor looks for beside them: how sign-in works, and where
 * to send a problem.
 */
export default function SecurityPage() {
  const cards = [
    ...LANDING.foundation.cards.map((card, index) => ({
      ...card,
      icon: FOUNDATION_ICONS[index] ?? <IconShieldCheck size={24} weight="duotone" />,
    })),
    {
      title: "Access is deliberate, not default",
      body: "Money authority is granted, not inherited from a role — owning an organization doesn't hand you the settlement or finance desks. Every grant is auditable.",
      icon: <IconKey size={24} weight="duotone" />,
    },
  ];
  return (
    <ContentPage
      eyebrow="Trust"
      title="Security"
      lede={`${LANDING.foundation.h2}: the server decides, the record is permanent, and nobody gets the money desks by accident.`}
      prose={false}
      aside={
        <>
          <SideCard
            headingId="sign-in"
            title="No passwords to leak"
            icon={<IconLock size={20} weight="duotone" />}
          >
            <p>
              Sign-in is a one-time code to your email or mobile number, or a passkey on your
              device. There is no password stored anywhere to steal.
            </p>
          </SideCard>
          <SideCard
            headingId="report-security"
            title="Found a problem?"
            icon={<IconMail size={20} weight="duotone" />}
            tone="accent"
          >
            <p>
              Tell us privately at{" "}
              <a href="mailto:support@desiauction.in" data-private>
                support@desiauction.in
              </a>
              . For anything about your personal data, write to{" "}
              <a href={`mailto:${LEGAL_IDENTITY.dataProtectionContactEmail}`} data-private>
                {LEGAL_IDENTITY.dataProtectionContactEmail}
              </a>
              .
            </p>
            <p>
              <Link href="/legal/privacy">Read the privacy policy</Link>
            </p>
          </SideCard>
        </>
      }
    >
      <h2 id="guarantees" className="cl-list-title">
        What the platform guarantees
      </h2>
      <ul className="feature-cards da-stagger" aria-labelledby="guarantees">
        {cards.map((card) => (
          <li key={card.title} className="feature-card">
            <span className="feature-card-tile" aria-hidden>
              {card.icon}
            </span>
            <h3>{card.title}</h3>
            <p>{card.body}</p>
          </li>
        ))}
      </ul>

      {/* SECURITY-SPECIFIC FACTS (wow pass, round 2). The cards above repeat
          the /features trust band; these are the details a security-minded
          reader checks, each one read off the code (server/auth/otp.ts,
          code-digest.ts, sessions.ts, actions.ts, middleware.ts). No
          certification, host or region is claimed that the code cannot show. */}
      <h2 id="under-the-hood" className="cl-list-title sec-facts-title">
        Under the hood
      </h2>
      <ul className="sec-facts" aria-labelledby="under-the-hood">
        {SECURITY_FACTS.map((fact) => (
          <li key={fact.title}>
            <strong>{fact.title}</strong>
            <span>{fact.body}</span>
          </li>
        ))}
      </ul>
    </ContentPage>
  );
}
