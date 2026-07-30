"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import { Card, paintOnFill } from "@desiauction/ui";
import type { AuctionSnapshot } from "@desiauction/core";

// THE PURSE BOARD — one treatment of "who can still play?", shared by every
// live surface. It previously existed three times over: a bare list on
// /spectate, a stat row on /live, ad-hoc bars on the cockpit. Same numbers,
// three vocabularies.

export interface TeamIdentity {
  id: string;
  name: string;
  shortName: string | null;
  primaryColor: string | null;
}

/**
 * The franchise's crest paint: its own colour, and a LABEL COLOUR DERIVED FROM
 * IT.
 *
 * The chip used to pin a near-black label in CSS on top of whatever hex the
 * organizer had typed. That is a contrast bug waiting on the data: the seeded
 * `#1f6f43` renders 11px ink at 3.22:1, and every mid-tone or dark brand colour
 * — the majority of real club crests — lands in the same place. `paintOnFill`
 * picks the ink/paper token by the fill's relative luminance and, for the narrow
 * band where neither reaches 4.5:1, returns the nearest shade of the same hue
 * that does. The bar underneath takes the same paint so a franchise reads as one
 * colour across the board.
 */
function paintOf(team: TeamIdentity | undefined): { background: string; color: string } {
  return paintOnFill(team?.primaryColor);
}

function initialsOf(team: TeamIdentity | undefined, fallback: string): string {
  if (team?.shortName != null && team.shortName !== "") {
    return team.shortName.slice(0, 3).toUpperCase();
  }
  const words = (team?.name ?? fallback).trim().split(/\s+/);
  return words
    .slice(0, 3)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}

export function TeamChip({ team, fallback }: { team: TeamIdentity | undefined; fallback: string }) {
  return (
    <span className="purse-chip" style={paintOf(team)} aria-hidden>
      {initialsOf(team, fallback)}
    </span>
  );
}

/**
 * ONE ROW PER TEAM — the unit of the purse board.
 *
 * DA: the board used to map `snapshot.paddles`, which is the wrong axis for
 * every figure on it. `purseRemaining` is computed PER TEAM
 * (auction-snapshot.ts), multi-paddle holders are supported by design, and
 * re-claiming after a hand-back mints a NEW paddle number — so a team that had
 * handed a paddle back and taken another appeared three times, each row
 * repeating the team's whole purse. On the projector that reads as three
 * franchises with the same name and three times the money. Meanwhile a team
 * that had not claimed yet was absent entirely, and released paddles rendered
 * as live purses.
 */
export interface TeamPurseRow {
  teamId: string;
  teamName: string;
  team: TeamIdentity | undefined;
  /** Every paise this TEAM has committed — the sum over all its paddles. */
  committed: number;
  purseRemaining: number;
  /** committed + remaining = the purse per team. */
  total: number;
  /** Paddle numbers still in hand (released ones are not a live purse). */
  activePaddles: string[];
  /** True while any paddle of this team holds the leading bid. */
  leading: boolean;
}

/**
 * Fold the snapshot's paddle rows onto the team axis, and take `teams` as the
 * ROW UNIVERSE so a franchise with no paddle claimed yet still shows its
 * untouched purse — "who can still play?" includes the people who have not sat
 * down.
 */
export function teamPurseRows(
  snapshot: AuctionSnapshot,
  teams: readonly TeamIdentity[],
): TeamPurseRow[] {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const leadingPaddle = snapshot.currentLot?.currentBid?.paddleNumber ?? null;

  interface Group {
    teamName: string;
    committed: number;
    purseRemaining: number;
    activePaddles: string[];
    leading: boolean;
  }
  const groups = new Map<string, Group>();
  for (const paddle of snapshot.paddles) {
    const group = groups.get(paddle.teamId) ?? {
      teamName: paddle.teamName,
      committed: 0,
      // Per-team already: identical on every paddle the team holds.
      purseRemaining: paddle.purseRemaining,
      activePaddles: [],
      leading: false,
    };
    // A released paddle's SPEND still happened — the money does not come back
    // when the paddle does. Only its presence in the room ends.
    group.committed += paddle.committed;
    group.purseRemaining = paddle.purseRemaining;
    if (!paddle.released) {
      group.activePaddles.push(paddle.paddleNumber);
      if (leadingPaddle === paddle.paddleNumber) {
        group.leading = true;
      }
    }
    groups.set(paddle.teamId, group);
  }

  // The purse per team is not on the wire, but it is recoverable exactly:
  // committed + remaining, for any team that has a paddle. Teams with none
  // borrow it — every team in an auction starts with the same purse.
  let pursePerTeam = 0;
  for (const group of groups.values()) {
    pursePerTeam = Math.max(pursePerTeam, group.committed + group.purseRemaining);
  }

  const rows: TeamPurseRow[] = teams.map((team) => {
    const group = groups.get(team.id);
    return {
      teamId: team.id,
      teamName: team.name,
      team,
      committed: group?.committed ?? 0,
      purseRemaining: group?.purseRemaining ?? pursePerTeam,
      total: group === undefined ? pursePerTeam : group.committed + group.purseRemaining,
      activePaddles: group?.activePaddles ?? [],
      leading: group?.leading ?? false,
    };
  });
  // Defensive: a paddle whose team is not in the identity list still belongs on
  // the board — better an unstyled row than a franchise the hall cannot see.
  for (const [teamId, group] of groups) {
    if (!byId.has(teamId)) {
      rows.push({
        teamId,
        teamName: group.teamName,
        team: undefined,
        committed: group.committed,
        purseRemaining: group.purseRemaining,
        total: group.committed + group.purseRemaining,
        activePaddles: group.activePaddles,
        leading: group.leading,
      });
    }
  }
  return rows;
}

/**
 * The row handle. Suites (and operators) address a team by the paddle in its
 * hand, so the primary paddle number stays the testid where there is one; a
 * team with no paddle claimed is addressed by id.
 */
export function purseRowKey(row: TeamPurseRow): string {
  return row.activePaddles[0] ?? `team-${row.teamId}`;
}

export function PurseBoard({
  snapshot,
  teams,
  /** Paddle number of the viewer's own team, highlighted when present. */
  myPaddleNumber = null,
  heading = "Purses",
  /** Row testid prefix; spectate keeps its own so its suite is untouched. */
  rowTestIdPrefix = "purse",
}: {
  snapshot: AuctionSnapshot | null;
  teams: TeamIdentity[];
  myPaddleNumber?: string | null;
  heading?: string;
  rowTestIdPrefix?: string;
}) {
  if (snapshot === null) {
    return null;
  }
  const rows = teamPurseRows(snapshot, teams);
  return (
    <Card data-testid="purse-board">
      <h2>{heading}</h2>
      <ul className="purse-list">
        {rows.map((row) => {
          const spentPct = row.total === 0 ? 0 : (row.committed / row.total) * 100;
          const mine =
            myPaddleNumber !== null && row.activePaddles.includes(myPaddleNumber)
              ? "true"
              : undefined;
          const handle = purseRowKey(row);
          return (
            <li
              key={row.teamId}
              className="purse-row"
              data-mine={mine}
              data-team-id={row.teamId}
              data-testid={`${rowTestIdPrefix}-${handle}`}
            >
              <div className="purse-head">
                <TeamChip team={row.team} fallback={row.teamName} />
                <span className="purse-team">{row.teamName}</span>
                {row.activePaddles.length > 0 ? (
                  <span className="purse-paddles">{row.activePaddles.join(" · ")}</span>
                ) : (
                  <span className="purse-paddles purse-paddles--none">no paddle yet</span>
                )}
                {row.leading ? (
                  <span className="purse-leading" data-testid={`leading-${handle}`}>
                    Leading
                  </span>
                ) : null}
                <span className="purse-left">{formatPaiseINR(paise(row.purseRemaining))}</span>
              </div>
              <div
                className="purse-bar"
                role="img"
                aria-label={`${row.teamName}: ${formatPaiseINR(paise(row.committed))} spent of ${formatPaiseINR(paise(row.total))}`}
              >
                <span
                  className="purse-bar-fill"
                  style={{
                    width: `${String(Math.min(100, spentPct))}%`,
                    background: paintOf(row.team).background,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
