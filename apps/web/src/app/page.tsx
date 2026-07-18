import { ButtonLink } from "@desiauction/ui";
import type { Metadata } from "next";

import { env } from "../env";
import { FEATURE_GROUPS, LANDING } from "../content/marketing";
import "./content.css";

export const metadata: Metadata = {
  title: "DesiAuction — the auction night your tournament deserves",
  description: LANDING.hero.sub,
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/` },
  openGraph: {
    title: "DesiAuction — tournament auctions, taken seriously",
    description: LANDING.hero.sub,
    url: `${env.PUBLIC_BASE_URL}/`,
    type: "website",
  },
};

/**
 * PX-10 P-01 — the landing page (PX-1 05 §2, 06 P-01), replacing the engineering
 * placeholder. Renders inside the PublicShell with no authentication. Copy is
 * the content guide's, verbatim; every capability named is one the platform has;
 * both CTAs and every link go to a route that exists.
 */
export default function LandingPage() {
  return (
    <div className="landing">
      <main>
        <section className="landing-hero">
          <h1>{LANDING.hero.h1}</h1>
          <p>{LANDING.hero.sub}</p>
          <div className="landing-cta">
            <ButtonLink href={LANDING.hero.ctaPrimary.href} variant="primary">
              {LANDING.hero.ctaPrimary.label}
            </ButtonLink>
            <ButtonLink href={LANDING.hero.ctaSecondary.href} variant="secondary">
              {LANDING.hero.ctaSecondary.label}
            </ButtonLink>
          </div>
        </section>

        <section className="landing-band alt" aria-labelledby="problem">
          <div className="landing-band-inner">
            <h2 id="problem">{LANDING.problem.h2}</h2>
            <div className="landing-quotes">
              {LANDING.problem.quotes.map((quote) => (
                <blockquote key={quote} className="landing-quote">
                  {quote}
                </blockquote>
              ))}
            </div>
            <p className="landing-problem-body">{LANDING.problem.body}</p>
          </div>
        </section>

        <section className="landing-band" id="features" aria-labelledby="promises">
          <div className="landing-band-inner">
            <h2 id="promises">{LANDING.promises.h2}</h2>
            <div className="landing-cards">
              {LANDING.promises.cards.map((card) => (
                <div key={card.title} className="landing-card">
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-band alt" aria-labelledby="how">
          <div className="landing-band-inner">
            <h2 id="how">{LANDING.howItWorks.h2}</h2>
            <ol className="landing-steps">
              {LANDING.howItWorks.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        </section>

        <section className="landing-band" aria-labelledby="capabilities">
          <div className="landing-band-inner">
            <h2 id="capabilities">Everything a tournament needs</h2>
            <div className="landing-cards">
              {FEATURE_GROUPS.map((group) => (
                <div key={group.title} className="landing-card">
                  <h3>{group.title}</h3>
                  <ul className="prose-ul" style={{ margin: 0 }}>
                    {group.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-band alt" aria-labelledby="foundation">
          <div className="landing-band-inner">
            <h2 id="foundation">{LANDING.foundation.h2}</h2>
            <div className="landing-cards">
              {LANDING.foundation.cards.map((card) => (
                <div key={card.title} className="landing-card">
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-band" aria-labelledby="india">
          <div className="landing-band-inner">
            <h2 id="india">{LANDING.india.h2}</h2>
            <div className="landing-india">
              {LANDING.india.points.map((point) => (
                <span key={point} className="landing-chip">
                  {point}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-band alt" aria-labelledby="stories">
          <div className="landing-band-inner">
            <h2 id="stories">{LANDING.stories.h2}</h2>
            <p className="landing-problem-body">{LANDING.stories.body}</p>
          </div>
        </section>

        <section className="landing-band" aria-labelledby="beta">
          <div className="landing-band-inner">
            <h2 id="beta" className="visually-hidden-heading">
              Get started
            </h2>
            <p className="landing-beta">{LANDING.beta.note}</p>
            <div className="landing-cta">
              <ButtonLink href={LANDING.beta.ctaPrimary.href} variant="primary">
                {LANDING.beta.ctaPrimary.label}
              </ButtonLink>
              <ButtonLink href={LANDING.beta.ctaSecondary.href} variant="secondary">
                {LANDING.beta.ctaSecondary.label}
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
