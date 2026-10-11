"use client";
import { placementEngine } from "@desiauction/core/scoring/placement-engine";
import { lobbyFormat } from "@desiauction/core/scoring/placement-formats";
import type { MatchEvent } from "@desiauction/core/scoring";
import { readHistory } from "../history";
import { scoringEventId } from "./setup-model";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@desiauction/ui";
import type { PlacementScoringSetup } from "../../../../server/scoring/home";
import { bindScoringActor } from "../../storage";
import { scoringDevice } from "../queue";
export function PlacementSetup({
  setup,
  actorId,
}: {
  setup: PlacementScoringSetup;
  actorId: string;
}) {
  const router = useRouter();
  const [rounds, setRounds] = useState(setup.format.rounds);
  const formatKey = `lobby_${String(rounds)}`;
  const [representedTeamId, setRepresentedTeamId] = useState(
    setup.representedTeamIds.length === 1 ? (setup.representedTeamIds[0] ?? "") : "",
  );
  const [starters, setStarters] = useState<Record<string, string[]>>(
    Object.fromEntries(
      setup.teams.map((team) => [team.id, team.players.map((player) => player.id)]),
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
      await bindScoringActor(actorId);
      const deviceId = await scoringDevice();
      const response = await fetch(`/api/score/${setup.fixtureId}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deviceId,
          formatKey,
          rounds,
          representedTeamId,
          conditions: setup.conditions,
          lineups: setup.teams.map((team) => ({
            teamId: team.id,
            players: starters[team.id] ?? [],
          })),
        }),
      });
      const value = (await response.json()) as { ok?: boolean; message?: string; phase?: string };
      if (!response.ok || !value.ok)
        throw new Error(value.message ?? "Match setup could not be saved.");
      if (value.phase === "not_started" || pending.current) {
        if (!pending.current) {
          const history = await readHistory(setup.fixtureId);
          const state = placementEngine.replay(history.events);
          const format = lobbyFormat(rounds, setup.format.points);
          const payloads: { type: MatchEvent["type"]; payload: unknown }[] = [];
          if (!state.format)
            payloads.push({
              type: "match_started",
              payload: {
                format,
                conditions: setup.conditions,
                teamIds: setup.teams.map((team) => team.id),
              },
            });
          for (const team of setup.teams)
            if (!state.squads[team.id])
              payloads.push({
                type: "lineup_confirmed",
                payload: {
                  teamId: team.id,
                  players: starters[team.id] ?? [],
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
          placementEngine.replay([
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
      router.push(`/score/${setup.fixtureId}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Match setup could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="score-home placement-setup" data-testid="placement-setup">
      <h1>Lobby setup · {setup.fixtureNumber}</h1>
      <label>
        Rounds
        <input
          type="number"
          min={1}
          max={100}
          value={rounds}
          disabled={busy || locked}
          onChange={(e) => {
            setRounds(Number(e.target.value));
          }}
        />
      </label>
      {setup.representedTeamIds.length > 1 ? (
        <label>
          Squad you represent
          <select
            value={representedTeamId}
            disabled={busy || locked}
            onChange={(e) => {
              setRepresentedTeamId(e.target.value);
            }}
          >
            <option value="">Choose a squad</option>
            {setup.teams
              .filter((t) => setup.representedTeamIds.includes(t.id))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      {setup.teams.map((team) => (
        <fieldset key={team.id}>
          <legend>{team.name} · Playing roster</legend>
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
