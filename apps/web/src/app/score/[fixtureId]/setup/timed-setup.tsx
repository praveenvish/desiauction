"use client";
import { timedEngine } from "@desiauction/core/scoring/timed-engine";
import type { MatchEvent } from "@desiauction/core/scoring";
import { readHistory } from "../history";
import { scoringEventId } from "./setup-model";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@desiauction/ui";
import type { TimedScoringSetup } from "../../../../server/scoring/home";
import { bindScoringActor, scoringWorkGuard } from "../../storage";
import { scoringDevice } from "../queue";
export function TimedSetup({ setup, actorId }: { setup: TimedScoringSetup; actorId: string }) {
  const router = useRouter();
  const [formatKey, setFormatKey] = useState(setup.format.key);
  const [starters, setStarters] = useState<Record<string, string[]>>(
    Object.fromEntries(
      setup.teams.map((team) => [
        team.id,
        team.players.slice(0, setup.sport === "basketball" ? 5 : 11).map((player) => player.id),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const pending = useRef<{
    deviceId: string;
    attempt: number;
    events: Omit<MatchEvent, "seq" | "actorPersonId">[];
  } | null>(null);
  const [locked, setLocked] = useState(false);
  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const check = scoringWorkGuard(await bindScoringActor(actorId));
      const deviceId = await scoringDevice();
      check();
      check();
      const response = await fetch(`/api/score/${setup.fixtureId}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deviceId,
          formatKey,
          conditions: setup.conditions,
          lineups: setup.teams.map((team) => ({
            teamId: team.id,
            players: team.players.map((player) => player.id),
            startingActive: starters[team.id] ?? [],
          })),
        }),
      });
      const value = (await response.json()) as { ok?: boolean; message?: string; phase?: string };
      if (!response.ok || !value.ok)
        throw new Error(value.message ?? "Match setup could not be saved.");
      if (value.phase === "not_started" || pending.current) {
        if (!pending.current) {
          const history = await readHistory(setup.fixtureId);
          check();
          const state = timedEngine.replay(history.events);
          const format = setup.formats.find((value) => value.key === formatKey) ?? setup.format;
          const payloads: { type: MatchEvent["type"]; payload: unknown }[] = [];
          if (!state.format)
            payloads.push({
              type: "match_started",
              payload: {
                format,
                conditions: setup.conditions,
                homeTeamId: setup.teams[0].id,
                awayTeamId: setup.teams[1].id,
              },
            });
          for (const team of setup.teams)
            if (!state.squads[team.id])
              payloads.push({
                type: "lineup_confirmed",
                payload: {
                  teamId: team.id,
                  players: team.players.map((player) => player.id),
                  startingActive: starters[team.id] ?? [],
                },
              });
          const clientSeq = Math.max(
            0,
            ...history.events
              .filter((event) => event.actorPersonId === actorId)
              .map((event) => event.clientSeq),
          );
          const events = payloads.map(
            (entry, index) =>
              ({
                ...entry,
                eventId: scoringEventId(),
                attempt: history.attempt,
                v: 1 as const,
                targetEventId: null,
                clientSeq: clientSeq + index + 1,
                clientRecordedAt: new Date().toISOString(),
              }) as Omit<MatchEvent, "seq" | "actorPersonId">,
          );
          timedEngine.replay([
            ...history.events,
            ...events.map((entry, index) => ({
              ...entry,
              seq: state.lastSeq + index + 1,
              actorPersonId: actorId,
            })),
          ]);
          if (events.length > 0) {
            pending.current = { deviceId, attempt: history.attempt, events };
            setLocked(true);
          }
        }
        if (pending.current) {
          check();
          const accepted = await fetch(`/api/score/${setup.fixtureId}/events`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(pending.current),
          });
          const result = (await accepted.json()) as {
            ok?: boolean;
            message?: string;
            acks?: { status: string; message?: string }[];
          };
          const rejected = result.acks?.find((ack) => ack.status === "rejected");
          if (!accepted.ok || result.ok === false || rejected)
            throw new Error(rejected?.message ?? result.message ?? "Check the starting players.");
        }
      }
      check();
      router.push(`/score/${setup.fixtureId}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Match setup could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="score-home timed-setup family-setup" data-testid="timed-setup">
      <p className="score-cap">{setup.fixtureNumber} · Timed match setup</p>
      <h1>{setup.teams.map((team) => team.name).join(" vs ")}</h1>
      <label>
        Format
        <select
          disabled={busy || locked}
          value={formatKey}
          onChange={(event) => {
            setFormatKey(event.target.value);
          }}
        >
          {setup.formats.map((format) => (
            <option key={format.key} value={format.key}>
              {format.label}
            </option>
          ))}
        </select>
      </label>
      {setup.teams.map((team) => (
        <fieldset key={team.id}>
          <legend>{team.name} · Starting players</legend>
          {team.players.map((player) => (
            <label key={player.id}>
              <input
                type="checkbox"
                disabled={busy || locked}
                checked={starters[team.id]?.includes(player.id) ?? false}
                onChange={(event) => {
                  const current = starters[team.id] ?? [];
                  setStarters({
                    ...starters,
                    [team.id]: event.target.checked
                      ? [...current, player.id]
                      : current.filter((id) => id !== player.id),
                  });
                }}
              />
              {player.name}
            </label>
          ))}
        </fieldset>
      ))}
      {error ? <p role="alert">{error}</p> : null}
      <Button
        size="touch"
        disabled={busy || setup.teams.some((team) => (starters[team.id]?.length ?? 0) < 1)}
        onClick={() => {
          void start();
        }}
      >
        Start match
      </Button>
    </main>
  );
}
