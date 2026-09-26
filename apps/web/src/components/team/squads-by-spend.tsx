import { IconWallet, SectionCard } from "@desiauction/ui";
import Link from "next/link";

import { moneyFormat } from "../../lib/money";
import { auctionDashboard } from "../../server/auction/actions";
import { seasonUnit } from "../../server/competition/season-unit";
import "./squads-by-spend.css";

/*
 * SQUADS BY SPEND — a finished auction night's teams, what each spent of its
 * purse and its top buy. Born on /auctions (round 4A); shared so every page
 * whose next object is "how did the night go" draws the same block. Read
 * through the hub's own gated read (auctionDashboard): a viewer without money
 * sight gets no figures and the block does not render.
 */

export interface SpendNight {
  slug: string;
  seasonName: string;
  unit: "inr" | "points";
  teams: {
    teamName: string;
    color: string | null;
    spent: number;
    purseTotal: number;
    players: number;
    topBuy: { name: string; price: number } | null;
  }[];
}

export async function spendNightOf(slug: string, seasonName: string): Promise<SpendNight | null> {
  const [dash, unit] = await Promise.all([auctionDashboard(slug), seasonUnit(slug)]);
  const overview = dash?.overview ?? null;
  // No paddles or no sale yet: there is no night to tell.
  if (overview === null || overview.paddles.length === 0 || overview.counts.sold === 0) {
    return null;
  }
  const teams: SpendNight["teams"] = [];
  for (const paddle of overview.paddles) {
    // Money-gated upstream: without the figures there is nothing to draw.
    if (paddle.spent === undefined || paddle.purseTotal === undefined) {
      return null;
    }
    const bought = overview.lots.filter(
      (lot) => lot.status === "sold" && lot.paddleNumber === paddle.paddleNumber,
    );
    const top = bought.reduce<(typeof bought)[number] | null>(
      (best, lot) => (best === null || (lot.soldPrice ?? 0) > (best.soldPrice ?? 0) ? lot : best),
      null,
    );
    teams.push({
      teamName: paddle.teamName,
      color: paddle.color,
      spent: paddle.spent,
      purseTotal: paddle.purseTotal,
      players: bought.length,
      topBuy:
        top === null ? null : { name: top.playerName ?? top.lotNumber, price: top.soldPrice ?? 0 },
    });
  }
  teams.sort((a, b) => b.spent - a.spent);
  return { slug, seasonName, unit, teams };
}

export function SquadsBySpend({
  night,
  testId,
  description,
}: {
  night: SpendNight;
  testId: string;
  /** Overrides the default "{season} · what each team spent…" line. */
  description?: string;
}) {
  const money = moneyFormat(night.unit);
  return (
    <SectionCard
      icon={<IconWallet />}
      concept="money"
      title="Squads by spend"
      description={
        description ?? `${night.seasonName} · what each team spent of its purse, and its top buy`
      }
      action={
        <Link href={`/seasons/${night.slug}/teams`} className="ax-spend-link">
          See the squads
        </Link>
      }
      data-testid={testId}
    >
      <ul className="ax-spend da-stagger">
        {night.teams.map((team) => (
          <li key={team.teamName} className="ax-spend-row">
            <span className="ax-spend-team">
              <span
                className="ax-spend-dot"
                style={{ background: team.color ?? "var(--accent)" }}
                aria-hidden
              />
              <strong>{team.teamName}</strong>
              <span className="ax-muted">{team.players} bought</span>
            </span>
            <span className="ax-spend-bar" aria-hidden>
              <span
                style={{
                  width: `${String(team.purseTotal > 0 ? Math.round((team.spent / team.purseTotal) * 100) : 0)}%`,
                  background: team.color ?? "var(--accent)",
                }}
              />
            </span>
            <span className="ax-spend-figure">
              <strong>{money.exact(team.spent)}</strong>
              <span className="ax-muted"> of {money.compact(team.purseTotal)}</span>
            </span>
            <span className="ax-spend-top">
              {team.topBuy === null ? (
                <span className="ax-muted">No buys</span>
              ) : (
                <>
                  <span className="ax-muted">Top buy </span>
                  {team.topBuy.name} · {money.exact(team.topBuy.price)}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

