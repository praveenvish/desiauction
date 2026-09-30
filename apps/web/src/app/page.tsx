import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SPORTS } from "@desiauction/core";
import { env } from "../env";
import { JsonLd } from "../components/seo/json-ld";
import { SOCIAL_ACCOUNTS } from "../content/social";
import { SUPPORT_EMAIL } from "../content/support";
import {
  organizationJsonLd,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from "../server/seo/json-ld";
import { LANDING } from "../content/marketing";
import { LiveProof, LiveTicker } from "../components/marketing/live-tournaments";
import { LandingVoices } from "../components/marketing/landing-voices";
import { AuctionLab, HomeMotion, StickyCta } from "../components/marketing/guest-home";
import { Hero } from "../components/marketing/home/hero";
import { Night } from "../components/marketing/home/night";
import { Season } from "../components/marketing/home/season";
import { Seats } from "../components/marketing/home/seats";
import { Glyph } from "../components/marketing/home/glyphs";
import styles from "./home.module.css";
import "./marketing.css";
import { START_CLUB_LOGIN } from "../lib/start-intent";

const description =
  "Run a live player auction for your league: owners bid from their phones while the room watches the big screen. Registration, squads, fixtures and receipts in one place. Free during beta.";
const title = "DesiAuction — Live player auctions for your league";
export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/` },
  openGraph: {
    title,
    description,
    url: `${env.PUBLIC_BASE_URL}/`,
    type: "website",
  },
};
const sports = SPORTS.map((sport) => ({
  key: sport.key,
  label: sport.label,
  role: sport.roles.values[0]?.label ?? "Player",
}));

/**
 * One sign-up label on the page. The header keeps its short "Start free";
 * every CTA inside the page says what the click starts.
 */
const SIGNUP = { href: START_CLUB_LOGIN, label: "Create your tournament" } as const;

/**
 * THE HOME PAGE — "Your league, on air" (founder-approved 2026-09-30).
 *
 * One example auction (content/home-story.ts), told in the order a league
 * lives it: on air → the night, hour by hour → the season after the gavel →
 * everyone in the room → your turn → what is real → the last tap. Each product
 * surface appears once, where it happens.
 *
 * Everything is a server component except the playable demo and the sticky
 * phone CTA; motion is CSS (scroll timelines where supported), so the page
 * ships almost no JavaScript beyond the shell. The two database reads (the
 * ticker and the proof section share one) are cached per request and render
 * nothing when Postgres is down.
 */
export default function LandingPage() {
  return (
    <HomeMotion>
      <main className={styles.home} data-theme="floodlight">
        {/* SEO-1 Phase 2: who we are, what the site is called, and what the product is. */}
        <JsonLd
          data={[
            organizationJsonLd({
              base: env.PUBLIC_BASE_URL,
              supportEmail: SUPPORT_EMAIL,
              profiles: SOCIAL_ACCOUNTS.map((account) => account.href),
            }),
            webSiteJsonLd(env.PUBLIC_BASE_URL),
            softwareApplicationJsonLd({ base: env.PUBLIC_BASE_URL, description }),
          ]}
        />
        <Hero signupHref={SIGNUP.href} signupLabel={SIGNUP.label} sportCount={sports.length} />
        <Suspense fallback={null}>
          <LiveTicker sportCount={sports.length} />
        </Suspense>
        <Night />
        <Season />
        <Seats />
        <AuctionLab sports={sports} signupHref={SIGNUP.href} signupLabel={SIGNUP.label} />
        <Suspense fallback={null}>
          <LiveProof />
        </Suspense>
        {/* FR-1: real, permitted quotes — absent until there is one, and absent
            when the database is (same guard as the proof above). */}
        <Suspense fallback={null}>
          <LandingVoices />
        </Suspense>

        <section id="final-cta" className={styles.close} aria-labelledby="final-title">
          <span className={styles.ring} aria-hidden="true" />
          <span className={styles.ring} aria-hidden="true" />
          <div className={[styles.wrap, styles.closeIn].join(" ")}>
            <span className={styles.gavel}>
              <Glyph name="gavel" size={120} strokeWidth={1.2} />
            </span>
            <p className={styles.kicker}>Your sport. Your people. Your night.</p>
            <h2 id="final-title" className={[styles.display, styles.closeTitle].join(" ")}>
              Give your league its <span className={styles.gold}>auction night.</span>
            </h2>
            {/*
              TWO DOORS, BECAUSE THE PEOPLE WHO REACH THE BOTTOM WANT DIFFERENT
              THINGS. "Book a demo" is the page's one link into /schedule-demo;
              its label and href come from LANDING.beta so content.test.ts keeps
              checking the href resolves.
            */}
            <div className={styles.actions} style={{ justifyContent: "center" }}>
              <Link className={styles.primary} href={SIGNUP.href} data-track="final:signup">
                {SIGNUP.label}
              </Link>
              <Link
                className={styles.secondary}
                href={LANDING.beta.ctaSecondary.href}
                data-track="final:demo"
              >
                {LANDING.beta.ctaSecondary.label}
              </Link>
            </div>
            {/* The last doubts, answered with things the platform verifiably does. */}
            <ul className={styles.reassure} aria-label="Before you start">
              <li>
                <span style={{ color: "var(--green)" }} aria-hidden="true">
                  ✓
                </span>{" "}
                Free during beta
              </li>
              <li>
                <span style={{ color: "var(--green)" }} aria-hidden="true">
                  ✓
                </span>{" "}
                No app to install
              </li>
              <li>
                <span style={{ color: "var(--green)" }} aria-hidden="true">
                  ✓
                </span>{" "}
                Big screen from any browser
              </li>
              <li>
                <Link className={styles.textLink} href="/pricing">
                  See pricing →
                </Link>
              </li>
            </ul>
          </div>
        </section>
        {/* Inside <main> so it inherits the floodlight theme. */}
        <StickyCta href={SIGNUP.href} label={SIGNUP.label} />
      </main>
    </HomeMotion>
  );
}
