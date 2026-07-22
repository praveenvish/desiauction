import { ButtonLink } from "@desiauction/ui";
import type { Metadata } from "next";

import { env } from "../env";
import {
  CAPABILITY_CARDS,
  LANDING,
  LIVE_EXPERIENCE,
  TESTIMONIALS,
  TRUST_BAR,
  TRUST_MARKS,
} from "../content/marketing";
import { HeroStage } from "../components/marketing/hero-stage";
import { TestimonialCarousel } from "../components/marketing/testimonial-carousel";
import {
  IconArrowRight,
  IconBolt,
  IconBroadcast,
  IconCheck,
  IconGavel,
  IconLedger,
  IconPhone,
  IconPlay,
  IconReceipt,
  IconRupee,
  IconShieldCheck,
  IconTrophy,
  IconTv,
  IconUsers,
} from "../components/marketing/icons";
import "./content.css";
import "./marketing.css";

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

const TRUST_ICONS = [IconShieldCheck, IconLedger, IconRupee, IconBolt, IconPhone] as const;
const STEP_ICONS = [IconTrophy, IconUsers, IconTv, IconReceipt] as const;
const STAT_ICONS = [IconLedger, IconShieldCheck, IconBolt, IconPhone] as const;
const CAPABILITY_ICONS = [IconGavel, IconUsers, IconRupee, IconBroadcast, IconPhone] as const;

/**
 * The landing page (PX-1 05 §2), matched to the reference screenshot — hero →
 * how it works → trust → features → live demo → testimonials → CTA. Every
 * section answers one buyer question in order, and none exist that the
 * screenshot doesn't call for. Presentation is the `mk-` design layer; the
 * hero visual and testimonials are the two interactive client islands
 * (HeroStage, TestimonialCarousel), both transform-only and both degrading to
 * static under prefers-reduced-motion / no-JS. The no-fabrication rule holds
 * throughout: no invented customers, logos or metrics; the testimonials are
 * the single, explicitly-approved illustrative exception (see marketing.ts).
 * Photographic elements are named image slots under /public/marketing/ with
 * token-colored fallbacks.
 */
export default function LandingPage() {
  return (
    <div className="landing mk">
      <main>
        {/* Reading progress: a 2px accent hairline above the header. */}
        <div className="mk-progress" aria-hidden="true" />
        {/* --- 1 · Hero: the floodlit night -------------------------------- */}
        <section className="mk-hero" data-theme="floodlight">
          <div className="mk-hero-photo" aria-hidden="true" />
          {/* Atmosphere: floodlight beams, stadium dust, film grain. */}
          <div className="mk-fx" aria-hidden="true">
            <i className="mk-fx-beam mk-fx-beam--left" />
            <i className="mk-fx-beam mk-fx-beam--right" />
            <i className="mk-fx-particles" />
          </div>
          <div className="mk-container">
            <div className="mk-hero-grid">
              <div className="mk-hero-copy">
                <p className="mk-hero-badge">
                  <IconShieldCheck />
                  {LANDING.hero.badge}
                </p>
                <h1 className="mk-h1">
                  The auction night your tournament{" "}
                  <span className="mk-hero-highlight">deserves.</span>
                </h1>
                <p className="mk-lead">{LANDING.hero.sub}</p>
                <div className="mk-hero-actions">
                  <ButtonLink href={LANDING.hero.ctaPrimary.href} variant="primary" size="lg">
                    {LANDING.hero.ctaPrimary.label}
                    <IconArrowRight width={18} height={18} />
                  </ButtonLink>
                  <ButtonLink href={LANDING.hero.ctaSecondary.href} variant="secondary" size="lg">
                    <IconPlay width={16} height={16} />
                    {LANDING.hero.ctaSecondary.label}
                  </ButtonLink>
                </div>
              </div>
              {/* The live-room card, pinned to the viewport's top-right corner
                  (see .mk-hero-visual) so it floats beside the full-bleed
                  photo's trophy, clear of the cup. Parallax + count-up, decorative. */}
              <HeroStage player={LANDING.hero.player} />
            </div>
          </div>
        </section>

        {/* Full-width proof strip: its own thin band under the hero so the
            photo's trophy plinth — the gold "DesiAuction" — stays clear. */}
        <section
          className="mk-band mk-proof-band"
          data-theme="floodlight"
          aria-label="Platform capabilities"
        >
          <div className="mk-container">
            <ul className="mk-proof">
              {TRUST_MARKS.map((mark, index) => {
                const Icon = TRUST_ICONS[index] ?? IconCheck;
                return (
                  <li key={mark}>
                    <span className="mk-proof-tile">
                      <Icon />
                    </span>
                    <span>{mark}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* --- 2 · How it works: the workflow, a light panel on the night -- */}
        <section className="mk-band" data-theme="floodlight" id="how" aria-labelledby="how-heading">
          <div className="mk-container">
            <div className="mk-panel" data-theme="daylight">
              <div className="mk-band-head mk-band-head--center mk-center">
                <p className="mk-kicker">{LANDING.howItWorks.kicker}</p>
                <h2 id="how-heading" className="mk-h2">
                  {LANDING.howItWorks.h2}
                </h2>
              </div>
              <ol className="mk-steps">
                {LANDING.howItWorks.steps.map((step, index) => {
                  const Icon = STEP_ICONS[index] ?? IconCheck;
                  return (
                    <li key={step.title}>
                      <div className="mk-step-top">
                        <span className="mk-icon-tile">
                          <Icon />
                        </span>
                      </div>
                      <h3>{step.title}</h3>
                      <p>{step.body}</p>
                    </li>
                  );
                })}
              </ol>
              <p className="mk-center mk-panel-actions">
                <ButtonLink href="/features" variant="ghost">
                  Explore all features
                  <IconArrowRight width={16} height={16} />
                </ButtonLink>
              </p>
            </div>
          </div>
        </section>

        {/* --- 3 · Trust: "One platform. Complete trust." ------------------- */}
        <section className="mk-band" data-theme="floodlight" aria-labelledby="trust-heading">
          <div className="mk-container">
            <div className="mk-stats-panel mk-stats-panel--split">
              <div className="mk-stats-lead">
                <span className="mk-icon-tile mk-icon-tile--lg">
                  <IconShieldCheck />
                </span>
                <div>
                  <h2 id="trust-heading" className="mk-h2">
                    {TRUST_BAR.h2}
                  </h2>
                  <p>{TRUST_BAR.sub}</p>
                </div>
              </div>
              <div className="mk-stats-grid">
                {TRUST_BAR.stats.map((stat, index) => {
                  const Icon = STAT_ICONS[index] ?? IconCheck;
                  return (
                    <div key={stat.label} className="mk-stat">
                      <span className="mk-icon-tile">
                        <Icon />
                      </span>
                      <span className="mk-stat-text">
                        <span className="mk-stat-value">{stat.value}</span>
                        <span className="mk-stat-label">{stat.label}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* --- 4 · Features: everything you need ---------------------------- */}
        <section className="mk-band" id="features" aria-labelledby="capabilities-heading">
          <div className="mk-container">
            <div className="mk-band-head mk-band-head--center mk-center">
              <p className="mk-kicker">Built for organizers</p>
              <h2 id="capabilities-heading" className="mk-h2">
                Everything you need. Nothing you don&apos;t.
              </h2>
            </div>
            <div className="mk-cards mk-cards--5">
              {CAPABILITY_CARDS.map((card, index) => {
                const Icon = CAPABILITY_ICONS[index] ?? IconCheck;
                return (
                  <div key={card.title} className="mk-card">
                    <span className="mk-icon-tile">
                      <Icon />
                    </span>
                    <h3>{card.title}</h3>
                    <p>{card.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* --- 5 · Live demo: the moments that matter ----------------------- */}
        <section className="mk-band mk-band--sunken" aria-labelledby="live-heading">
          <div className="mk-container">
            <div className="mk-show">
              <div>
                <p className="mk-kicker">Live auction experience</p>
                <h2 id="live-heading" className="mk-h2">
                  {LIVE_EXPERIENCE.h2}
                </h2>
                <ul className="mk-checklist" style={{ marginBottom: "var(--space-6)" }}>
                  {LIVE_EXPERIENCE.checklist.map((item) => (
                    <li key={item}>
                      <IconCheck />
                      {item}
                    </li>
                  ))}
                </ul>
                <ButtonLink href={LIVE_EXPERIENCE.cta.href} variant="ghost">
                  {LIVE_EXPERIENCE.cta.label}
                  <IconArrowRight width={16} height={16} />
                </ButtonLink>
              </div>
              <div className="mk-show-visual">
                <div className="mk-video-mock" data-theme="floodlight" aria-hidden="true">
                  <span className="mk-video-badge">
                    <i />
                    Live
                  </span>
                  <span className="mk-video-caption">{LIVE_EXPERIENCE.demo.tournamentName}</span>
                  <span className="mk-video-play" data-theme="daylight">
                    <IconPlay />
                  </span>
                  <span className="mk-video-activity">
                    {LIVE_EXPERIENCE.demo.activity}
                    <time>· 2 sec ago</time>
                  </span>
                  <div className="mk-board" data-theme="daylight">
                    {LIVE_EXPERIENCE.demo.leaderboard.map((row, index) => (
                      <div key={row.team} className="mk-board-row">
                        <span
                          className={`mk-board-team mk-stage-team-${["a", "b", "c"][index] ?? "a"}`}
                        >
                          <i />
                          {row.team}
                        </span>
                        <span className="mk-board-amount">{row.amount}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* --- 6 · Testimonials ---------------------------------------------- */}
        <section className="mk-band" aria-labelledby="testimonials-heading">
          <div className="mk-container">
            <div className="mk-band-head mk-band-head--center mk-center">
              <p className="mk-kicker">Trusted by organizers</p>
              <h2 id="testimonials-heading" className="mk-h2">
                Loved by tournament organizers across India
              </h2>
            </div>
            <TestimonialCarousel testimonials={TESTIMONIALS} />
          </div>
        </section>

        {/* --- 7 · Closing CTA — full-bleed dark band flowing into the footer --- */}
        <section className="mk-band mk-cta-band" data-theme="floodlight" aria-labelledby="beta">
          <div className="mk-cta-photo" aria-hidden="true" />
          {/* The hero's atmosphere returns for the closing scene. */}
          <div className="mk-fx" aria-hidden="true">
            <i className="mk-fx-beam mk-fx-beam--left" />
            <i className="mk-fx-particles" />
          </div>
          <div className="mk-container">
            <div className="mk-cta">
              <div className="mk-cta-copy">
                <p className="mk-kicker">{LANDING.beta.kicker}</p>
                <h2 id="beta" className="mk-cta-title">
                  {LANDING.beta.title}
                </h2>
                <p className="mk-cta-note">{LANDING.beta.note}</p>
              </div>
              <div className="mk-cta-actions">
                <ButtonLink href={LANDING.beta.ctaPrimary.href} variant="primary" size="lg">
                  {LANDING.beta.ctaPrimary.label}
                  <IconArrowRight width={18} height={18} />
                </ButtonLink>
                <ButtonLink href={LANDING.beta.ctaSecondary.href} variant="secondary" size="lg">
                  {LANDING.beta.ctaSecondary.label}
                </ButtonLink>
              </div>
            </div>
          </div>
        </section>

        {/* Back to top: scroll-revealed, targets the shell's skip anchor. */}
        <a className="mk-top" href="#main-content" aria-label="Back to top">
          <IconArrowRight />
        </a>
      </main>
    </div>
  );
}
