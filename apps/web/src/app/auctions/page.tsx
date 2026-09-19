import {
  IconBolt,
  IconCalendar,
  IconCheckCircle,
  IconGavel,
  IconGlobe,
  IconPin,
  IconTile,
  IconTrophy,
  IconWallet,
  Pill,
  StatCard,
  StatGrid,
  type KitTone,
} from "@desiauction/ui";
import Link from "next/link";

import { compactINR } from "../../lib/inr";
import type { AuctionNightStatus } from "../../server/console/auctions-index";
import { auctionsIndexView, type AuctionCardView } from "../../server/console/views";
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

function AuctionCard({ card }: { card: AuctionCardView }) {
  const status = STATUS[card.facts.status];
  const { lotsSold, lotsTotal, lotsUnsold } = card.facts;
  const pct = lotsTotal > 0 ? Math.round((lotsSold / lotsTotal) * 100) : 0;
  const running = card.facts.status === "live" || card.facts.status === "paused";
  const dates = dateRange(card.startsOn, card.endsOn);
  return (
    <article
      className="ax-card"
      data-status={card.facts.status}
      data-testid={`auction-card-${card.slug}`}
    >
      <header className="ax-head">
        <IconTile icon={<IconGavel />} tone={status.tone} />
        <div className="ax-titles">
          <h2 className="ax-title">
            <Link href={`/seasons/${card.slug}/auction`}>{card.seasonName}</Link>
          </h2>
          <p className="ax-org">{card.orgName}</p>
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
        <p className="ax-note">No auction yet — set the purse and rules to create one.</p>
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
                {compactINR(card.facts.moneyMoved)} moved
              </span>
            ) : null}
          </div>
          <span className="ax-bar" aria-hidden>
            <span className="ax-bar-fill" style={{ transform: `scaleX(${String(pct / 100)})` }} />
          </span>
        </div>
      )}

      <footer className="ax-foot">
        <span className="ax-role">{card.roleLabel}</span>
        <span className="ax-links">
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

  if (view.cards.length === 0) {
    return (
      <main className="px-players">
        <section className="px-empty" data-testid="auctions-empty">
          <span className="px-empty-glyph" aria-hidden>
            <IconGavel size={30} />
          </span>
          <h2>No auction nights yet</h2>
          <p>
            Auctions you run, conduct or bid in appear here — with the right door for your role:
            setup, the cockpit, the live room or your plan.
          </p>
          <div className="px-empty-actions">
            <NavButton href="/tournaments" variant="primary" size="touch">
              <IconTrophy size={18} aria-hidden /> Go to tournaments
            </NavButton>
            <NavButton href="/c" variant="secondary" size="touch">
              <IconGlobe size={18} aria-hidden /> Find tournaments
            </NavButton>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="px-players">
      <StatGrid testId="auctions-stats">
        <StatCard
          icon={<IconCalendar />}
          tone="blue"
          value={count(totals.upcoming)}
          label="Upcoming"
          hint="Scheduled nights"
        />
        <StatCard
          icon={<IconBolt />}
          tone={totals.live > 0 ? "red" : "neutral"}
          value={count(totals.live)}
          label="Live now"
          hint={totals.live > 0 ? "In the room right now" : "Nothing running"}
        />
        <StatCard
          icon={<IconCheckCircle />}
          tone="green"
          value={count(totals.completed)}
          label="Completed"
          hint="Hammer down"
        />
        <StatCard
          icon={<IconWallet />}
          tone="gold"
          value={totals.spend !== undefined ? compactINR(totals.spend) : "—"}
          label="Total spend"
          hint={
            totals.spend === undefined
              ? "Shown to organizers and auctioneers"
              : totals.spendNights === 1
                ? "Across 1 night you run"
                : `Across ${count(totals.spendNights)} nights you run`
          }
          testId="auctions-spend"
        />
      </StatGrid>

      <div className="ax-grid" data-testid="auctions-list">
        {view.cards.map((card) => (
          <AuctionCard key={card.slug} card={card} />
        ))}
      </div>
    </main>
  );
}
