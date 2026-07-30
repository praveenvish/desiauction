import { ButtonLink } from "@desiauction/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { env } from "../../env";
import { PRICING } from "../../content/marketing";
import {
  IconArrowRight,
  IconCheck,
  IconFileCheck,
  IconShieldCheck,
  IconSpark,
} from "../../components/marketing/icons";
import { slugify } from "../../lib/slug";
import "../content.css";
import "../marketing.css";

/**
 * The page emitted ZERO OG/Twitter tags: `/` carries seven and `/c` carries
 * seven, so a pricing link pasted into the WhatsApp group where organizers
 * actually decide things previewed as a bare URL next to two rivals that
 * preview as cards. The image itself comes from the sibling `opengraph-image`
 * / `twitter-image` routes (Next injects `og:image` from them automatically),
 * which reuse the competition share-card renderer rather than inventing a
 * second one.
 */
export const metadata: Metadata = {
  title: "Pricing · DesiAuction",
  description: PRICING.sub,
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/pricing` },
  openGraph: {
    title: "Simple, public pricing · DesiAuction",
    description: PRICING.sub,
    url: `${env.PUBLIC_BASE_URL}/pricing`,
    type: "website",
    siteName: "DesiAuction",
  },
  twitter: {
    card: "summary_large_image",
    title: "Simple, public pricing · DesiAuction",
    description: PRICING.sub,
  },
};

/**
 * One comparison cell. A tick on its own is a picture, not an answer: screen
 * readers get the word and sighted readers get the mark, from the same cell.
 * The em dash is decorative for exactly the same reason — "not included" is the
 * information, and the glyph is only how it looks.
 */
function CompareCell({ value }: { value: string | boolean }) {
  if (typeof value === "string") {
    return <>{value}</>;
  }
  return value ? (
    <>
      <IconCheck className="mk-compare-yes" width={20} height={20} />
      <span className="visually-hidden">Included</span>
    </>
  ) : (
    <>
      <span className="mk-compare-no" aria-hidden="true">
        —
      </span>
      <span className="visually-hidden">Not included</span>
    </>
  );
}

/**
 * PX-10 P-02 — Pricing (PX-1 05 §3). Beta banner present, prices honest
 * ("published at GA"), and — by mandate — no checkout affordance exists. The FAQ
 * is native details/summary; no JS library. Presentation is the `mk-` layer:
 * hero type, the featured Pro Pass card, and the trust line that is the whole
 * point of the pricing model.
 *
 * 2026-07-25 — five things a paying reader needed and could not get here: the
 * beta promise was the tail of a disclaimer, the trust line was a caption
 * between two slabs, three cards could not be read across, an organization
 * could not work out how to buy, and the page had no closing action. Each is a
 * block below, in the order a decision is actually made: what do I risk → what
 * does it cost → what do I lose on the cheap tier → how do I buy → what if →
 * start.
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

          {/* Was `.mk-note[role="note"]` — a muted, dashed-aside treatment that
              reads as fine print, with the one sentence a visitor actually
              needs ("stay free forever") buried thirty words in. The promise
              now leads at display weight and the mechanics follow it. */}
          <div className="mk-promise">
            <span className="mk-promise-icon">
              <IconSpark />
            </span>
            <div className="mk-promise-copy">
              <p className="mk-promise-headline">{PRICING.betaHeadline}</p>
              <p className="mk-promise-body">{PRICING.betaBanner}</p>
            </div>
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
                  {/* The "Most popular" flag was removed 2026-07-25. Visual
                      emphasis (mk-tier--featured) is a first-party opinion the
                      vendor is entitled to hold; "most popular" is an assertion
                      about other customers. It was not merely unevidenced but
                      knowably false: this tier has no published price and, by
                      the mandate above, no checkout — so the set of people who
                      could have chosen it is empty. The landing page's pricing
                      preview already renders this tier flagless; this page had
                      simply not been brought into line. */}
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
                  <p className="mk-tier-action">
                    <ButtonLink
                      href={tier.cta.href}
                      variant={tier.featured === true ? "primary" : "secondary"}
                    >
                      {tier.cta.label}
                    </ButtonLink>
                  </p>
                </section>
              );
            })}
          </div>

          {/* Three cards are three pitches; a table is one decision. The wrapper
              scrolls on its own rather than pushing the document sideways, and
              carries tabindex because a scroll region a mouse can reach has to
              be reachable from a keyboard too (axe: scrollable-region-focusable). */}
          <div className="mk-compare-wrap" tabIndex={0} role="group" aria-label="Tier comparison">
            <table className="mk-compare">
              <caption className="mk-compare-caption">{PRICING.comparison.caption}</caption>
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  {PRICING.tiers.map((tier) => (
                    <th key={tier.name} scope="col">
                      {tier.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PRICING.comparison.rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    {row.cells.map((cell, index) => (
                      <td key={PRICING.tiers[index]?.name ?? String(index)}>
                        <CompareCell value={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
                {/* Read off `tiers`, never re-typed: the table cannot quote a
                    price the cards above have stopped quoting. */}
                <tr className="mk-compare-price">
                  <th scope="row">Price</th>
                  {PRICING.tiers.map((tier) => (
                    <td key={tier.name}>
                      {tier.price}
                      <span className="mk-compare-cadence">{tier.cadence}</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mk-compare-note">{PRICING.comparison.note}</p>

          {/* Was a 26px caption line wedged between the tier grid and the FAQ —
              the load-bearing sentence of the entire pricing model, set smaller
              than the copy around it. It is a block now, and it answers the
              question the table above has just raised. */}
          <section className="mk-pledge" aria-labelledby="pricing-pledge">
            <span className="mk-pledge-icon">
              <IconShieldCheck />
            </span>
            <div>
              <h2 id="pricing-pledge" className="mk-pledge-title">
                {PRICING.trustLine}
              </h2>
              <p className="mk-pledge-note">{PRICING.trustLineNote}</p>
            </div>
          </section>

          <section className="mk-procure" aria-labelledby="pricing-procurement">
            <div className="mk-procure-head">
              <p className="mk-kicker">{PRICING.procurement.kicker}</p>
              <h2 id="pricing-procurement" className="mk-h2">
                {PRICING.procurement.h2}
              </h2>
              <p className="mk-lead">{PRICING.procurement.intro}</p>
            </div>
            <ul className="mk-procure-list">
              {PRICING.procurement.points.map((point) => (
                <li key={point.title}>
                  <IconFileCheck />
                  <h3>{point.title}</h3>
                  <p>{point.body}</p>
                </li>
              ))}
            </ul>
            <div className="mk-procure-gap">
              <p>{PRICING.procurement.gap}</p>
              <ButtonLink href={PRICING.procurement.cta.href} variant="secondary">
                {PRICING.procurement.cta.label}
              </ButtonLink>
            </div>
          </section>

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
                {faq.link === undefined ? null : (
                  <p className="mk-faq-link">
                    <Link href={faq.link.href}>
                      {faq.link.label}
                      <IconArrowRight width={16} height={16} />
                    </Link>
                  </p>
                )}
              </details>
            ))}
          </section>
        </div>
      </section>

      {/* `main` used to end at y≈1276 on a 1440 desktop and drop straight into
          the footer: a reader who had just been persuaded had no action within
          reach. Same band the landing page closes on, so the two public
          journeys end the same way. */}
      <section
        className="mk-band mk-cta-band"
        data-theme="floodlight"
        aria-labelledby="pricing-closing"
      >
        <div className="mk-cta-photo" aria-hidden="true" />
        <div className="mk-fx" aria-hidden="true">
          <i className="mk-fx-beam mk-fx-beam--left" />
          <i className="mk-fx-particles" />
        </div>
        <div className="mk-container">
          <div className="mk-cta">
            <div className="mk-cta-copy">
              <p className="mk-kicker">{PRICING.closing.kicker}</p>
              <h2 id="pricing-closing" className="mk-cta-title">
                {PRICING.closing.title}
              </h2>
              <p className="mk-cta-note">{PRICING.closing.note}</p>
            </div>
            <div className="mk-cta-actions">
              <ButtonLink href={PRICING.closing.ctaPrimary.href} variant="primary" size="lg">
                {PRICING.closing.ctaPrimary.label}
                <IconArrowRight width={18} height={18} />
              </ButtonLink>
              <ButtonLink href={PRICING.closing.ctaSecondary.href} variant="secondary" size="lg">
                {PRICING.closing.ctaSecondary.label}
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
