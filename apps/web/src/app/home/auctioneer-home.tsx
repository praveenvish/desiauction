import {
  ButtonLink,
  IconArrowRight,
  IconBroadcast,
  IconCalendar,
  IconCheckCircle,
  IconGavel,
  IconList,
  IconTile,
  ListRow,
  Pill,
  SectionCard,
  VisuallyHidden,
} from "@desiauction/ui";
import Link from "next/link";

import { conductSetup, type ConductedSeason } from "../../server/roles/roles";
import { monogram, type Tone } from "./home-parts";
import "./home-duo.css";
import { formatDate, formatShortDate, istCalendarDate } from "../../lib/format-date";

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

/**
 * The season's start date, said AS the season's start. Null where the
 * organizer has set no date.
 *
 * `startsOn` is when the season begins, not when its auction night is — the
 * product holds no separate night date. This line used to call it the night
 * and say "Date passed · 1 Aug 2026 — check with the organizer" while /auctions
 * printed the same season as "1 Aug – 31 Oct 2026", running (round 2). Both now
 * say the season's dates: "Season starts 3 Oct", "Season began 1 Aug", and a
 * finished night keeps its plain date. The year shows outside this one.
 */
export function nightDate(startsOn: string | null, over: boolean, now = new Date()): string | null {
  if (startsOn === null) return null;
  const day = startsOn.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const today = istCalendarDate(now);
  const label = day.slice(0, 4) === today.slice(0, 4) ? formatShortDate(day) : formatDate(day);
  if (over) return label;
  return day < today ? `Season began ${label}` : `Season starts ${label}`;
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
          {/* Not built yet: the row says whose move it is, not a season date
              beside "Not set up yet" (round 5: "Season began 1 Aug" read as
              an alarm the auctioneer could do nothing about). */}
          <span>
            {season.auctionStatus === null
              ? "Waiting on the organizer's setup"
              : date === null
                ? "No date set"
                : date}
          </span>
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
        // Each card its own height when the queue is a bare row (review r3);
        // with the setup steps under it the two stand level (round 5).
        <div
          className={
            queue[0] !== undefined && queue[0].auctionStatus === null
              ? "hd-duo"
              : "hd-duo hd-duo--start"
          }
        >
          <SectionCard
            data-testid="home-conduct-queue"
            icon={<IconCalendar />}
            concept="fixtures"
            title={tonight === null ? "Your auction nights" : "Also coming up"}
            description={`${String(queue.length)} in the queue`}
          >
            <ul className="home-list">
              {queue.map((season) => (
                <Row key={season.competitionSlug} season={season} />
              ))}
            </ul>
            {queue[0] !== undefined && queue[0].auctionStatus === null ? (
              <SetupSteps season={queue[0]} />
            ) : null}
          </SectionCard>
          <NightKit season={queue[0] ?? null} />
        </div>
      ) : null}

      {done.length > 0 ? (
        <SectionCard
          data-testid="home-conduct-record"
          icon={<IconCheckCircle />}
          concept="done"
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

/**
 * WHAT HAS TO HAPPEN FIRST (round 5), COUNTED (2026-09-29). The three things
 * the organizer builds before the cockpit opens used to be fixed text that
 * never ticked — it could not tell the auctioneer whether the night was a week
 * of work away or one paddle. Each step now reads the organizer's setup
 * (counts only; see `conductSetup`) and says where it stands. Still said as
 * the organizer's list, not the auctioneer's chores.
 */
export async function SetupSteps({ season }: { season: ConductedSeason }) {
  const setup = await conductSetup(season.competitionId);
  const steps = [
    {
      label: "The teams and their owners",
      done: setup.teams > 0,
      fact:
        setup.teams > 0 ? `${String(setup.teams)} ${setup.teams === 1 ? "team" : "teams"}` : null,
    },
    {
      label: "The auction — its purse and rules",
      done: setup.auctionBuilt,
      fact: null,
    },
    {
      label: "The pool of players, as lots",
      done: setup.lots > 0,
      fact: setup.lots > 0 ? `${String(setup.lots)} ${setup.lots === 1 ? "lot" : "lots"}` : null,
    },
    {
      label: "A paddle for each team",
      done: setup.teams > 0 && setup.paddles >= setup.teams,
      fact:
        setup.auctionBuilt && setup.teams > 0
          ? `${String(Math.min(setup.paddles, setup.teams))} of ${String(setup.teams)}`
          : null,
    },
  ];
  const done = steps.filter((step) => step.done).length;
  const current = steps.findIndex((step) => !step.done);
  return (
    <div className="home-setup" data-testid="home-conduct-setup">
      <p className="home-setup-title">
        Before the cockpit opens, the organizer adds
        <span className="home-setup-count">
          {String(done)} of {String(steps.length)} done
        </span>
      </p>
      <ol className="home-setup-list home-setup-list--counted">
        {steps.map((step, index) => (
          <li
            key={step.label}
            data-state={step.done ? "done" : index === current ? "current" : "todo"}
          >
            <span className="home-setup-mark" aria-hidden>
              {step.done ? <IconCheckCircle size={16} /> : String(index + 1)}
            </span>
            <span className="home-setup-label">
              {step.label}
              <VisuallyHidden>
                {step.done ? " — done" : index === current ? " — next" : " — to do"}
              </VisuallyHidden>
            </span>
            {step.fact !== null ? <span className="home-setup-fact">{step.fact}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * THE SECOND OBJECT (round 3C). The auctioneer's home ended after one queue
 * row and left half a laptop blank. Beside the queue: the two rooms they will
 * work in on the night, as doors once the auction exists — the cockpit where
 * each lot is called, and the big screen for the venue. Before the organizer
 * builds the auction, each says when it opens instead of linking to nothing.
 */
function NightKit({ season }: { season: ConductedSeason | null }) {
  if (season === null) return null;
  const built = season.auctionStatus !== null;
  const base = `/seasons/${season.competitionSlug}/auction`;
  return (
    <SectionCard
      data-testid="home-conduct-kit"
      // The cockpit row below carries the gavel; the card's own mark is the
      // night's checklist, so one glyph is not said twice (review r3).
      icon={<IconList />}
      concept="auction"
      title="On the night"
      description={season.competitionName}
    >
      <ul className="home-kit">
        <li>
          <ListRow
            lead={<IconTile icon={<IconGavel />} concept="auction" size="sm" />}
            title="The cockpit"
            meta={
              built
                ? "Put each lot on the block, and hold to close the sale"
                : "Opens once the organizer builds the auction"
            }
            {...(built ? { href: `${base}/cockpit`, linkComponent: Link } : {})}
          />
        </li>
        <li>
          <ListRow
            lead={<IconTile icon={<IconBroadcast />} concept="auction" size="sm" />}
            title="The big screen"
            meta={
              built
                ? "Put the live board on the venue's TV"
                : "The venue board, ready when the auction is"
            }
            {...(built ? { href: `${base}/board`, linkComponent: Link } : {})}
          />
        </li>
      </ul>
    </SectionCard>
  );
}
