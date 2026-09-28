"use client";

import { IconChevronDown, PlayerImage } from "@desiauction/ui";
import type { MoneyUnit } from "@desiauction/core";
import { useState } from "react";

import type { LedgerPlayer } from "../../../../../lib/ledger-players";
import { formatTime } from "../../../../../lib/format-date";
import { moneyFormat } from "../../../../../lib/money";

/**
 * THE PLAYERS READING (redesign 2026-09-28): one row per lot, its last word,
 * and — opened — every pass that led there, in words. Folded from the same
 * event log as the other readings (ledger-players.ts); nothing here is typed
 * in. The team chips answer the question disputes start from ("what did
 * Mumbai buy?") without leaving the page; the list is whole, so they filter
 * in place.
 */

const UNSOLD = "__unsold__";

function ordinal(pass: number): string {
  return pass === 1 ? "1st" : pass === 2 ? "2nd" : pass === 3 ? "3rd" : `${String(pass)}th`;
}

export function LedgerPlayers({
  players,
  teamColors,
  unit,
  faces,
}: {
  players: readonly LedgerPlayer[];
  teamColors: Record<string, string | null>;
  unit: MoneyUnit;
  faces: Record<string, { registrationId: string; photoUrl: string | null }>;
}) {
  const money = moneyFormat(unit);
  const [team, setTeam] = useState<string | null>(null);
  const teams = Object.keys(teamColors).sort((a, b) => a.localeCompare(b));
  const unsold = players.filter((player) => player.outcome !== "sold").length;
  const shown = players.filter((player) =>
    team === null
      ? true
      : team === UNSOLD
        ? player.outcome !== "sold"
        : player.outcome === "sold" && player.teamName === team,
  );
  const chips: { key: string | null; label: string; count: number }[] = [
    { key: null, label: "All teams", count: players.length },
    ...teams.map((name) => ({
      key: name,
      label: name,
      count: players.filter((player) => player.outcome === "sold" && player.teamName === name)
        .length,
    })),
    ...(unsold > 0 ? [{ key: UNSOLD, label: "Not sold", count: unsold }] : []),
  ];

  return (
    <section className="lp" aria-label="Players" data-testid="ledger-players">
      <div className="lp-chips" role="group" aria-label="Show players of">
        {chips.map((chip) => (
          <button
            key={chip.key ?? "all"}
            type="button"
            className="lp-chip"
            aria-pressed={team === chip.key}
            onClick={() => {
              setTeam(chip.key);
            }}
          >
            {chip.key !== null && chip.key !== UNSOLD ? (
              <span
                className="lp-dot"
                style={{ background: teamColors[chip.key] ?? undefined }}
                aria-hidden
              />
            ) : null}
            {chip.label}
            <span className="lp-chip-n">{chip.count}</span>
          </button>
        ))}
      </div>

      <div className="lp-table">
        <div className="lp-head" aria-hidden>
          <span>Lot</span>
          <span>Player</span>
          <span>Team</span>
          <span className="lp-num">Price</span>
          <span>Result</span>
        </div>
        {shown.length === 0 ? (
          <p className="lp-empty">Nobody here.</p>
        ) : (
          <ul className="lp-rows" aria-label="One row per player">
            {shown.map((player) => {
              const face = faces[player.lotNumber];
              const sold = player.outcome === "sold";
              const lastPass = player.passes.filter((pass) => !pass.undone).at(-1)?.pass ?? 1;
              return (
                <li key={player.lotNumber}>
                  <details className="lp-row">
                    <summary data-testid={`ledger-player-${player.lotNumber}`}>
                      <span className="lp-lot">{player.lotNumber}</span>
                      <span className="lp-who">
                        <PlayerImage
                          name={player.playerName ?? player.lotNumber}
                          seed={face?.registrationId ?? player.lotNumber}
                          src={face?.photoUrl}
                          size="xs"
                          shape="round"
                          decorative
                        />
                        <span className="lp-name">
                          <strong>{player.playerName ?? player.lotNumber}</strong>
                          <span className="lp-sub">
                            <span className="lp-phone">{player.lotNumber} · </span>
                            {sold && player.teamName !== null ? (
                              <span className="lp-phone">{player.teamName}</span>
                            ) : (
                              <span className="lp-phone">
                                {player.outcome === "withdrawn"
                                  ? "Withdrawn"
                                  : player.outcome === "none"
                                    ? "Never under the hammer"
                                    : player.passCount > 1
                                      ? "Unsold twice"
                                      : "Unsold"}
                              </span>
                            )}
                            {sold && lastPass > 1 ? (
                              <span className="lp-phone"> · {ordinal(lastPass)} pass</span>
                            ) : null}
                          </span>
                        </span>
                      </span>
                      <span className="lp-team">
                        {sold && player.teamName !== null ? (
                          <>
                            <span
                              className="lp-dot"
                              style={{ background: teamColors[player.teamName] ?? undefined }}
                              aria-hidden
                            />
                            {player.teamName}
                          </>
                        ) : (
                          <span className="lp-none">—</span>
                        )}
                      </span>
                      <span className="lp-price lp-num">
                        {sold && player.amount !== null ? money.ledger(player.amount) : "—"}
                      </span>
                      <span className="lp-result">
                        <span
                          className="ledger-result"
                          data-tone={
                            sold ? "sold" : player.outcome === "none" ? "neutral" : "unsold"
                          }
                        >
                          {sold
                            ? "SOLD"
                            : player.outcome === "withdrawn"
                              ? "Withdrawn"
                              : player.outcome === "none"
                                ? "Not run"
                                : "UNSOLD"}
                        </span>
                        {sold && lastPass > 1 ? (
                          <span className="lp-pass">{ordinal(lastPass)} pass</span>
                        ) : null}
                        <IconChevronDown size={14} aria-hidden className="lp-caret" />
                      </span>
                    </summary>
                    {/* The lot's passes, in words — the rows the other readings
                    list one by one. */}
                    <ol className="lp-history">
                      {player.passes.length === 0 ? (
                        <li>Never reached a result.</li>
                      ) : (
                        player.passes.map((pass) => (
                          <li key={pass.seq} data-undone={pass.undone || undefined}>
                            <span className="lp-when">{formatTime(pass.atMs)}</span>
                            <span>
                              {player.passCount > 1 ? `${ordinal(pass.pass)} pass · ` : ""}
                              {pass.outcome === "sold"
                                ? `Sold to ${pass.teamName ?? "a team"}${pass.amount !== null ? ` for ${money.ledger(pass.amount)}` : ""}`
                                : pass.outcome === "withdrawn"
                                  ? "Withdrawn"
                                  : "Unsold"}
                              {pass.bids > 0
                                ? ` after ${String(pass.bids)} ${pass.bids === 1 ? "bid" : "bids"}`
                                : pass.outcome === "unsold"
                                  ? " — no bids"
                                  : ""}
                              {pass.undone ? " — undone, the lot went back on the block" : ""}
                              {pass.outcome === "unsold" && pass.pass < player.passCount
                                ? " · went back in"
                                : ""}
                            </span>
                          </li>
                        ))
                      )}
                    </ol>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
