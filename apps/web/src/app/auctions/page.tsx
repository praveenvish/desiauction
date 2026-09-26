import {
  EmptyState,
  IconCalendar,
  IconCheckCircle,
  IconGavel,
  IconGlobe,
  IconPin,
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
import "./auctions.css";

export const metadata = { title: "Auctions · DesiAuction" };

const STATUS: Record<AuctionNightStatus, { label: string; tone: KitTone }> = {
  none: { label: "Not set up", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "blue" },
  live: { label: "Live", tone: "red" },
  paused: { label: "Paused", tone: "amber" },
  completed: { label: "Completed", tone: "green" },
  settled: { label: "Settled", tone: "gold" },
};

function count(value: number): string {
  return value.toLocaleString("en-IN");
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

function AuctionCard({ card }: { card: AuctionCardView }) {
  const status = STATUS[card.facts.status];
  const { lotsSold, lotsTotal, lotsUnsold } = card.facts;
  const pct = lotsTotal > 0 ? Math.round((lotsSold / lotsTotal) * 100) : 0;
  const running = card.facts.status === "live" || card.facts.status === "paused";
  const dates = dateRange(card.startsOn, card.endsOn);
  return (
    <article
      className="ax-card da-lift"
      data-status={card.facts.status}
      data-testid={`auction-card-${card.slug}`}
    >
      <header className="ax-head">
        <IconTile icon={<IconGavel weight="duotone" />} tone="gold" size="sm" />
        <div className="ax-titles">
          <h2 className="ax-title">
            <Link href={`/seasons/${card.slug}/auction`}>{card.seasonName}</Link>
          </h2>
          <p className="ax-org">
            {card.orgName}
            {/* The role is what this card is FOR — a chip by the name, not a
                low-contrast caption in the footer. */}
            <span className="ax-role">{card.roleLabel}</span>
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

      {card.facts.status === "none" ? (
        // Addressed to whoever is reading: the organizer can fix it, the
        // auctioneer can only wait for it (their card lists no door until then).
        <p className="ax-note">
          {card.roleLabel === "Organizer"
            ? "No auction yet — set the purse and rules to create one."
            : "The organizer hasn't set this auction up yet. You'll run it from the cockpit when they do."}
        </p>
      ) : (
        <div className="ax-progress">
          <div className="ax-progress-row">
            <span>
              <strong>{count(lotsSold)}</strong> of {count(lotsTotal)} lots sold
              {lotsUnsold > 0 ? (
                <span className="ax-muted"> · {count(lotsUnsold)} unsold</span>
              ) : null}
            </span>
            {card.facts.moneyMoved !== undefined ? (
              <span className="ax-money" data-testid={`auction-money-${card.slug}`}>
                {moneyFormat(card.auctionUnit).compact(card.facts.moneyMoved)} moved
              </span>
            ) : null}
          </div>
          <span className="ax-bar" aria-hidden>
            <span className="ax-bar-fill" style={{ transform: `scaleX(${String(pct / 100)})` }} />
          </span>
        </div>
      )}

      <footer className="ax-foot">
        <span className="ax-links">
          {/* A night with no auction offers an auctioneer nothing to open —
              the season page, where the dates and the organizer are, instead
              of an empty footer. */}
          {card.links.length === 0 ? (
            <NavButton href={`/seasons/${card.slug}`} variant="secondary" size="sm">
              See the season
            </NavButton>
          ) : null}
          {card.links.map((link) => (
            <NavButton
              key={link.label}
              href={link.href}
              variant={link.primary === true && running ? "primary" : "secondary"}
              size="sm"
            >
              {link.label}
            </NavButton>
          ))}
        </span>
      </footer>
    </article>
  );
}

/**
 * /auctions — every auction night this person runs, conducts, owns a team in or
 * can watch, across their clubs. Money moved shows only where they hold money
 * sight (conduct or manage); see `server/console/auctions-index.ts`.
 */
export default async function AuctionsPage() {
  const view = await auctionsIndexView();
  const { totals } = view;
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
            <strong>{count(totals.completed)}</strong> completed
          </span>
        ) : null}
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
      </p>

      <div className="ax-grid" data-testid="auctions-list">
        {view.cards.map((card) => (
          <AuctionCard key={card.slug} card={card} />
        ))}
      </div>
    </main>
  );
}
