import type { Metadata } from "next";

import { env } from "../../env";
import { PRICING } from "../../content/marketing";
import "../content.css";

export const metadata: Metadata = {
  title: "Pricing · DesiAuction",
  description: PRICING.sub,
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/pricing` },
};

/**
 * PX-10 P-02 — Pricing (PX-1 05 §3). Beta banner present, prices honest
 * ("published at GA"), and — by mandate — no checkout affordance exists. The FAQ
 * is native details/summary; no JS library.
 */
export default function PricingPage() {
  return (
    <main className="content-page">
      <h1>{PRICING.h1}</h1>
      <p className="content-lead">{PRICING.sub}</p>

      <div className="pricing-banner" role="note">
        {PRICING.betaBanner}
      </div>

      <div className="pricing-tiers">
        {PRICING.tiers.map((tier) => (
          <section
            key={tier.name}
            className={`pricing-tier${tier.featured === true ? " featured" : ""}`}
            aria-labelledby={`tier-${tier.name}`}
          >
            <h2 id={`tier-${tier.name}`}>{tier.name}</h2>
            <p>
              <span className="pricing-price">{tier.price}</span>
              <span className="pricing-cadence">{tier.cadence}</span>
            </p>
            <p className="pricing-limits">{tier.limits}</p>
            <ul>
              {tier.highlights.map((highlight) => (
                <li key={highlight}>{highlight}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="pricing-trust">{PRICING.trustLine}</p>

      <section className="content-section" aria-labelledby="pricing-faq">
        <h2 id="pricing-faq">Questions</h2>
        {PRICING.faqs.map((faq) => (
          <details key={faq.question} className="faq-item">
            <summary>{faq.question}</summary>
            <p>{faq.answer}</p>
          </details>
        ))}
      </section>
    </main>
  );
}
