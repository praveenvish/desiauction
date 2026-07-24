"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import { Card } from "@desiauction/ui";
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

/** Franchise colour, or the brand accent when a team has not chosen one. */
function colorOf(team: TeamIdentity | undefined): string {
  return team?.primaryColor ?? "var(--identity-accent)";
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
    <span className="purse-chip" style={{ background: colorOf(team) }} aria-hidden>
      {initialsOf(team, fallback)}
    </span>
  );
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
  const byId = new Map(teams.map((team) => [team.id, team]));
  const leadingPaddle = snapshot.currentLot?.currentBid?.paddleNumber ?? null;
  return (
    <Card data-testid="purse-board">
      <h2>{heading}</h2>
      <ul className="purse-list">
        {snapshot.paddles.map((paddle) => {
          const team = byId.get(paddle.teamId);
          // committed + remaining IS the purse total, so the bar needs no
          // extra field on the wire.
          const total = paddle.committed + paddle.purseRemaining;
          const spentPct = total === 0 ? 0 : (paddle.committed / total) * 100;
          const leading = leadingPaddle === paddle.paddleNumber;
          return (
            <li
              key={paddle.paddleId}
              className="purse-row"
              data-mine={paddle.paddleNumber === myPaddleNumber ? "true" : undefined}
              data-testid={`${rowTestIdPrefix}-${paddle.paddleNumber}`}
            >
              <div className="purse-head">
                <TeamChip team={team} fallback={paddle.teamName} />
                <span className="purse-team">{paddle.teamName}</span>
                {leading ? (
                  <span className="purse-leading" data-testid={`leading-${paddle.paddleNumber}`}>
                    Leading
                  </span>
                ) : null}
                <span className="purse-left">{formatPaiseINR(paise(paddle.purseRemaining))}</span>
              </div>
              <div
                className="purse-bar"
                role="img"
                aria-label={`${paddle.teamName}: ${formatPaiseINR(paise(paddle.committed))} spent of ${formatPaiseINR(paise(total))}`}
              >
                <span
                  className="purse-bar-fill"
                  style={{
                    width: `${String(Math.min(100, spentPct))}%`,
                    background: colorOf(team),
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
