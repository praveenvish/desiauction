import type { Metadata } from "next";

import { env } from "../../env";
import { PRICING } from "../../content/marketing";
import { IconCheck, IconShieldCheck, IconSpark } from "../../components/marketing/icons";
import { slugify } from "../../lib/slug";
import "../content.css";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Pricing · DesiAuction",
  description: PRICING.sub,
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/pricing` },
};

/**
 * PX-10 P-02 — Pricing (PX-1 05 §3). Beta banner present, prices honest
 * ("published at GA"), and — by mandate — no checkout affordance exists. The FAQ
 * is native details/summary; no JS library. Presentation is the `mk-` layer:
 * hero type, the featured Pro Pass card, and the trust line that is the whole
 * point of the pricing model.
 */
export default function PricingPage() {
  return (
    <main className="mk">
      <section className="mk-band">
        <div className="mk-container">
          <div className="mk-band-head mk-band-head--center mk-center">
            <p className="mk-kicker">One pass per tournament</p>
            <h1 className="mk-h1" style={{ fontSize: "clamp(2.25rem, 5vw, 64px)" }}>
              {PRICING.h1}
            </h1>
            <p className="mk-lead">{PRICING.sub}</p>
          </div>

          <div className="mk-note" role="note">
            <IconSpark />
            <span>{PRICING.betaBanner}</span>
          </div>

          <div className="mk-tiers">
            {PRICING.tiers.map((tier) => {
              const tierId = `tier-${slugify(tier.name)}`;
              return (
                <section
                  key={tier.name}
                  className={`mk-tier${tier.featured === true ? " mk-tier--featured" : ""}`}
                  aria-labelledby={tierId}
                >
                  {tier.featured === true ? (
                    <span className="mk-tier-flag">Most popular</span>
                  ) : null}
                  <h2 id={tierId}>{tier.name}</h2>
                  <p className="mk-tier-price">
                    {/* The figure slot is set for a numeral. A tier with no
                        published price puts a sentence there, which at display
                        scale dwarfs the tiers that do quote a number. */}
                    <span
                      className={`mk-tier-amount${/\d/.test(tier.price) ? "" : " mk-tier-amount--note"}`}
                    >
                      {tier.price}
                    </span>
                    <span className="mk-tier-cadence">{tier.cadence}</span>
                  </p>
                  <p className="mk-tier-limits">{tier.limits}</p>
                  <ul className="mk-checklist">
                    {tier.highlights.map((highlight) => (
                      <li key={highlight}>
                        <IconCheck />
                        {highlight}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          <p className="mk-trustline">
            <IconShieldCheck />
            <span>{PRICING.trustLine}</span>
          </p>

          <section className="mk-faq" aria-labelledby="pricing-faq">
            <div className="mk-band-head mk-band-head--center mk-center">
              <h2 id="pricing-faq" className="mk-h2">
                Questions
              </h2>
            </div>
            {PRICING.faqs.map((faq) => (
              <details key={faq.question} className="mk-faq-item">
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </section>
        </div>
      </section>
    </main>
  );
}
