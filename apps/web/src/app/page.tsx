import { ButtonLink, IconArrowRight as IconTrail, VisuallyHidden } from "@desiauction/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { env } from "../env";
import { LANDING, PRICING, TRUST_MARKS } from "../content/marketing";
import { HeroStage, type StagePlayer } from "../components/marketing/hero-stage";
import { LiveTournaments } from "../components/marketing/live-tournaments";
import {
  IconArrowRight,
  IconBolt,
  IconCalendar,
  IconCheck,
  IconGavel,
  IconGlobe,
  IconLedger,
  IconMapPin,
  IconPhone,
  IconPlay,
  IconReceipt,
  IconRefresh,
  IconRupee,
  IconShieldCheck,
  IconSpark,
  IconStar,
  IconTrophy,
  IconTv,
  IconUsers,
} from "../components/marketing/icons";
import { slugify } from "../lib/slug";
import "./content.css";
import "./marketing.css";

export const metadata: Metadata = {
  title: "DesiAuction — SOLD, without the shouting",
  description: LANDING.hero.sub,
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/` },
  openGraph: {
    title: "DesiAuction — SOLD, without the shouting",
    description: LANDING.hero.sub,
    url: `${env.PUBLIC_BASE_URL}/`,
    type: "website",
  },
};

/**
 * The screen-reader equivalent of the hero stage. The stage is a looping,
 * decorative animation (aria-hidden) and must stay that way — announcing bid
 * numbers that change every 950ms would be noise, not information. But it is
 * also this page's ONLY proof that the product works, so a visitor who cannot
 * see it gets the same story as a finished sentence: one lot, opened, closed,
 * sold. Derived from the script the animation actually plays, so the two can
 * never drift apart, and deliberately worded WITHOUT the phrase "simulated
 * demo" — that exact string is the visible truth label below the stage, and
 * the e2e suite locates it by text.
 */
function stageNarration(player: StagePlayer): string {
  const rupees = (value: number) => `₹${value.toLocaleString("en-IN")}`;
  return (
    `Simulated auction, one lot. Lot ${String(player.lot)}: ${player.name}, ` +
    `${player.role.toLowerCase()}. ` +
    `Bidding opened at ${rupees(player.opening)} and closed at ${rupees(player.final)} — ` +
    `sold to ${player.team}.`
  );
}

const BEAT_ICONS = [IconUsers, IconGavel, IconReceipt] as const;
const WORST_ICONS = [IconPhone, IconBolt, IconLedger] as const;
const TRUST_ICONS = [IconShieldCheck, IconLedger, IconRupee, IconTv, IconPhone] as const;
/** One glyph per lifecycle stage, in LANDING.lifecycle.stages order. */
const STAGE_ICONS = [
  IconGlobe,
  IconTrophy,
  IconRefresh,
  IconUsers,
  IconGavel,
  IconStar,
  IconMapPin,
  IconCalendar,
  IconPlay,
  IconRupee,
] as const;

/**
 * The landing page, rebuilt to the 2026-07-24 Product Creation Council
 * blueprint and polished 2026-09-13/15 (premium pass): every section on the
 * page, one CTA, and the page's only proof is the product
 * visibly working plus candor — no testimonials, no stat bar, no capability
 * grid, no photography. The hero stage is a scripted replay (HeroStage): a
 * static-asset simulation labelled as such, with zero server dependency, whose
 * server render is a truthful SOLD frame (the LCP is product DOM, not an
 * image). The no-fabrication rule is now uniform: nothing on this page names a
 * customer, a metric, or a real person.
 *
 * 2026-07-25 — five sections added, because the page sold ONE NIGHT of a
 * product that runs a season, and answered none of a guest's commercial
 * questions. In page order: live tournaments (real rows, the only unsimulated
 * proof here), the lifecycle beyond auction night, a pricing preview, the beta
 * candor that turns "no customers to name" from a hole into a statement, and an
 * FAQ. Two invariants they are all built against:
 *
 *   1. This page renders when Postgres does not. The one database read lives in
 *      <LiveTournaments/>, which degrades to rendering NOTHING — see the guard
 *      there. `GET /` with the database stopped must still be a 200.
 *   2. Anything the repository could not evidence is written AND flagged with a
 *      `TODO(founder):` in ../content/marketing.ts, never invented and never
 *      quietly dropped. Grep that file for the fact-check list.
 *
 * 2026-09-15 — the premium pass kept EVERY section visible. A first cut had
 * folded "when things go wrong" behind a tab and merged the pricing preview
 * into the money band; the founder read both as sections removed, and a
 * section a visitor must click for is one most never see. What the pass
 * keeps: the proof marks ride inside the hero; the bands that used to end in
 * a ghost button end in an inline link, so the only buttons on the page are
 * the two asks; and the phone tier is laid out as rows where it was stacks.
 */
export default function LandingPage() {
  return (
    <div className="landing mk">
      <main>
        <div className="mk-progress" aria-hidden="true" />
        {/* --- 1 · Hero: the promise, and the product proving it ------------ */}
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
                <h1 className="mk-h1">
                  SOLD, without the <span className="mk-hero-highlight">shouting.</span>
                </h1>
                <p className="mk-lead">{LANDING.hero.sub}</p>
                <div className="mk-hero-actions">
                  <ButtonLink href={LANDING.hero.ctaPrimary.href} variant="primary" size="lg">
                    {LANDING.hero.ctaPrimary.label}
                    <IconArrowRight width={18} height={18} />
                  </ButtonLink>
                  {/* Was a play glyph pointing at "#demo" — a promise of video
                      that never played. The destination is the public directory
                      now, so the icon is the spectator screen the visitor is
                      being sent to. */}
                  <ButtonLink href={LANDING.hero.ctaSecondary.href} variant="secondary" size="lg">
                    <IconTv width={16} height={16} />
                    {LANDING.hero.ctaSecondary.label}
                  </ButtonLink>
                </div>
                <p className="mk-hero-note">{LANDING.hero.ctaNote}</p>
                {/* The proof marks — verifiable capabilities, never metrics —
                    used to be a band of their own under the hero. Inside it they
                    are read in the same breath as the promise, and the page is
                    one band shorter. */}
                {/* tabIndex: on a phone the row scrolls sideways, and a
                    scrollable region has to be reachable by keyboard (axe
                    scrollable-region-focusable). The list is labelled, so
                    landing on it reads as "Platform capabilities, list". */}
                <ul className="mk-hero-proof" aria-label="Platform capabilities" tabIndex={0}>
                  {TRUST_MARKS.map((mark, index) => {
                    const Icon = TRUST_ICONS[index] ?? IconCheck;
                    return (
                      <li key={mark}>
                        <Icon width={14} height={14} />
                        <span>{mark}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="mk-hero-demo">
                <HeroStage script={LANDING.hero.script} teams={LANDING.hero.demoTeams} />
                <p className="mk-stage-note">
                  {LANDING.hero.demoLabel}
                  <VisuallyHidden>{stageNarration(LANDING.hero.script[0])}</VisuallyHidden>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* --- 2 · Live tournaments: the page's only unsimulated proof -----
            Directly under the hero, on the floodlight, so the promise above is
            followed by evidence before the page starts explaining. Renders
            nothing when the directory is empty or the database is unreachable,
            which restores exactly the six-band layout. */}
        <LiveTournaments />

        {/* --- 3 · The night in three beats -------------------------------- */}
        <section className="mk-band mk-band--panel" id="how" aria-labelledby="how-heading">
          <div className="mk-container">
            <div className="mk-panel">
              <div className="mk-band-head mk-band-head--center mk-center">
                <p className="mk-kicker">{LANDING.beats.kicker}</p>
                <h2 id="how-heading" className="mk-h2">
                  {LANDING.beats.h2}
                </h2>
              </div>
              <ol className="mk-steps">
                {LANDING.beats.steps.map((step, index) => {
                  const Icon = BEAT_ICONS[index] ?? IconGavel;
                  return (
                    <li key={step.title}>
                      <div className="mk-step-top">
                        <span className="mk-icon-tile">
                          <Icon />
                        </span>
                      </div>
                      <div className="mk-swap">
                        <h3>{step.title}</h3>
                        <p>{step.body}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <p className="mk-center mk-panel-actions">
                <Link href="/features" className="mk-inline-link">
                  Explore all features
                  <IconTrail size={16} className="icon-trail" />
                </Link>
              </p>
            </div>
          </div>
        </section>

        {/* --- 4 · Built for the worst moment of the night ------------------
            Its own band, on the page, always visible. It was briefly folded
            behind a tab beside the beats above; the founder read that as the
            section being gone, and a section a visitor has to click for is
            one most visitors never see. */}
        <section className="mk-band mk-band--sunken" aria-labelledby="worst-heading">
          <div className="mk-container">
            <div className="mk-band-head mk-band-head--center mk-center">
              <p className="mk-kicker">{LANDING.worst.kicker}</p>
              <h2 id="worst-heading" className="mk-h2">
                {LANDING.worst.h2}
              </h2>
            </div>
            <div className="mk-cards">
              {LANDING.worst.items.map((item, index) => {
                const Icon = WORST_ICONS[index] ?? IconBolt;
                return (
                  <div key={item.title} className="mk-card mk-swapcard">
                    <span className="mk-icon-tile">
                      <Icon />
                    </span>
                    {/*
                     * TITLE AND BODY TRADE PLACES; THE ICON DOES NOT MOVE.
                     * Both are always in the DOM and neither is aria-hidden, so
                     * a screen reader reads the card whole — the crossfade is an
                     * affordance, not a gate.
                     */}
                    <div className="mk-swap">
                      <h3>{item.title}</h3>
                      <p>{item.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mk-center mk-rehearse">
              {LANDING.worst.rehearse}{" "}
              <Link href="/login" className="mk-inline-link">
                Start rehearsing
                <IconTrail size={16} className="icon-trail" />
              </Link>
            </p>
          </div>
        </section>

        {/* --- 5 · Beyond auction night: the whole lifecycle ---------------
            The page sold one night; an organizer running a six-week league read
            that as "this cannot run my league" and left. Ten stages, one line
            each, and — as load-bearing as the list — the paragraph that says
            what is NOT built. Dark, because it sits between two light bands and
            because a list of ten short lines is exactly the content the
            floodlight scope reads best. */}
        <section
          className="mk-band mk-band--dark mk-lifecycle-band"
          data-theme="floodlight"
          aria-labelledby="lifecycle-heading"
        >
          <div className="mk-container">
            <div className="mk-band-head mk-band-head--center mk-center">
              <p className="mk-kicker">{LANDING.lifecycle.kicker}</p>
              <h2 id="lifecycle-heading" className="mk-h2">
                {LANDING.lifecycle.h2}
              </h2>
              <p className="mk-lead">{LANDING.lifecycle.sub}</p>
            </div>
            {/* `mk-lifecycle`, not `mk-stage*`: the hero card owns that prefix
                and a second, unrelated "stage" in the same stylesheet would be a
                trap for whoever edits it next. */}
            <ol className="mk-lifecycle">
              {LANDING.lifecycle.stages.map((stage, index) => {
                const Icon = STAGE_ICONS[index] ?? IconCheck;
                return (
                  <li key={stage.name}>
                    <span className="mk-lifecycle-glyph" aria-hidden="true">
                      <Icon width={18} height={18} />
                    </span>
                    <h3>{stage.name}</h3>
                    <p>{stage.body}</p>
                  </li>
                );
              })}
            </ol>
            {/* The candor that makes the list above trustworthy. It is a <p>,
                not a card, so it reads as the section's own footnote rather
                than as an eleventh feature. */}
            <div className="mk-gap-note" role="note">
              <IconSpark width={18} height={18} />
              <p>
                <strong>{LANDING.lifecycle.gap.title}:</strong> {LANDING.lifecycle.gap.body}
              </p>
            </div>
          </div>
        </section>

        {/* --- 6 · The morning after: the receipt -------------------------- */}
        <section className="mk-band" aria-labelledby="money-heading">
          <div className="mk-container">
            <div className="mk-show">
              <div>
                <p className="mk-kicker">{LANDING.money.kicker}</p>
                <h2 id="money-heading" className="mk-h2">
                  {LANDING.money.h2}
                </h2>
                <p className="mk-money-body">{LANDING.money.body}</p>
              </div>
              <div className="mk-show-visual">
                <figure className="mk-receipt">
                  <figcaption className="mk-receipt-head">
                    <span>{LANDING.money.receipt.number}</span>
                    <span>{LANDING.money.receipt.title}</span>
                  </figcaption>
                  <p className="mk-receipt-amount">{LANDING.money.receipt.amount}</p>
                  <p className="mk-receipt-method">{LANDING.money.receipt.method}</p>
                  <p className="mk-receipt-ledger">{LANDING.money.receipt.ledgerLine}</p>
                  <p className="mk-receipt-note">{LANDING.money.receipt.note}</p>
                </figure>
              </div>
            </div>
          </div>
        </section>

        {/* --- 7 · Pricing preview ----------------------------------------
            Tiers are read from PRICING so the home page can never quote a
            price /pricing has retired, and the two paid tiers show their real
            "Published at GA" placeholder rather than a number nobody has
            decided. Deliberately WITHOUT the pricing page's "Most popular"
            flag: with zero customers, popularity is precisely the kind of
            claim this page is not allowed to make. */}
        <section className="mk-band mk-band--sunken" aria-labelledby="pricing-heading">
          <div className="mk-container">
            <div className="mk-band-head mk-band-head--center mk-center">
              <p className="mk-kicker">{LANDING.pricingPreview.kicker}</p>
              <h2 id="pricing-heading" className="mk-h2">
                {LANDING.pricingPreview.h2}
              </h2>
              <p className="mk-lead">{LANDING.pricingPreview.sub}</p>
            </div>
            <div className="mk-tiers mk-tiers--preview">
              {PRICING.tiers.map((tier) => {
                const tierId = `home-tier-${slugify(tier.name)}`;
                return (
                  <section
                    key={tier.name}
                    className={`mk-tier${tier.featured === true ? " mk-tier--featured" : ""}`}
                    aria-labelledby={tierId}
                  >
                    <h3 id={tierId}>{tier.name}</h3>
                    <p className="mk-tier-price">
                      {/* Same rule as /pricing: the display slot is set for a
                          numeral, so a tier whose price is a sentence drops to
                          text scale instead of dwarfing the tier that has one. */}
                      <span
                        className={`mk-tier-amount${/\d/.test(tier.price) ? "" : " mk-tier-amount--note"}`}
                      >
                        {tier.price}
                      </span>
                      <span className="mk-tier-cadence">{tier.cadence}</span>
                    </p>
                    <p className="mk-tier-limits">{tier.limits}</p>
                  </section>
                );
              })}
            </div>
            <p className="mk-trustline">
              <IconShieldCheck />
              <span>{PRICING.trustLine}</span>
              <Link href={LANDING.pricingPreview.cta.href} className="mk-inline-link">
                {LANDING.pricingPreview.cta.label}
                <IconTrail size={16} className="icon-trail" />
              </Link>
            </p>
          </div>
        </section>

        {/* --- 8 · Closing CTA ---------------------------------------------- */}
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
      </main>
    </div>
  );
}
