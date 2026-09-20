import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { SPORTS } from "@desiauction/core";
import { env } from "../env";
import { LANDING } from "../content/marketing";
import { LiveTournaments } from "../components/marketing/live-tournaments";
import { LandingVoices } from "../components/marketing/landing-voices";
import { AuctionLab, HomeMotion } from "../components/marketing/guest-home";
import {
  IconArrowRight,
  IconCalendar,
  IconCheck,
  IconGavel,
  IconPlay,
  IconReceipt,
  IconTrophy,
  IconTv,
  IconUsers,
} from "../components/marketing/icons";
import styles from "./guest-home.module.css";
import "./marketing.css";

const description =
  "Your sport. Your players. Your tournament. Bring registration, live player auctions, teams and fixtures together with DesiAuction. Free during beta.";
export const metadata: Metadata = {
  title: "DesiAuction — Great teams start here",
  description,
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/` },
  openGraph: {
    title: "DesiAuction — Great teams start here",
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

export default function LandingPage() {
  return (
    <HomeMotion>
      <main className={styles.home} data-theme="floodlight">
        <section className={styles.hero} aria-labelledby="hero-title">
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
                <span className={styles.goldLine} /> EVERY SPORT. ONE STAGE.
              </p>
              <h1 id="hero-title">
                Great teams
                <br />
                <span>start here.</span>
              </h1>
              <p className={styles.heroLead}>
                Turn a group of players into a tournament
                <br className={styles.desktopBreak} /> everyone wants to be part of.
              </p>
              <p className={styles.heroSub}>
                Player registrations. Live auctions. Ready-to-play squads.
                <br className={styles.desktopBreak} /> One home for the game you love.
              </p>
              <div className={styles.actions}>
                <Link className={styles.primary} href="/login">
                  Create your tournament <IconArrowRight size={18} />
                </Link>
                <a className={styles.secondary} href="#playground">
                  <IconPlay size={15} /> Try a live demo
                </a>
              </div>
              <p className={styles.microcopy}>
                <IconCheck size={14} /> Free during beta <span>·</span> No card required
              </p>
            </div>
            <div className={styles.heroCaption}>
              <span>THE GAME CHANGES.</span>
              <strong>The passion stays.</strong>
              <span className={styles.captionLine} />
            </div>
          </div>
          <div className={styles.heroFoot}>
            <div>
              <IconUsers size={20} />
              <span>Bring your players</span>
            </div>
            <i aria-hidden="true" />
            <div>
              <IconGavel size={20} />
              <span>Build your dream teams</span>
            </div>
            <i aria-hidden="true" />
            <div>
              <IconTrophy size={20} />
              <span>Make it a tournament</span>
            </div>
            <a href="#playground" aria-label="Explore the sports and auction demo">
              EXPLORE <span aria-hidden="true">↓</span>
            </a>
          </div>
        </section>

        <AuctionLab sports={sports} />

        <section id="features" className={styles.toolkit} aria-labelledby="toolkit-title">
          <div className={styles.container}>
            <div className={styles.sectionHeading} data-reveal>
              <div>
                <p className={styles.eyebrow}>BIG TOURNAMENT ENERGY. LESS ADMIN.</p>
                <h2 id="toolkit-title">
                  You bring the passion.
                  <br />
                  <span>We bring the playbook.</span>
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
                A big idea.
                <br />
                <span>Three simple moves.</span>
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

        <Suspense fallback={null}>
          <LiveTournaments />
        </Suspense>

        {/* FR-1: real, permitted quotes — absent until there is one, and absent
            when the database is (same guard as the strip above). */}
        <Suspense fallback={null}>
          <LandingVoices />
        </Suspense>

        {/* TWO BANDS LEFT THIS PAGE (founder, 2026-09-19).
            The "₹0 / tournament" band restated the hero's own promise — the
            hero already says "Free during beta · No card required", which the
            content test pins — and then sent the reader to /pricing, which is
            the page that exists to say it properly. The FAQ band answered two
            questions out of a help centre holding sixteen articles and its own
            FAQ page. Both are one click away, from the header and from the
            footer, and the page a visitor lands on is shorter for it: on a
            phone it was eleven screens tall. */}
        <section className={styles.finalCta} aria-labelledby="final-title">
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
            <Link className={styles.primary} href="/login">
              Create your tournament <IconArrowRight size={18} />
            </Link>
            <Link className={styles.secondary} href={LANDING.beta.ctaSecondary.href}>
              <IconCalendar size={15} /> {LANDING.beta.ctaSecondary.label}
            </Link>
          </div>
          <p>Built for the people who bring people together.</p>
        </section>
      </main>
    </HomeMotion>
  );
}
