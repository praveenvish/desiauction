import {
  ButtonLink,
  EmptyState,
  IconCalendar,
  IconCheckCircle,
  IconGavel,
  IconGlobe,
  IconPin,
  IconPlay,
  IconTile,
  IconTrophy,
  IconWallet,
  type KitTone,
  Pill,
} from "@desiauction/ui";
import Link from "next/link";

import { compactINR } from "../../lib/inr";
import { moneyFormat } from "../../lib/money";
import type { AuctionNightStatus } from "../../server/console/auctions-index";
import {
  auctionsIndexView,
  type AuctionCardView,
  type AuctionsIndexView,
} from "../../server/console/views";
import { dateRange } from "../tournaments/season-card";
import { NavButton } from "../players/nav-button";
import "../players/players.css";
import { SquadsBySpend, spendNightOf } from "../../components/team/squads-by-spend";
import "./auctions.css";
import { formatCount } from "../../lib/plural";
import { formatDate } from "../../lib/format-date";
import { dateTile, doorLabel, nightSections, waitingLine } from "./auctions-model";
import { SetupSteps } from "../home/auctioneer-home";
import { currentSession } from "../../server/auth/actions";
import { rolesOf, type ConductedSeason } from "../../server/roles/roles";

export const metadata = { title: "Auctions · DesiAuction" };

const STATUS: Record<AuctionNightStatus, { label: string; tone: KitTone }> = {
  none: { label: "Not set up", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "neutral" },
  live: { label: "Live", tone: "green" },
  paused: { label: "Paused", tone: "amber" },
  completed: { label: "Completed", tone: "green" },
  settled: { label: "Settled", tone: "green" },
};

function count(value: number): string {
  return formatCount(value);
}

function nights(value: number): string {
  return value === 1 ? "1 night" : `${count(value)} nights`;
}

/**
 * What the spend tile covers. Rupees and points (0091) are never added: the
 * figure is the rupee total, and a points league's spend rides alongside it
 * (or is the figure, when every night this person runs counts in points).
 */
function spendHint(totals: AuctionsIndexView["totals"]): string {
  const points =
    totals.pointsSpend === undefined ? null : moneyFormat("points").compact(totals.pointsSpend);
  if (totals.spend === undefined) {
    return `Across ${nights(totals.pointsNights)} you run · points, not money`;
  }
  const base = `Across ${nights(totals.spendNights)} you run`;
  return points === null ? base : `${base} · plus ${points} in points leagues`;
}

/** The role chip beside a club's name: what this card is FOR. */
function RoleChip({ label }: { label: string }) {
  return <span className="ax-role">{label}</span>;
}

/** Lots sold of the pool, on one bar. */
function LotsBar({ sold, total }: { sold: number; total: number }) {
  const pct = total > 0 ? Math.round((sold / total) * 100) : 0;
  return (
    <span className="ax-bar" aria-hidden>
      <span className="ax-bar-fill" style={{ transform: `scaleX(${String(pct / 100)})` }} />
    </span>
  );
}

/**
 * A LIVE NIGHT — the one place this person should be right now, so it leads
 * the page as a dark band with its figures and ONE door for their role.
 */
function LiveNight({ card }: { card: AuctionCardView }) {
  const { lotsSold, lotsTotal, teams, moneyMoved, status } = card.facts;
  const [primary, ...rest] = card.links;
  const dates = dateRange(card.startsOn, card.endsOn);
  return (
    <section
      className="ax-live"
      data-theme="floodlight"
      data-testid={`auction-card-${card.slug}`}
      aria-labelledby={`ax-live-${card.slug}`}
    >
      <p className="ax-live-top">
        <span className="ax-live-badge" data-status={status}>
          <span className="ax-live-dot" aria-hidden />
          {status === "paused" ? "Paused" : "Live now"}
        </span>
        {[dates, card.location].filter((part) => part !== null && part !== "").join(" · ")}
      </p>
      <div className="ax-live-main">
        <div className="ax-live-id">
          <h2 id={`ax-live-${card.slug}`} className="ax-live-name">
            {card.seasonName}
          </h2>
          <p className="ax-live-org">
            {card.orgName} <RoleChip label={card.roleLabel} />
          </p>
        </div>
        <span className="ax-live-doors">
          {primary !== undefined ? (
            <ButtonLink href={primary.href} size="lg">
              <IconPlay size={18} aria-hidden />
              {doorLabel(primary, status)}
            </ButtonLink>
          ) : null}
          {rest.map((link) => (
            <Link key={link.label} href={link.href} className="ax-live-ghost">
              {doorLabel(link, status)}
            </Link>
          ))}
        </span>
      </div>
      <dl className="ax-live-figs">
        <div>
          <dt>lots sold</dt>
          <dd>
            {count(lotsSold)} of {count(lotsTotal)}
          </dd>
        </div>
        <div>
          <dt>still to go</dt>
          <dd>{count(Math.max(0, lotsTotal - lotsSold - card.facts.lotsUnsold))}</dd>
        </div>
        {moneyMoved !== undefined ? (
          <div>
            <dt>money moved</dt>
            <dd data-testid={`auction-money-${card.slug}`}>
              {moneyFormat(card.auctionUnit).compact(moneyMoved)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>teams bidding</dt>
          <dd>{count(teams)}</dd>
        </div>
      </dl>
      <LotsBar sold={lotsSold} total={lotsTotal} />
    </section>
  );
}

/** A night still to come: its date, and the one thing it is waiting for. */
function UpcomingNight({
  card,
  conducted = null,
}: {
  card: AuctionCardView;
  /** This reader's own conduct grant for the season, when that is why they see it. */
  conducted?: ConductedSeason | null;
}) {
  const status = STATUS[card.facts.status];
  const tile = dateTile(card.startsOn);
  const dates = dateRange(card.startsOn, card.endsOn);
  const line = waitingLine(card);
  const [primary] = card.links;
  const organizerFix = card.facts.status === "none" && primary?.label === "Setup";
  return (
    <article
      className="ax-card"
      data-status={card.facts.status}
      data-testid={`auction-card-${card.slug}`}
    >
      <header className="ax-head">
        {tile !== null ? (
          <span className="ax-date" aria-hidden>
            <span>{tile.month}</span>
            <b>{tile.day}</b>
          </span>
        ) : (
          <IconTile icon={<IconGavel weight="duotone" />} tone="gold" size="sm" />
        )}
        <div className="ax-titles">
          <h3 className="ax-title">
            <Link href={`/seasons/${card.slug}/auction`}>{card.seasonName}</Link>
          </h3>
          <p className="ax-org">
            {card.orgName}
            <RoleChip label={card.roleLabel} />
          </p>
        </div>
        <Pill tone={status.tone} dot testId={`auction-status-${card.slug}`}>
          {status.label}
        </Pill>
      </header>
      <ul className="ax-meta">
        {dates !== null ? (
          <li>
            <IconCalendar size={16} aria-hidden /> {dates}
          </li>
        ) : null}
        {card.location !== null && card.location !== "" ? (
          <li>
            <IconPin size={16} aria-hidden /> {card.location}
          </li>
        ) : null}
        <li>
          <IconTrophy size={16} aria-hidden />{" "}
          {card.facts.teams === 1 ? "1 team" : `${count(card.facts.teams)} teams`}
        </li>
      </ul>
      {/* The auctioneer waits on the organizer: the wait, counted (the same
          steps their home shows), not only "waiting on the organizer". */}
      {conducted !== null && card.facts.status === "none" ? (
        <SetupSteps season={conducted} />
      ) : null}
      <div className="ax-next">
        <p>
          <strong>{line.lead}</strong>
          {line.rest}
        </p>
        {primary !== undefined ? (
          <NavButton href={primary.href} variant={organizerFix ? "primary" : "secondary"} size="sm">
            {doorLabel(primary, card.facts.status)}
          </NavButton>
        ) : (
          <NavButton href={`/seasons/${card.slug}`} variant="secondary" size="sm">
            See the season
          </NavButton>
        )}
      </div>
    </article>
  );
}

/** A finished night as a row: how the pool went, what it cost, and its doors. */
function FinishedNight({ card }: { card: AuctionCardView }) {
  const status = STATUS[card.facts.status];
  const { lotsSold, lotsTotal, lotsUnsold, moneyMoved, topPrice } = card.facts;
  const money = moneyFormat(card.auctionUnit);
  return (
    <li className="ax-done" data-testid={`auction-card-${card.slug}`}>
      <span className="ax-done-id">
        <span className="ax-done-name">
          <Link href={`/seasons/${card.slug}/auction`}>{card.seasonName}</Link>
          <Pill tone={status.tone} testId={`auction-status-${card.slug}`}>
            {status.label}
          </Pill>
        </span>
        <span className="ax-org">
          {card.orgName}
          {card.startsOn !== null ? ` · ${formatDate(card.startsOn)}` : ""}
          <RoleChip label={card.roleLabel} />
        </span>
      </span>
      <span className="ax-done-lots">
        <span>
          <strong>{count(lotsSold)}</strong> of {count(lotsTotal)} sold
          {lotsUnsold > 0 ? <span className="ax-muted"> · {count(lotsUnsold)} unsold</span> : null}
        </span>
        <LotsBar sold={lotsSold} total={lotsTotal} />
      </span>
      {moneyMoved !== undefined ? (
        <span className="ax-done-money">
          <strong data-testid={`auction-money-${card.slug}`}>{money.compact(moneyMoved)}</strong>
          {topPrice !== undefined && topPrice !== null ? (
            <span>top {money.compact(topPrice)}</span>
          ) : null}
        </span>
      ) : (
        <span className="ax-done-money" aria-hidden />
      )}
      <span className="ax-done-doors">
        {card.links.map((link) => (
          <NavButton key={link.label} href={link.href} variant="secondary" size="sm">
            {link.label}
          </NavButton>
        ))}
      </span>
    </li>
  );
}

/**
 * /auctions — every auction night this person runs, conducts, owns a team in or
 * can watch, across their clubs. Money moved shows only where they hold money
 * sight (conduct or manage); see `server/console/auctions-index.ts`.
 */
export default async function AuctionsPage() {
  const [view, session] = await Promise.all([auctionsIndexView(), currentSession()]);
  // The seasons this reader was appointed to conduct, from their own grants.
  const conducts = session === null ? [] : (await rolesOf(session.personId)).conducts;
  const conductedBySlug = new Map(conducts.map((season) => [season.competitionSlug, season]));
  const { totals } = view;
  const sections = nightSections(view.cards);
  /*
   * "Upcoming" counts the nights still being set up as well as the scheduled
   * ones — /home's "1 in the queue" counts both, and the two pages disagreed
   * ("0 Upcoming") about the same single night.
   */
  const notSetUp = view.cards.filter((card) => card.facts.status === "none").length;
  const upcoming = totals.upcoming + notSetUp;
  /*
   * Whether the spend tile is this reader's to see at all. "Shown to
   * organizers and auctioneers" was printed to an auctioneer — true of them,
   * and so no explanation of the dash; for them the honest word is that
   * nothing has been sold yet.
   */
  const holdsMoneySight = view.cards.some(
    (card) => card.roleLabel === "Organizer" || card.roleLabel === "Auctioneer",
  );

  /*
   * THE PAGE DOES NOT END AFTER ONE CARD (round 4A). With only a night or two
   * the card grid stopped at y≈250 and the rest was canvas. The latest
   * finished night's squads-by-spend follows it — read through the hub's own
   * gated read (auctionDashboard), so a viewer without money sight gets no
   * figures and the block does not render.
   */
  const finishedCard =
    view.cards.length <= 3
      ? view.cards.find(
          (card) => card.facts.status === "completed" || card.facts.status === "settled",
        )
      : undefined;
  const spendNight =
    finishedCard === undefined
      ? null
      : await spendNightOf(finishedCard.slug, finishedCard.seasonName);

  if (view.cards.length === 0) {
    return (
      <main className="px-players">
        <section className="px-empty" data-testid="auctions-empty">
          <EmptyState
            icon={<IconGavel />}
            title="No auction nights yet"
            headingLevel={2}
            description={
              <>
                Auctions you run, conduct or bid in appear here — with the right door for your role:
                setup, the cockpit, the live room or your plan.
              </>
            }
            action={
              <>
                <NavButton href="/tournaments" variant="primary" size="touch">
                  <IconTrophy size={18} aria-hidden /> Go to tournaments
                </NavButton>
                <NavButton href="/c" variant="secondary" size="touch">
                  <IconGlobe size={18} aria-hidden /> Find tournaments
                </NavButton>
              </>
            }
          />
        </section>
      </main>
    );
  }

  return (
    <main className="px-players">
      {/* ONE LINE, not four tiles (wow pass). "0 Upcoming" and "0 Live now"
          took the fold to say nothing; a count appears here only when it is
          not zero, and the spend keeps its own quiet figure. */}
      <p className="ax-summary" data-testid="auctions-stats">
        {totals.live > 0 ? (
          <span className="ax-summary-item" data-tone="live">
            <span className="ax-live-dot" aria-hidden />
            <strong>{count(totals.live)}</strong> live now
          </span>
        ) : null}
        {upcoming > 0 ? (
          <span className="ax-summary-item">
            <IconCalendar size={16} aria-hidden />
            <strong>{count(upcoming)}</strong>{" "}
            {notSetUp === 0
              ? "upcoming"
              : notSetUp === upcoming
                ? "waiting to be set up"
                : `upcoming · ${count(notSetUp)} still being set up`}
          </span>
        ) : null}
        {totals.completed > 0 ? (
          <span className="ax-summary-item">
            <IconCheckCircle size={16} aria-hidden />
            <strong>{count(totals.completed)}</strong> finished
          </span>
        ) : null}
        {/* "₹0 spent" says nothing — an auctioneer whose nights have sold
            nothing yet sees the counts, not an empty money figure (r3). */}
        {(totals.spend ?? 0) === 0 &&
        (totals.pointsSpend ?? 0) === 0 &&
        (totals.spend !== undefined || totals.pointsSpend !== undefined) ? null : (
          <span
            className="ax-summary-item"
            data-testid="auctions-spend"
            title={
              totals.spend === undefined && totals.pointsSpend === undefined
                ? undefined
                : spendHint(totals)
            }
          >
            <IconWallet size={16} aria-hidden />
            {totals.spend === undefined && totals.pointsSpend === undefined ? (
              <span className="ax-muted">
                {holdsMoneySight
                  ? "Nothing sold yet"
                  : "Spend is shown to organizers and auctioneers"}
              </span>
            ) : (
              <span>
                <strong>
                  {totals.spend !== undefined
                    ? // rupees-always: the total adds rupee nights only; points are shown apart
                      compactINR(totals.spend)
                    : moneyFormat("points").compact(totals.pointsSpend ?? 0)}
                </strong>{" "}
                spent
              </span>
            )}
          </span>
        )}
      </p>

      <div className="ax-sections" data-testid="auctions-list">
        {sections.live.map((card) => (
          <LiveNight key={card.slug} card={card} />
        ))}
        {sections.upcoming.length > 0 ? (
          <section className="ax-section" aria-labelledby="ax-upcoming">
            <h2 id="ax-upcoming" className="ax-eyebrow">
              Coming up <span>· {nights(sections.upcoming.length)}</span>
            </h2>
            <div className="ax-grid">
              {sections.upcoming.map((card) => (
                <UpcomingNight
                  key={card.slug}
                  card={card}
                  conducted={
                    card.roleLabel === "Auctioneer"
                      ? (conductedBySlug.get(card.slug) ?? null)
                      : null
                  }
                />
              ))}
            </div>
          </section>
        ) : null}
        {sections.finished.length > 0 ? (
          <section className="ax-section" aria-labelledby="ax-finished">
            <h2 id="ax-finished" className="ax-eyebrow">
              Finished <span>· {nights(sections.finished.length)}</span>
            </h2>
            <ul className="ax-done-list">
              {sections.finished.map((card) => (
                <FinishedNight key={card.slug} card={card} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {spendNight !== null ? <SquadsBySpend night={spendNight} testId="auctions-spend" /> : null}
    </main>
  );
}
