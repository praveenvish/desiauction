import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { SPORTS } from "@desiauction/core";
import { env } from "../env";
import { LANDING } from "../content/marketing";
import { LiveTournaments } from "../components/marketing/live-tournaments";
import { LandingVoices } from "../components/marketing/landing-voices";
import { AuctionLab, HomeMotion, StickyCta } from "../components/marketing/guest-home";
import {
  IconArrowRight,
  IconCalendar,
  IconCheck,
  IconGavel,
  IconReceipt,
  IconTrophy,
  IconTv,
  IconUsers,
} from "../components/marketing/icons";
import styles from "./guest-home.module.css";
import "./marketing.css";
import { START_CLUB_LOGIN } from "../lib/start-intent";

const description =
  "Run a live player auction for your league: owners bid from their phones while the room watches the big screen. Registration, squads, fixtures and receipts in one place. Free during beta.";
const title = "DesiAuction — Live player auctions for your league";
export const metadata: Metadata = {
  title,
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

export default function LandingPage() {
  return (
    <HomeMotion>
      <main className={styles.home} data-theme="floodlight">
        <section id="hero" className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroArt}>
            <Image
              src="/marketing/multisport-hero.webp"
              alt="Four fictional athletes representing basketball, football, badminton and cricket"
              fill
              priority
              sizes="100vw"
              className={styles.heroImage}
            />
          </div>
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>
                <span className={styles.goldLine} /> GREAT TEAMS START HERE.
              </p>
              {/* The headline names the product. "Great teams start here" set a
                  mood a visitor had to decode; the one thing DesiAuction does
                  that a spreadsheet does not is the live auction, so the h1
                  says it and the brand line moves up to the eyebrow. */}
              <h1 id="hero-title">
                Your league&rsquo;s
                <br />
                <span>live auction.</span>
              </h1>
              <p className={styles.heroLead}>
                Owners bid for players from their phones.
                <br className={styles.desktopBreak} /> The whole room watches on the big screen.
              </p>
              <p className={styles.heroSub}>
                Registrations, squads, fixtures and receipts too.
                <br className={styles.desktopBreak} /> One home for the game you love.
              </p>
              <div className={styles.actions}>
                <Link className={styles.primary} href={SIGNUP.href} data-track="hero:signup">
                  {SIGNUP.label} <IconArrowRight size={20} />
                </Link>
                {/* Scrolls to the auction card itself, not the section top:
                    on a phone the sport picker sat between the click and the
                    thing the button promised. */}
                <a className={styles.secondary} href="#demo-auction" data-track="hero:mock">
                  <IconGavel size={16} /> Try a mock auction
                </a>
              </div>
              {/* The proof strip that sat under the hero (four 12px facts in an
                  80px band) is folded into this one line. */}
              <p className={styles.microcopy}>
                <IconCheck size={16} /> Free during beta <span>·</span> No card required{" "}
                <span>·</span> {sports.length} sports
              </p>
              {/* Many visitors arrive from a shared registration link: they
                  are players looking for a tournament, not organizers. */}
              <p className={styles.playerPath}>
                Playing, not organizing?{" "}
                <Link href="/c" data-track="hero:browse">
                  Find a tournament <IconArrowRight size={16} />
                </Link>
              </p>
            </div>
          </div>
        </section>

        <AuctionLab sports={sports} signupHref={SIGNUP.href} signupLabel={SIGNUP.label} />

        {/* Proof sits right after the demo — the moment a visitor asks "is
            anyone actually using this?". Both render nothing without data. */}
        <Suspense fallback={null}>
          <LiveTournaments />
        </Suspense>

        {/* FR-1: real, permitted quotes — absent until there is one, and absent
            when the database is (same guard as the strip above). */}
        <Suspense fallback={null}>
          <LandingVoices />
        </Suspense>

        <section id="features" className={styles.toolkit} aria-labelledby="toolkit-title">
          <div className={styles.container}>
            <div className={styles.sectionHeading} data-reveal>
              <div>
                <p className={styles.eyebrow}>BIG TOURNAMENT ENERGY. LESS ADMIN.</p>
                <h2 id="toolkit-title">
                  Registration, squads,
                  <br />
                  <span>fixtures and receipts.</span>
                </h2>
              </div>
              <p>
                From the first registration to the final squad,
                <br className={styles.desktopBreak} /> keep the moving parts in one place.
              </p>
            </div>
            <div className={styles.bento}>
              {/* THE REAL PRODUCT, inside the bento. These used to be a
                  ~1,000px standalone gallery ("This is auction night") that
                  rendered as a black slab until scrolled into view. They are
                  screenshots of the platform itself, captured from a practice
                  auction run end to end on it (scripts/capture-marketing-screens.ts);
                  the note says the teams are fictional. */}
              <article
                className={[styles.feature, styles.screenFeature].join(" ")}
                data-reveal
                data-spotlight
              >
                <div className={styles.screenCopy}>
                  <span className={styles.iconTile}>
                    <IconTv size={24} weight="duotone" />
                  </span>
                  <p className={styles.cardOverline}>01 / OWN THE ROOM · REAL SCREENS</p>
                  <h3>
                    Small screen.
                    <br />
                    Big moment.
                  </h3>
                  <p>
                    Owners bid from their phones, the big screen keeps score, and every screen sees
                    the gavel fall at the same moment.
                  </p>
                  <Link href="/help/screens-for-the-room">
                    Set the stage <IconArrowRight size={16} />
                  </Link>
                </div>
                <div className={styles.realShots}>
                  <figure className={styles.realScreen}>
                    <Image
                      src="/marketing/product/auction-board-v2.webp"
                      alt="The big-screen board of a live auction: ₹1,60,000 spent on 5 players, Aniket Sawant the most expensive at ₹85,000, and each team's remaining purse and squad"
                      width={1600}
                      height={900}
                      sizes="(max-width: 767px) 100vw, 560px"
                    />
                  </figure>
                  <figure className={styles.realPhone}>
                    <Image
                      src="/marketing/product/owner-phone-sold-v2.webp"
                      alt="A team owner's phone as the gavel falls: a SOLD stamp, Aniket Sawant signed to Falcons for ₹85,000"
                      width={560}
                      height={933}
                      sizes="(max-width: 767px) 30vw, 150px"
                    />
                  </figure>
                  <p className={styles.realNote}>
                    Real screens from a practice auction. Teams and owners are fictional.
                  </p>
                </div>
              </article>
              <article
                className={[styles.feature, styles.registration].join(" ")}
                data-reveal
                data-spotlight
              >
                <div className={styles.featureCopy}>
                  <span className={styles.iconTile}>
                    <IconUsers size={24} weight="duotone" />
                  </span>
                  <p className={styles.cardOverline}>02 / GET EVERYONE IN</p>
                  <h3>
                    One link.
                    <br />A whole player pool.
                  </h3>
                  <p>
                    Share your registration link. Review the players. Get your auction list ready.
                  </p>
                  <Link href="/help/registration-desk">
                    Meet your registration desk <IconArrowRight size={16} />
                  </Link>
                </div>
                <div
                  className={styles.rosterVisual}
                  aria-label="Illustrative player registration list"
                >
                  <div className={styles.visualHeader}>
                    <span>Player registrations</span>
                    <IconUsers size={20} />
                  </div>
                  <div className={styles.rosterRow}>
                    <span className={styles.avatar}>AS</span>
                    <div>
                      <strong>Aarav Shah</strong>
                      <small>Player application</small>
                    </div>
                    <span className={styles.approved}>
                      <IconCheck size={16} /> Approved
                    </span>
                  </div>
                  <div className={styles.rosterRow}>
                    <span className={styles.avatar}>RM</span>
                    <div>
                      <strong>Riya Mehta</strong>
                      <small>Player application</small>
                    </div>
                    <span className={styles.approved}>
                      <IconCheck size={16} /> Approved
                    </span>
                  </div>
                  <div className={styles.rosterRow}>
                    <span className={styles.avatar}>NK</span>
                    <div>
                      <strong>Neel Kapoor</strong>
                      <small>Player application</small>
                    </div>
                    <span className={styles.pending}>To review</span>
                  </div>
                  <p className={styles.visualNote}>Example player pool</p>
                </div>
              </article>
              <article
                className={[styles.feature, styles.fixturesFeature].join(" ")}
                data-reveal
                data-spotlight
              >
                <span className={styles.iconTile}>
                  <IconCalendar size={24} weight="duotone" />
                </span>
                <p className={styles.cardOverline}>03 / GAME ON</p>
                <h3>
                  From squad lists
                  <br />
                  to match day.
                </h3>
                <p>Generate your fixtures, review the schedule and publish it for everyone.</p>
                <div className={styles.fixtureVisual} aria-label="Illustrative fixture">
                  <span>
                    MATCH 01 <i>FIXTURE PREVIEW</i>
                  </span>
                  <div>
                    <b>F</b>
                    <strong>Falcons</strong>
                    <small>VS</small>
                    <strong>Voyagers</strong>
                    <b>V</b>
                  </div>
                </div>
                <Link href="/help/fixtures">
                  Plan your fixtures <IconArrowRight size={16} />
                </Link>
              </article>
              <article
                className={[styles.feature, styles.recordsFeature].join(" ")}
                data-reveal
                data-spotlight
              >
                <div className={styles.featureCopy}>
                  <span className={styles.iconTile}>
                    <IconReceipt size={24} weight="duotone" />
                  </span>
                  <p className={styles.cardOverline}>04 / KEEP IT CLEAR</p>
                  <h3>
                    Less chasing.
                    <br />
                    More playing.
                  </h3>
                  <p>
                    Track collections, issue receipts and keep a clear record of the money coming
                    in.
                  </p>
                  <Link href="/help/receipts-and-exports">
                    Keep your books in order <IconArrowRight size={16} />
                  </Link>
                </div>
                <div className={styles.receiptVisual} aria-label="Illustrative receipt">
                  <span className={styles.receiptIcon}>
                    <IconReceipt size={24} />
                  </span>
                  <small>COLLECTION RECORDED</small>
                  <strong>
                    ₹2,500<span>.00</span>
                  </strong>
                  <hr />
                  <div>
                    <span>Team</span>
                    <b>Falcons</b>
                  </div>
                  <div>
                    <span>Receipt</span>
                    <b>#0001</b>
                  </div>
                  <p>
                    <IconCheck size={16} /> Clear. Recorded. Organized.
                  </p>
                  <small>EXAMPLE RECEIPT</small>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* TWO BANDS LEFT THIS PAGE (founder, 2026-09-19).
            The "₹0 / tournament" band restated the hero's own promise — the
            hero already says "Free during beta · No card required", which the
            content test pins — and then sent the reader to /pricing, which is
            the page that exists to say it properly. The FAQ band answered two
            questions out of a help centre holding sixteen articles and its own
            FAQ page. Both are one click away, from the header and from the
            footer, and the page a visitor lands on is shorter for it: on a
            phone it was eleven screens tall. */}
        <section id="final-cta" className={styles.finalCta} aria-labelledby="final-title">
          {/* THREE STEPS, as the strip the closing band stands on. They were a
              520px band of their own for three one-line steps, directly above
              this one; here they read as the path to the button below. */}
          <ol className={styles.ctaSteps} aria-label="Three steps to auction night">
            <li data-reveal>
              <span className={styles.ctaStepNum}>01</span>
              <span className={styles.ctaStepIcon} aria-hidden>
                <IconTrophy size={24} weight="duotone" />
              </span>
              <h3>Make it yours.</h3>
              <p>Choose your sport, create your tournament, add teams and set the rules.</p>
            </li>
            <li data-reveal>
              <span className={styles.ctaStepNum}>02</span>
              <span className={styles.ctaStepIcon} aria-hidden>
                <IconUsers size={24} weight="duotone" />
              </span>
              <h3>Bring your people.</h3>
              <p>
                Invite players to register and owners to join. Your auction pool comes together.
              </p>
            </li>
            <li data-reveal>
              <span className={styles.ctaStepNum}>03</span>
              <span className={styles.ctaStepIcon} aria-hidden>
                <IconGavel size={24} weight="duotone" />
              </span>
              <h3>Let the bidding begin.</h3>
              <p>Run the live auction, build the squads and get your tournament moving.</p>
            </li>
          </ol>
          <p className={styles.eyebrow}>YOUR SPORT. YOUR PEOPLE. YOUR MOMENT.</p>
          <h2 id="final-title">
            Let the games <span>begin.</span>
          </h2>
          {/*
            TWO DOORS, BECAUSE THE PEOPLE WHO REACH THE BOTTOM WANT DIFFERENT THINGS.

            The redesign kept only "Create your tournament" and dropped the
            closing secondary, which was the ONE link from this page into
            /schedule-demo — the booking calendar, the ICS invite, the reminder
            sweep and the whole admin demo desk behind it. An organizer who read
            the entire page and still wants to be shown it first had nowhere to
            go but the footer. The label and destination come from
            `LANDING.beta`, so the copy stays where every other marketing string
            lives and `content.test.ts` keeps checking the href resolves.
          */}
          <div className={styles.actions}>
            <Link className={styles.primary} href={SIGNUP.href} data-track="final:signup">
              {SIGNUP.label} <IconArrowRight size={20} />
            </Link>
            <Link
              className={styles.secondary}
              href={LANDING.beta.ctaSecondary.href}
              data-track="final:demo"
            >
              <IconCalendar size={16} /> {LANDING.beta.ctaSecondary.label}
            </Link>
          </div>
          {/* The last doubts before signing up, answered with things the
              platform verifiably does (the FAQ band left this page on purpose;
              these are three facts, not a FAQ). No export claim: no screen
              reaches the exporter yet. */}
          <ul className={styles.reassure} aria-label="Before you start">
            <li>
              <IconCheck size={16} /> No app to install
            </li>
            <li>
              <IconCheck size={16} /> Big screen from any browser
            </li>
            <li>
              <IconCheck size={16} /> Every bid checked on the server
            </li>
          </ul>
          <p>
            Built for the people who bring people together.{" "}
            <Link href="/help/getting-started">Read the getting-started guide</Link>
          </p>
        </section>
        {/* Inside <main> so it inherits the floodlight theme. */}
        <StickyCta href={SIGNUP.href} label={SIGNUP.label} />
      </main>
    </HomeMotion>
  );
}
