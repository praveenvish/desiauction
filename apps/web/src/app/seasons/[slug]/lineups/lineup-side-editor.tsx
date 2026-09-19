"use client";

import { Button } from "@desiauction/ui";
import { useState, useTransition } from "react";

import { saveLineupAction } from "../../../../server/competition/lineup-actions";
import type { LineupSide } from "../../../../server/competition/lineups";

/**
 * One team's lineup for one match: a checklist of the squad, a count, and one
 * save. The saved set REPLACES the team's lineup, so unticking is recorded too.
 */
export function LineupSideEditor({
  slug,
  fixtureId,
  side,
}: {
  slug: string;
  fixtureId: string;
  side: LineupSide;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(side.players.filter((player) => player.played).map((p) => p.registrationId)),
  );
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(
    side.recorded ? { tone: "ok", text: "Saved" } : null,
  );
  const [pending, startTransition] = useTransition();

  function toggle(id: string): void {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setStatus(null);
  }

  function save(): void {
    startTransition(async () => {
      const result = await saveLineupAction(slug, fixtureId, side.teamId, [...picked]);
      setStatus(
        result.ok
          ? { tone: "ok", text: `Saved — ${String(result.played)} played` }
          : { tone: "error", text: result.error },
      );
    });
  }

  const headingId = `lineup-${side.teamId}`;
  return (
    <section className="lineups-side" aria-labelledby={headingId} data-testid="lineup-side">
      <header className="lineups-side-head">
        <h3 id={headingId}>{side.teamName}</h3>
        <span className="lineups-count">
          {picked.size} of {side.players.length} picked
        </span>
      </header>
      {side.players.length === 0 ? (
        <p className="lineups-side-empty">
          No approved players on this team yet — the squad fills on auction night.
        </p>
      ) : (
        <ul className="lineups-players">
          {side.players.map((player) => {
            const id = `pick-${side.teamId}-${player.registrationId}`;
            return (
              <li key={player.registrationId}>
                <input
                  id={id}
                  type="checkbox"
                  checked={picked.has(player.registrationId)}
                  onChange={() => {
                    toggle(player.registrationId);
                  }}
                />
                <label htmlFor={id}>
                  <span className="lineups-player-name">{player.name}</span>
                  {player.isCaptain ? <span className="lineups-captain">Captain</span> : null}
                  {player.role !== null ? (
                    <span className="lineups-player-role">{player.role}</span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <footer className="lineups-side-foot">
        <span
          className={`lineups-status${status?.tone === "error" ? " lineups-status--error" : ""}`}
          role="status"
        >
          {status?.text ?? (side.recorded ? "" : "Not recorded yet")}
        </span>
        {/* Secondary: two sides means two of these on one screen, and one ink
            button per screen is the console's rule. */}
        <Button
          size="sm"
          variant="secondary"
          onClick={save}
          loading={pending}
          disabled={side.players.length === 0}
          data-testid="lineup-save"
        >
          Save {side.teamName} lineup
        </Button>
      </footer>
    </section>
  );
}
