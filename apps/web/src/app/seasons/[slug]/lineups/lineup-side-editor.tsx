"use client";

import { Button, Dialog, PlayerImage } from "@desiauction/ui";
import { useState, useTransition } from "react";

import {
  announceLineupAction,
  saveLineupAction,
} from "../../../../server/competition/lineup-actions";
import type { LineupAnnounceState } from "../../../../server/competition/lineup-announce";
import type { LineupSide } from "../../../../server/competition/lineups";

function players(count: number): string {
  return count === 1 ? "1 player" : `${String(count)} players`;
}

/**
 * One team's lineup for one match: a checklist of the squad, a count, and one
 * save. The saved set REPLACES the team's lineup, so unticking is recorded too.
 */
export function LineupSideEditor({
  slug,
  fixtureId,
  side,
  announce,
}: {
  slug: string;
  fixtureId: string;
  side: LineupSide;
  /** Absent for a match that has no announce state (none selected). */
  announce: LineupAnnounceState | undefined;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(side.players.filter((player) => player.played).map((p) => p.registrationId)),
  );
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(
    side.recorded ? { tone: "ok", text: "Saved" } : null,
  );
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [announcing, startAnnouncing] = useTransition();
  // Announce tells the SAVED lineup, so ticks not yet saved must be saved
  // first — otherwise the message and the record would disagree.
  const saved = new Set(side.players.filter((p) => p.played).map((p) => p.registrationId));
  const unsaved = saved.size !== picked.size || [...picked].some((id) => !saved.has(id));

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

  function announceNow(): void {
    startAnnouncing(async () => {
      const result = await announceLineupAction(slug, fixtureId, side.teamId);
      setConfirming(false);
      setStatus(
        result.ok
          ? {
              tone: "ok",
              text:
                result.told === 0
                  ? "Everyone in this lineup was already told"
                  : `Told ${players(result.told)}`,
            }
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
                  <PlayerImage
                    name={player.name}
                    seed={player.registrationId}
                    src={player.photoUrl}
                    size="sm"
                    shape="round"
                    decorative
                  />
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
        {/* Only before the match, only once something is saved, and only for
            players not told yet. A lineup recorded afterwards tells nobody. */}
        {announce?.upcoming === true && announce.pending > 0 ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setConfirming(true);
            }}
            disabled={unsaved || pending}
            title={unsaved ? "Save the lineup first" : undefined}
            data-testid="lineup-announce"
          >
            Announce to {players(announce.pending)}
          </Button>
        ) : null}
      </footer>
      {announce !== undefined ? (
        <Dialog
          open={confirming}
          onClose={() => {
            setConfirming(false);
          }}
          title={`Announce the ${side.teamName} lineup?`}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Not yet
              </Button>
              <Button
                onClick={announceNow}
                loading={announcing}
                data-testid="lineup-announce-confirm"
              >
                Announce
              </Button>
            </>
          }
        >
          <p className="lineups-note">
            {players(announce.pending)} in the saved lineup will be told they are playing — in their
            inbox, by email and by text. Anyone you take out later is not messaged.
          </p>
        </Dialog>
      ) : null}
    </section>
  );
}
