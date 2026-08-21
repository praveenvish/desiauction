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
  /**
   * null when this viewer is not entitled to this team's money.
   *
   * A bidder's socket carries their own teams' purses and nulls the rest, so a
   * rival row renders "sealed" instead of a number the viewer was never meant
   * to have (P1-6). It used to render the real figure, hidden only by a client
   * filter anyone could bypass in devtools.
   */
  purseRemaining: number | null;
  /** committed + remaining = the purse per team; null when sealed. */
  total: number | null;
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
    /** null when the engine sealed this team's money for this viewer (P1-6). */
    purseRemaining: number | null;
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
    // Redacted money (a rival's, on a bidder's socket) contributes nothing and
    // leaves the group's figures null, which the board renders as "sealed"
    // rather than as a confident zero.
    group.committed =
      paddle.committed === null ? group.committed : group.committed + paddle.committed;
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
  // Derived only from teams whose money this viewer actually received.
  let pursePerTeam = 0;
  for (const group of groups.values()) {
    if (group.purseRemaining !== null) {
      pursePerTeam = Math.max(pursePerTeam, group.committed + group.purseRemaining);
    }
  }

  const rows: TeamPurseRow[] = teams.map((team) => {
    const group = groups.get(team.id);
    return {
      teamId: team.id,
      teamName: team.name,
      team,
      committed: group?.committed ?? 0,
      purseRemaining: group === undefined ? pursePerTeam : group.purseRemaining,
      total:
        group === undefined
          ? pursePerTeam
          : group.purseRemaining === null
            ? null
            : group.committed + group.purseRemaining,
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
        total: group.purseRemaining === null ? null : group.committed + group.purseRemaining,
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
  /**
   * Restrict the board to these teams. Null (the default) means "every team",
   * which is what the cockpit and the spectator board want.
   *
   * A BIDDER does not get that. Remaining purse and committed spend are the two
   * numbers a sealed-purse auction seals, and the owner room served every
   * rival's to anyone with an org_members row. The list is empty-safe: a
   * participant always has at least their own team in it.
   */
  visibleTeamIds = null,
  /** Said out loud when the board is partial, so it doesn't read as the truth. */
  note = null,
}: {
  snapshot: AuctionSnapshot | null;
  teams: TeamIdentity[];
  myPaddleNumber?: string | null;
  heading?: string;
  rowTestIdPrefix?: string;
  visibleTeamIds?: readonly string[] | null;
  note?: string | null;
}) {
  /**
   * THE ROWS EXIST BEFORE THE SOCKET DOES.
   *
   * `teams` is a server prop, so this board knows its franchises in the first
   * paint and only the FIGURES have to wait. Returning `null` here meant the
   * card was 0px until the snapshot landed and then 289px — measured, and the
   * single largest contributor to CLS 0.564 in the live auction room, because
   * everything below it (the pool summary, the squad board, the whole second
   * column) moved by that much on a screen a bidder is about to tap.
   *
   * A skeleton would hold the space and say nothing. Rendering the real rows
   * with an em dash where each figure will go holds the same space and tells a
   * bidder who else is in the room, which is worth knowing before the first lot.
   *
   * `connecting` is threaded down rather than inferred from `purseRemaining ===
   * null`, because that already means something else and something important:
   * the engine SEALED this team's money from this viewer. "Sealed" is a
   * permission fact; before the socket answers nothing has been sealed, it is
   * simply not known, and printing the wrong one of those two would be a lie
   * about what the product is doing with a rival's money.
   */
  const connecting = snapshot === null;
  const all = connecting
    ? teams.map((team) => ({
        teamId: team.id,
        teamName: team.name,
        team,
        committed: 0,
        purseRemaining: null,
        total: null,
        activePaddles: [] as string[],
        leading: false,
      }))
    : teamPurseRows(snapshot, teams);
  // Filtered AFTER the fold, not before: `teamPurseRows` also appends rows for
  // paddles whose team is missing from the identity list, and filtering the
  // input alone would let a rival's purse back in through that arm.
  const rows =
    visibleTeamIds === null ? all : all.filter((row) => visibleTeamIds.includes(row.teamId));
  return (
    <Card data-testid="purse-board">
      <h2>{heading}</h2>
      {note === null ? null : (
        <p className="competitions-hint" data-testid="purse-board-note">
          {note}
        </p>
      )}
      <ul className="purse-list">
        {rows.map((row) => {
          const spentPct =
            row.total === null || row.total === 0 ? 0 : (row.committed / row.total) * 100;
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
                  <span className="purse-paddles purse-paddles--none">
                    {connecting ? "\u2014" : "no paddle yet"}
                  </span>
                )}
                {row.leading ? (
                  <span className="purse-leading" data-testid={`leading-${handle}`}>
                    Leading
                  </span>
                ) : null}
                <span className="purse-left">
                  {connecting
                    ? "\u2014"
                    : row.purseRemaining === null
                      ? "sealed"
                      : formatPaiseINR(paise(row.purseRemaining))}
                </span>
              </div>
              <div
                className="purse-bar"
                role="img"
                aria-label={
                  connecting
                    ? `${row.teamName}: purse not known yet`
                    : row.total === null
                      ? `${row.teamName}: purse sealed`
                      : `${row.teamName}: ${formatPaiseINR(paise(row.committed))} spent of ${formatPaiseINR(paise(row.total))}`
                }
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
