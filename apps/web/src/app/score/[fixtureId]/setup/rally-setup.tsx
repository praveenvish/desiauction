"use client";
import { rallyEngine } from "@desiauction/core/scoring/rally-engine";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@desiauction/ui";
import type { MatchEvent } from "@desiauction/core/scoring";
import type { RallyScoringSetup } from "../../../../server/scoring/home";
import { bindScoringActor, scoringWrite } from "../../storage";
import { scoringDevice } from "../queue";
import { readHistory } from "../history";
import { scoringEventId } from "./setup-model";
import { RubberSelection, type RubberProposal } from "../rally-selection";
export function RallySetup({ setup, actorId }: { setup: RallyScoringSetup; actorId: string }) {
  const router = useRouter();
  const [formatKey, setFormatKey] = useState(setup.format.key);
  const format = setup.formats.find((value) => value.key === formatKey) ?? setup.format;
  const [proposals, setProposals] = useState<RubberProposal[]>(
    Array.from({ length: 5 }, (_, index) => ({
      rubberNo: index + 1,
      homePlayers: [],
      awayPlayers: [],
      firstServer: "home",
    })),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const pending = useRef<{
    deviceId: string;
    attempt: number;
    events: Omit<MatchEvent, "seq" | "actorPersonId">[];
  } | null>(null);
  async function post(url: string, body: unknown) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const value = (await response.json()) as {
      ok?: boolean;
      message?: string;
      attempt: number;
      phase: string;
      acks?: { status: string; message?: string }[];
    };
    if (!response.ok || value.ok === false)
      throw new Error(value.message ?? "Match setup could not be saved.");
    return value;
  }
  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await bindScoringActor(actorId);
      const deviceId = await scoringDevice();
      // Future choices are device proposals, never canonical appearances.
      await scoringWrite([
        [
          `ls1:rally-proposals:${setup.fixtureId}`,
          { actorId, proposals: proposals.slice(0, format.rubbers) },
        ],
      ]);
      if (!pending.current) {
        const result = await post(`/api/score/${setup.fixtureId}/start`, {
          deviceId,
          formatKey,
          conditions: setup.conditions,
          lineups: setup.teams.map((team) => ({
            teamId: team.id,
            players: team.players.map((player) => player.id),
          })),
        });
        if (result.phase !== "not_started") {
          router.push(`/score/${setup.fixtureId}`);
          return;
        }
        const history = await readHistory(setup.fixtureId);
        const state = rallyEngine.replay(history.events);
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
              payload: { teamId: team.id, players: team.players.map((player) => player.id) },
            });
        payloads.push({ type: "rubber_started", payload: proposals[0] });
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
        rallyEngine.replay([
          ...history.events,
          ...events.map((entry, index) => ({
            ...entry,
            seq: state.lastSeq + index + 1,
            actorPersonId: actorId,
          })),
        ]);
        setLocked(true);
        pending.current = { deviceId, attempt: history.attempt, events };
      }
      const response = await post(`/api/score/${setup.fixtureId}/events`, pending.current);
      const rejected = response.acks?.find((ack) => ack.status === "rejected");
      if (rejected) throw new Error(rejected.message ?? "Check the selected players.");
      router.push(`/score/${setup.fixtureId}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Check match setup.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="score-setup rally-setup">
      <h1>Set up {setup.teams.map((team) => team.name).join(" vs ")}</h1>
      <fieldset className="score-condition-group">
        <legend>Match format</legend>
        <div className="score-tiles">
          {setup.formats.map((value) => (
            <Button
              key={value.key}
              variant="secondary"
              size="touch"
              aria-pressed={formatKey === value.key}
              disabled={busy || locked}
              onClick={() => {
                setFormatKey(value.key);
              }}
            >
              {value.label}
            </Button>
          ))}
        </div>
      </fieldset>
      <p>Choose the players for each rubber. Later rubbers start only when needed.</p>
      {proposals.slice(0, format.rubbers).map((value, index) => (
        <RubberSelection
          key={value.rubberNo}
          teams={setup.teams}
          value={value}
          onChange={(next) => {
            setProposals((current) => current.map((row, i) => (i === index ? next : row)));
          }}
        />
      ))}
      {error ? <p role="alert">{error}</p> : null}
      <Button
        size="touch"
        data-testid="rally-start"
        disabled={
          busy ||
          proposals
            .slice(0, format.rubbers)
            .some((row) => !row.homePlayers.length || !row.awayPlayers.length)
        }
        onClick={() => {
          void start();
        }}
      >
        {busy ? "Starting…" : "Start match"}
      </Button>
    </main>
  );
}
