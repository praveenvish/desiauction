"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@desiauction/ui";
import { placementEngine } from "@desiauction/core/scoring/placement-engine";
import type { MatchEvent, NameBook } from "@desiauction/core/scoring";
import type { PlacementScoringSetup } from "../../../../server/scoring/home";
import { usePlacementMatch } from "../use-placement-match";
import { PlacementLiveScore } from "../../../../components/scoring/placement-panel";
const strings = {
  en: {
    matches: "Matches",
    watch: "Watch live",
    saved: "Saved",
    record: "Save round",
    finish: "Finish match",
    undo: "Undo last round",
    stopped: "Play stopped",
    pause: "Stop play",
    resume: "Resume play",
    placement: "Placement",
    kills: "Kills",
    finished: "Match finished",
  },
  hi: {
    matches: "मैच",
    watch: "लाइव देखें",
    saved: "सहेजा गया",
    record: "राउंड सहेजें",
    finish: "मैच समाप्त करें",
    undo: "पिछला राउंड वापस लें",
    stopped: "खेल रुका हुआ है",
    pause: "खेल रोकें",
    resume: "खेल जारी रखें",
    placement: "स्थान",
    kills: "किल",
    finished: "मैच समाप्त",
  },
};
export function PlacementPad({
  fixtureId,
  actorId,
  events,
  names,
  setup,
  sharePath,
  nextMatch,
  language = "en",
}: {
  fixtureId: string;
  actorId: string;
  events: MatchEvent[];
  names: NameBook;
  setup: PlacementScoringSetup;
  sharePath: string;
  nextMatch: string | null;
  language?: "en" | "hi";
}) {
  const match = usePlacementMatch(fixtureId, actorId, events, {
      actorId,
      names,
      setup,
      sharePath,
      nextMatch,
      language,
    }),
    state = match.state,
    copy = strings[language];
  const [placements, setPlacements] = useState<Record<string, number>>({}),
    [kills, setKills] = useState<Record<string, number>>({});
  const ready = match.ready && match.setupAccepted && !state.finished && !state.interrupted;
  const result = placementEngine.deriveResult(state);
  function record() {
    match.applyBatch([
      {
        type: "lobby_round",
        payload: {
          round: state.rounds.length + 1,
          rows: state.teamIds.map((teamId, index) => {
            const playerKills = Object.fromEntries(
              (state.squads[teamId] ?? []).map((id) => [id, kills[id] ?? 0]),
            );
            return {
              teamId,
              placement: placements[teamId] ?? index + 1,
              kills: Object.values(playerKills).reduce((a, b) => a + b, 0),
              playerKills,
            };
          }),
        },
      },
    ]);
  }
  return (
    <main className="score-home placement-pad" data-testid="placement-pad">
      <header className="score-header">
        <Link href="/score">{copy.matches}</Link>
        <a href={sharePath}>{copy.watch}</a>
      </header>
      <h1>Lobby · {setup.fixtureNumber}</h1>
      <p role="status">
        {match.offline
          ? `Offline · ${String(match.pending)} saved entries`
          : match.pending
            ? `${String(match.pending)} entries sending`
            : copy.saved}
      </p>
      {match.error ? <p role="alert">{match.error}</p> : null}
      <PlacementLiveScore
        panel={placementEngine.publicLiveState(state, names).panel}
        live={placementEngine.publicLiveState(state, names)}
      />
      {!state.finished && !result ? (
        <>
          <h2>Round {state.rounds.length + 1}</h2>
          {state.teamIds.map((id, index) => (
            <fieldset key={id}>
              <legend>{names.teams[id]?.name ?? "Squad"}</legend>
              <label>
                {copy.placement}
                <input
                  aria-label={`${names.teams[id]?.name ?? "Squad"} placement`}
                  type="number"
                  min={1}
                  max={state.teamIds.length}
                  value={placements[id] ?? index + 1}
                  disabled={!ready}
                  onChange={(e) => {
                    setPlacements({ ...placements, [id]: Number(e.target.value) });
                  }}
                />
              </label>
              {(state.squads[id] ?? []).map((player) => (
                <label key={player}>
                  {names.players[player]?.name ?? "Player"} · {copy.kills}
                  <input
                    aria-label={`${names.players[player]?.name ?? "Player"} kills`}
                    type="number"
                    min={0}
                    max={100}
                    value={kills[player] ?? 0}
                    disabled={!ready}
                    onChange={(e) => {
                      setKills({ ...kills, [player]: Number(e.target.value) });
                    }}
                  />
                </label>
              ))}
            </fieldset>
          ))}
          <Button size="touch" disabled={!ready} onClick={record}>
            {copy.record}
          </Button>
        </>
      ) : null}
      <Button
        size="touch"
        disabled={!match.ready || !state.rounds.length || state.finished}
        onClick={() => match.undo()}
      >
        {copy.undo}
      </Button>
      {state.finished ? (
        <p>{copy.finished}</p>
      ) : state.interrupted ? (
        <>
          <p>{copy.stopped}</p>
          <Button
            size="touch"
            disabled={!match.ready}
            onClick={() => match.applyBatch([{ type: "resume", payload: {} }])}
          >
            {copy.resume}
          </Button>
        </>
      ) : (
        <Button
          size="touch"
          disabled={!ready}
          onClick={() => match.applyBatch([{ type: "interrupt", payload: { reason: "other" } }])}
        >
          {copy.pause}
        </Button>
      )}
      {result && !state.finished ? (
        <Button
          size="touch"
          disabled={!ready}
          onClick={() => match.applyBatch([{ type: "finish", payload: {} }])}
        >
          {copy.finish}
        </Button>
      ) : null}
      {state.finished && nextMatch ? <Link href={nextMatch}>Next match</Link> : null}
    </main>
  );
}
