import { Badge, ButtonLink, Card, SectionHeader, IconArrowRight } from "@desiauction/ui";
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

function readiness(season: ConductedSeason): { label: string; tone: Tone } {
  if (season.auctionStatus === null) {
    // The organizer has not built the auction yet. Saying so is the useful
    // thing: it tells the auctioneer the delay is not theirs to fix.
    return { label: "Not set up yet", tone: "neutral" };
  }
  if (LIVE.has(season.auctionStatus)) {
    return { label: season.auctionStatus === "paused" ? "Paused" : "Live now", tone: "danger" };
  }
  if (OVER.has(season.auctionStatus)) {
    return { label: "Finished", tone: "success" };
  }
  return { label: "Ready", tone: "info" };
}

/** "2026-03-14T18:30" → "14 Mar". Null where the organizer has set no date. */
function when(startsOn: string | null): string | null {
  if (startsOn === null) return null;
  const parsed = new Date(startsOn.length <= 10 ? `${startsOn}T00:00` : startsOn);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function Row({ season }: { season: ConductedSeason }) {
  const state = readiness(season);
  const date = when(season.startsOn);
  return (
    <li>
      <Link href={`/seasons/${season.competitionSlug}/auction`} className="home-attn">
        <span className="home-crest home-crest--sm" aria-hidden>
          {monogram(season.competitionName)}
        </span>
        <span className="home-attn-text">
          <strong>{season.competitionName}</strong>
          <span>{date === null ? "No date set" : date}</span>
        </span>
        <Badge tone={state.tone}>{state.label}</Badge>
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
        <>
          <SectionHeader title={tonight === null ? "Your auction nights" : "Also coming up"} />
          <Card data-testid="home-conduct-queue">
            <ul className="home-list">
              {queue.map((season) => (
                <Row key={season.competitionSlug} season={season} />
              ))}
            </ul>
          </Card>
        </>
      ) : null}

      {done.length > 0 ? (
        <>
          <SectionHeader title="Nights you've run" />
          <Card data-testid="home-conduct-record">
            <ul className="home-list">
              {done.map((season) => (
                <Row key={season.competitionSlug} season={season} />
              ))}
            </ul>
          </Card>
        </>
      ) : null}
    </>
  );
}
