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
                  {SIGNUP.label} <IconArrowRight size={18} />
                </Link>
                {/* Scrolls to the auction card itself, not the section top:
                    on a phone the sport picker sat between the click and the
                    thing the button promised. */}
                <a className={styles.secondary} href="#demo-auction" data-track="hero:mock">
                  <IconGavel size={15} /> Try a mock auction
                </a>
              </div>
              <p className={styles.microcopy}>
                <IconCheck size={14} /> Free during beta <span>·</span> No card required
              </p>
              {/* Many visitors arrive from a shared registration link: they
                  are players looking for a tournament, not organizers. */}
              <p className={styles.playerPath}>
                Playing, not organizing?{" "}
                <Link href="/c" data-track="hero:browse">
                  Find a tournament <IconArrowRight size={14} />
                </Link>
              </p>
            </div>
          </div>
          {/* WHAT A VISITOR CAN CHECK. This strip used to repeat the page's
              three steps (they also sit under "How it works" below). It now
              carries capabilities the platform verifiably has today — the
              marketing no-fabrication rule applies: no counts, no customers. */}
          <ul className={styles.heroFoot} aria-label="What you get">
            <li>
              <IconGavel size={20} />
              <span>Owners bid from their phones</span>
            </li>
            <li>
              <IconTv size={20} />
              <span>Big-screen view for the room</span>
            </li>
            <li>
              <IconTrophy size={20} />
              <span>{sports.length} sports supported</span>
            </li>
            <li>
              <IconCheck size={20} />
              {/* "Free during beta" raises "and after?"; pricing answers it. */}
              <Link href="/pricing" data-track="facts:pricing">
                Beta tournaments stay free
              </Link>
            </li>
          </ul>
        </section>

        <AuctionLab sports={sports} signupHref={SIGNUP.href} signupLabel={SIGNUP.label} />

        {/* THE REAL PRODUCT. Every other picture on this page is an
            illustration or a simulation; these are screenshots of the platform
            itself, captured from a practice auction run end to end on it
            (fictional names apart from the featured player — the caption says so). The only proof a product
            with no public customers yet can honestly show is itself working. */}
        <section className={styles.realProduct} aria-labelledby="real-title">
          <div className={styles.container}>
            <div className={styles.realHeading} data-reveal>
              <p className={styles.eyebrow}>NOT A MOCKUP</p>
              <h2 id="real-title">
                This is auction night
                <br />
                <span>on DesiAuction.</span>
              </h2>
              <p>
                Real screens from a practice auction on the platform. Owners bid from their phones,
                the big screen keeps score, and every screen sees the gavel fall at the same moment.
              </p>
            </div>
            <div className={styles.realGrid}>
              <figure className={styles.realPhone} data-reveal>
                <Image
                  src="/marketing/product/owner-phone-bidding-v2.webp"
                  alt="A team owner's phone during a live lot: Aniket Sawant on the block, a 26-second countdown, Voyagers leading at ₹80,000 and a Raise to ₹85,000 button"
                  width={560}
                  height={1212}
                  sizes="(max-width: 767px) 45vw, 260px"
                />
                <figcaption>The owner&rsquo;s phone. One tap to raise.</figcaption>
              </figure>
              <figure className={styles.realScreen} data-reveal>
                <Image
                  src="/marketing/product/auction-board-v2.webp"
                  alt="The big-screen board of a live auction: ₹1,60,000 spent on 5 players, Aniket Sawant the most expensive at ₹85,000, and each team's remaining purse and squad"
                  width={1600}
                  height={900}
                  sizes="(max-width: 767px) 100vw, 640px"
                />
                <figcaption>The big screen. Purses, squads and every sale, live.</figcaption>
              </figure>
              <figure className={styles.realPhone} data-reveal>
                <Image
                  src="/marketing/product/owner-phone-sold-v2.webp"
                  alt="The same phone as the gavel falls: a SOLD stamp, Aniket Sawant signed to Falcons for ₹85,000, and a notification reading You signed Aniket Sawant"
                  width={560}
                  height={933}
                  sizes="(max-width: 767px) 45vw, 260px"
                />
                <figcaption>SOLD. On every screen at once.</figcaption>
              </figure>
            </div>
            <p className={styles.realNote}>
              Screenshots from a practice auction on DesiAuction. Teams and owners are fictional.
            </p>
          </div>
        </section>

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
              <article className={[styles.feature, styles.registration].join(" ")} data-reveal>
                <div className={styles.featureCopy}>
                  <span className={styles.iconTile}>
                    <IconUsers size={23} />
                  </span>
                  <p className={styles.cardOverline}>01 / GET EVERYONE IN</p>
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
                    <IconUsers size={17} />
                  </div>
                  <div className={styles.rosterRow}>
                    <span className={styles.avatar}>AS</span>
                    <div>
                      <strong>Aarav Shah</strong>
                      <small>Player application</small>
                    </div>
                    <span className={styles.approved}>
                      <IconCheck size={12} /> Approved
                    </span>
                  </div>
                  <div className={styles.rosterRow}>
                    <span className={styles.avatar}>RM</span>
                    <div>
                      <strong>Riya Mehta</strong>
                      <small>Player application</small>
                    </div>
                    <span className={styles.approved}>
                      <IconCheck size={12} /> Approved
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
              <article className={[styles.feature, styles.screenFeature].join(" ")} data-reveal>
                <span className={styles.iconTile}>
                  <IconTv size={23} />
                </span>
                <p className={styles.cardOverline}>02 / OWN THE ROOM</p>
                <h3>
                  Small screen.
                  <br />
                  Big moment.
                </h3>
                <p>Owners bid from their phones. The room follows on the big screen.</p>
                <div className={styles.deviceVisual} aria-hidden="true">
                  <div className={styles.monitor}>
                    <span>THE WINNING MOMENT</span>
                    <strong>
                      SOLD<span>!</span>
                    </strong>
                    <small>YOUR NEXT TEAMMATE</small>
                  </div>
                  <div className={styles.phone}>
                    <IconGavel size={21} />
                    <span>YOUR BID</span>
                    <strong>₹35,000</strong>
                    <i>
                      <IconCheck size={13} />
                    </i>
                  </div>
                </div>
                <Link href="/help/screens-for-the-room">
                  Set the stage <IconArrowRight size={16} />
                </Link>
              </article>
              <article className={[styles.feature, styles.fixturesFeature].join(" ")} data-reveal>
                <span className={styles.iconTile}>
                  <IconCalendar size={23} />
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
              <article className={[styles.feature, styles.recordsFeature].join(" ")} data-reveal>
                <div className={styles.featureCopy}>
                  <span className={styles.iconTile}>
                    <IconReceipt size={23} />
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
                    <IconReceipt size={26} />
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
                    <IconCheck size={14} /> Clear. Recorded. Organized.
                  </p>
                  <small>EXAMPLE RECEIPT</small>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.journey} aria-labelledby="journey-title">
          <div className={styles.container}>
            <div className={styles.journeyIntro} data-reveal>
              <p className={styles.eyebrow}>FROM “LET’S PLAY” TO GAME DAY</p>
              <h2 id="journey-title">
                {/* "from sign-up" hyphen-broke across three lines at phone widths;
                    the shorter line keeps the two-line rhythm everywhere. */}
                Three steps
                <br />
                <span>to auction night.</span>
              </h2>
              <Link className={styles.textLink} href="/help/getting-started">
                Your getting-started guide <IconArrowRight size={17} />
              </Link>
            </div>
            <ol className={styles.steps}>
              <li data-reveal>
                <span>01</span>
                <div>
                  <h3>Make it yours.</h3>
                  <p>Choose your sport. Create your tournament, add teams and set the rules.</p>
                </div>
                <IconTrophy size={24} />
              </li>
              <li data-reveal>
                <span>02</span>
                <div>
                  <h3>Bring your people.</h3>
                  <p>
                    Invite players to register and owners to join. Your auction pool comes together.
                  </p>
                </div>
                <IconUsers size={24} />
              </li>
              <li data-reveal>
                <span>03</span>
                <div>
                  <h3>Let the bidding begin.</h3>
                  <p>Run the live auction, build the squads and get your tournament moving.</p>
                </div>
                <IconGavel size={24} />
              </li>
            </ol>
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
              {SIGNUP.label} <IconArrowRight size={18} />
            </Link>
            <Link
              className={styles.secondary}
              href={LANDING.beta.ctaSecondary.href}
              data-track="final:demo"
            >
              <IconCalendar size={15} /> {LANDING.beta.ctaSecondary.label}
            </Link>
          </div>
          {/* The last doubts before signing up, answered with things the
              platform verifiably does (the FAQ band left this page on purpose;
              these are three facts, not a FAQ). No export claim: no screen
              reaches the exporter yet. */}
          <ul className={styles.reassure} aria-label="Before you start">
            <li>
              <IconCheck size={14} /> No app to install
            </li>
            <li>
              <IconCheck size={14} /> Big screen from any browser
            </li>
            <li>
              <IconCheck size={14} /> Every bid checked on the server
            </li>
          </ul>
          <p>Built for the people who bring people together.</p>
        </section>
        {/* Inside <main> so it inherits the floodlight theme. */}
        <StickyCta href={SIGNUP.href} label={SIGNUP.label} />
      </main>
    </HomeMotion>
  );
}
