import { SPORTS } from "@desiauction/core";
import Image from "next/image";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";

import { LANDING } from "../../content/marketing";
import { publicCompetitionsDirectory, type DirectoryEntry } from "../../server/competition/public";
import { formatDateRange } from "../../app/c/format";
import { thumbInitials } from "../public/tournament-card";
import styles from "../../app/home.module.css";
import { Glyph, type GlyphName } from "./home/glyphs";

/** How many real tournaments the landing names. Three, to match its trios. */
const STRIP_SIZE = 3;

/**
 * THE SHOP WINDOW HAS A BAR.
 *
 * This is the page's only unsimulated proof, and it was showing whatever sat at
 * the top of the directory — which on any real deployment includes seasons
 * somebody published and then abandoned, and on a developer's machine meant
 * three rows reading "NIGHT CC 11912016" with two players between them.
 * Nothing costs a first impression more than obviously empty data in the
 * section whose whole job is to say "this is real".
 *
 * A season with no squad is not evidence. Eight is roughly the smallest number
 * that reads as a tournament rather than a test — and the /c directory is
 * deliberately NOT filtered, because an organizer's own published season must
 * always appear there, however small it is on its first day.
 */
const MIN_PLAYERS_TO_FEATURE = 8;

/**
 * The landing page's only database read — ONE query per request, shared by the
 * ticker and the proof section through React's `cache`.
 *
 * The home page must render when Postgres is down — that was a P0 defect on
 * this very page (a shell-level session lookup took `GET /` to a 500), and this
 * read would reintroduce it verbatim if it were allowed to throw. So it is
 * wrapped the way apps/web/src/app/layout.tsx wraps its own: `unstable_rethrow`
 * first, so Next's control-flow signals pass through untouched; then a log, so
 * a real outage still announces itself; then an empty list, which every caller
 * renders as nothing at all.
 */
export const liveTournaments = cache(async (): Promise<DirectoryEntry[]> => {
  try {
    const directory = await publicCompetitionsDirectory({ page: 1 });
    return directory.entries
      .filter((entry) => entry.playerCount >= MIN_PLAYERS_TO_FEATURE)
      .slice(0, STRIP_SIZE);
  } catch (error) {
    unstable_rethrow(error);
    // `no-console` is on for apps/web; this is the same deliberate exception the
    // root layout makes. The visitor is shown nothing, so stderr is the only
    // place the failure can surface at all.
    // eslint-disable-next-line no-console
    console.error("[landing] tournament directory unavailable; hiding the strip", error);
    return [];
  }
});

const sportName = (key: string): string => SPORTS.find((sport) => sport.key === key)?.label ?? key;

/** The gold ticker under the hero: real leagues first, then what is always true. */
export async function LiveTicker({ sportCount }: { sportCount: number }) {
  const entries = await liveTournaments();
  const items = [
    ...entries.map(
      (entry) =>
        `${entry.name} · ${entry.location ?? entry.orgName} · ${String(entry.playerCount)} players · ${String(entry.teamCount)} teams`,
    ),
    `${String(sportCount)} sports`,
    SPORTS.map((sport) => sport.label).join(" · "),
    "Free during beta",
    "No app to install",
  ];
  const run = (
    <>
      {entries.length > 0 ? <span>● Live on DesiAuction</span> : null}
      {items.map((item) => (
        <span key={item}>
          {item.toUpperCase()}
          <span aria-hidden="true"> ◆</span>
        </span>
      ))}
    </>
  );
  return (
    <div className={styles.ticker}>
      <p className={styles.srOnly}>{items.join(". ")}.</p>
      {/* Twice, so the loop's seam never shows; the copy is for eyes only. */}
      <div className={styles.tickRun} aria-hidden="true">
        {run}
        {run}
      </div>
    </div>
  );
}

const FACTS: readonly { glyph: GlyphName; title: string; text: string }[] = [
  {
    glyph: "shield",
    title: "Every bid checked on the server.",
    text: "Against the purse, the squad size and the clock — before anyone sees it.",
  },
  {
    glyph: "gavel",
    title: "One gavel per auction.",
    text: "A single engine runs each room, so no player is ever sold twice.",
  },
  {
    glyph: "replay",
    title: "Every lot, replayable.",
    text: "The whole night is kept bid by bid — settle any argument in a tap.",
  },
  {
    glyph: "paddle",
    title: "Sports and scoring, yours.",
    text: "Cricket to battle royale, each with its own roles — in rupees, or points for leagues that play for glory.",
  },
];

/**
 * REAL, AND BUILT TO HOLD. The real tournaments (when there are any worth
 * showing) and the four things the engine guarantees. With no data the facts
 * still stand; the heading stops claiming a league it cannot show.
 */
export async function LiveProof() {
  const entries = await liveTournaments();
  const [featured, ...others] = entries;
  return (
    <section className={styles.proof} aria-labelledby="proof-title">
      <div className={[styles.wrap, styles.proofIn].join(" ")}>
        <div className={[styles.head, styles.reveal].join(" ")}>
          <p className={styles.kicker}>
            {featured === undefined ? null : (
              <span className={[styles.dot, styles.dotGreen].join(" ")} aria-hidden="true" />
            )}
            {featured === undefined ? "Built to hold" : "Real, and built to hold"}
          </p>
          <h2 id="proof-title" className={[styles.display, styles.title].join(" ")}>
            {featured === undefined
              ? "Built for the night it matters."
              : entries.length > 1
                ? "Not a demo. Real leagues."
                : "Not a demo. A real league."}
          </h2>
        </div>
        {featured === undefined ? null : (
          <Link
            href={`/c/${featured.slug}`}
            className={[styles.card, styles.lift, styles.featured, styles.reveal].join(" ")}
          >
            <div className={styles.featuredArt}>
              <span className={styles.featuredLogo}>
                {featured.logoUrl === null || featured.logoUrl === "" ? (
                  thumbInitials(featured.name)
                ) : (
                  <Image src={featured.logoUrl} alt="" width={110} height={110} />
                )}
              </span>
            </div>
            <div className={styles.featuredBody}>
              <span className={styles.cap}>
                {sportName(featured.sport)}
                {featured.startsOn === null
                  ? ""
                  : ` · ${formatDateRange(featured.startsOn, featured.endsOn)}`}
              </span>
              <span className={styles.display} style={{ fontSize: 40, lineHeight: "44px" }}>
                {featured.name}
              </span>
              <span style={{ fontSize: 15, color: "var(--soft)" }}>
                {featured.orgName}
                {featured.location === null ? "" : ` · ${featured.location}`}
              </span>
            </div>
            <div className={styles.featuredStats}>
              <div>
                <strong className={styles.num}>{featured.playerCount}</strong>
                <span className={styles.cap}>players</span>
              </div>
              <div>
                <strong className={styles.num}>{featured.teamCount}</strong>
                <span className={styles.cap}>teams</span>
              </div>
            </div>
          </Link>
        )}
        {others.length === 0 ? null : (
          <div className={styles.others}>
            {others.map((entry) => (
              <Link
                key={entry.slug}
                href={`/c/${entry.slug}`}
                className={[styles.card, styles.lift, styles.other].join(" ")}
              >
                <span>
                  <b style={{ color: "var(--ink)" }}>{entry.name}</b>
                  <br />
                  <span style={{ fontSize: 14, color: "var(--soft)" }}>{entry.orgName}</span>
                </span>
                <span className={styles.cap}>
                  {entry.playerCount} players · {entry.teamCount} teams
                </span>
              </Link>
            ))}
          </div>
        )}
        <ul className={styles.trust} style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {FACTS.map((fact) => (
            <li
              key={fact.title}
              className={[styles.card, styles.lift, styles.fact, styles.reveal].join(" ")}
            >
              <span className={styles.tile}>
                <Glyph name={fact.glyph} />
              </span>
              <strong>{fact.title}</strong>
              <p>{fact.text}</p>
            </li>
          ))}
        </ul>
        <Link
          className={[styles.textLink, styles.reveal].join(" ")}
          href={LANDING.live.cta.href}
          style={{ justifySelf: "start" }}
        >
          {LANDING.live.cta.label} →
        </Link>
      </div>
    </section>
  );
}
