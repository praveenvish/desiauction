import { ButtonLink } from "@desiauction/ui";
import type { Metadata } from "next";

import { env } from "../../env";
import { FEATURE_GROUPS, LANDING } from "../../content/marketing";
import "../content.css";

export const metadata: Metadata = {
  title: "Features · DesiAuction",
  description: "Everything DesiAuction does — registration, the live auction, and the money.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/features` },
};

/**
 * PX-10 — the feature overview / product capabilities page (CTO §3). A durable
 * URL for the capability list the landing anchors at #features. Every item is a
 * capability the certified platform actually has. Public, no auth.
 */
export default function FeaturesPage() {
  return (
    <main className="content-page">
      <h1>Everything a tournament needs</h1>
      <p className="content-lead">{LANDING.hero.sub}</p>

      {FEATURE_GROUPS.map((group) => (
        <section key={group.title} className="content-section" aria-labelledby={group.title}>
          <h2 id={group.title}>{group.title}</h2>
          <ul className="prose-ul">
            {group.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </section>
      ))}

      <section className="content-section" aria-labelledby="features-foundation">
        <h2 id="features-foundation">{LANDING.foundation.h2}</h2>
        <div className="landing-cards">
          {LANDING.foundation.cards.map((card) => (
            <div key={card.title} className="landing-card">
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="landing-cta">
        <ButtonLink href="/login" variant="primary">
          Run your auction
        </ButtonLink>
        <ButtonLink href="/pricing" variant="secondary">
          See pricing
        </ButtonLink>
      </div>
    </main>
  );
}
