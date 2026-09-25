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
    </ContentPage>
  );
}
