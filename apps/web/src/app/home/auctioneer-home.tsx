import {
  ButtonLink,
  IconArrowRight,
  IconCalendar,
  IconCheckCircle,
  Pill,
  SectionCard,
} from "@desiauction/ui";
import Link from "next/link";

import type { ConductedSeason } from "../../server/roles/roles";
import { monogram, type Tone } from "./home-parts";

/**
 * THE AUCTIONEER'S HOME — and before RN-1 there was no such surface at all.
 *
 * `roles.conducts` has always been an ARRAY. The shell took `[0]` and /home
 * showed one banner, so somebody appointed to run four nights across three
 * clubs could see exactly one of them and had no record of the rest. There was
 * nowhere in the product that answered "what am I running, and what have I
 * run" — which is the whole of this person's relationship with the platform.
 *
 * Its one job (RN-1 §0): run tonight. So the page is Tonight, then the queue,
 * then the record — urgency, then commitment, then history.
 *
 * Deliberately no figures beyond status. A conductor holds `auction.conduct`
 * and nothing else: not registrations, not money, not the club's books. A
 * "total spend" column here would be the roster-and-money leak all over again,
 * arriving through the back door of a résumé.
 */

const OVER = new Set(["completed", "reconciled"]);
const LIVE = new Set(["live", "paused"]);

function readiness(season: ConductedSeason): { label: string; tone: Tone; dot?: boolean } {
  if (season.auctionStatus === null) {
    // The organizer has not built the auction yet. Saying so is the useful
    // thing: it tells the auctioneer the delay is not theirs to fix.
    return { label: "Not set up yet", tone: "neutral" };
  }
  if (LIVE.has(season.auctionStatus)) {
    return season.auctionStatus === "paused"
      ? { label: "Paused", tone: "amber", dot: true }
      : { label: "Live now", tone: "red", dot: true };
  }
  if (OVER.has(season.auctionStatus)) {
    return { label: "Finished", tone: "green" };
  }
  return { label: "Ready", tone: "blue" };
}

/** Today in India as "YYYY-MM-DD" — the seasons' dates are IST wall-clock. */
const IST_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * "2026-03-14T18:30" → "14 Mar" this year, "14 Mar 2025" in any other. Null
 * where the organizer has set no date.
 *
 * The year used to be dropped always, so a night still waiting in the queue
 * read "1 Aug" beside "Not set up yet" in late September — which August, and
 * is it coming or gone? A date in the past on a night that has not happened is
 * said plainly, with the one useful next step: it is the organizer's date, so
 * ask them. A finished night keeps its plain date; the past is where it belongs.
 */
export function nightDate(startsOn: string | null, over: boolean, now = new Date()): string | null {
  if (startsOn === null) return null;
  const day = startsOn.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = IST_DAY.format(now);
  const label = parsed.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
  });
  if (!over && day < today) {
    const full = parsed.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return `Date passed · ${full} — check with the organizer`;
  }
  return label;
}

function Row({ season }: { season: ConductedSeason }) {
  const state = readiness(season);
  const date = nightDate(season.startsOn, OVER.has(season.auctionStatus ?? ""));
  return (
    <li>
      <Link href={`/seasons/${season.competitionSlug}/auction`} className="home-row-link">
        <span className="home-crest" aria-hidden>
          {monogram(season.competitionName)}
        </span>
        <span className="home-row-text">
          <strong>{season.competitionName}</strong>
          <span>{date === null ? "No date set" : date}</span>
        </span>
        <Pill tone={state.tone} dot={state.dot === true}>
          {state.label}
        </Pill>
      </Link>
    </li>
  );
}

export function AuctioneerHome({ seasons }: { seasons: ConductedSeason[] }) {
  const tonight = seasons.find((season) => LIVE.has(season.auctionStatus ?? "")) ?? null;
  const queue = seasons.filter(
    (season) => season !== tonight && !OVER.has(season.auctionStatus ?? ""),
  );
  const done = seasons.filter((season) => OVER.has(season.auctionStatus ?? ""));

  return (
    <>
      {tonight !== null ? (
        <section
          className="home-live"
          aria-labelledby="home-conduct-name"
          data-testid="home-conduct-live"
        >
          <div className="home-live-body">
            <p className="home-live-kicker">
              <span className="home-live-badge">
                <i aria-hidden />
                YOU ARE RUNNING THIS
              </span>
            </p>
            <h2 id="home-conduct-name" className="home-live-name">
              {tonight.competitionName}
            </h2>
            <p>The room is waiting on the cockpit to put the next lot on the block.</p>
          </div>
          <ButtonLink
            href={`/seasons/${tonight.competitionSlug}/auction/cockpit`}
            data-testid="home-open-cockpit"
          >
            Open the cockpit
            <IconArrowRight size={16} className="icon-trail" />
          </ButtonLink>
        </section>
      ) : null}

      {queue.length > 0 ? (
        <SectionCard
          data-testid="home-conduct-queue"
          icon={<IconCalendar />}
          tone="blue"
          title={tonight === null ? "Your auction nights" : "Also coming up"}
          description={`${String(queue.length)} in the queue`}
        >
          <ul className="home-list">
            {queue.map((season) => (
              <Row key={season.competitionSlug} season={season} />
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {done.length > 0 ? (
        <SectionCard
          data-testid="home-conduct-record"
          icon={<IconCheckCircle />}
          tone="green"
          title="Nights you've run"
          description={`${String(done.length)} ${done.length === 1 ? "auction" : "auctions"} conducted`}
        >
          <ul className="home-list">
            {done.map((season) => (
              <Row key={season.competitionSlug} season={season} />
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </>
  );
}
