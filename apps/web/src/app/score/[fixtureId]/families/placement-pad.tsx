"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, TaskWorkspace } from "@desiauction/ui";
import { placementEngine } from "@desiauction/core/scoring/placement-engine";
import type { MatchEvent, NameBook } from "@desiauction/core/scoring";
import type { PlacementScoringSetup } from "../../../../server/scoring/home";
import { usePlacementMatch } from "../use-placement-match";
import { PlacementLiveScore } from "../../../../components/scoring/placement-panel";
const strings = {
  en: {
    restoring: "Restoring match…",
    matchError: "Check the match error before continuing.",
    offline: "offline",
    offlineHeading: "Offline",
    waiting: "entries waiting to send",
    sending: "entries sending",
    finishPending: "Finish waiting for acceptance",
    entryHint: "Enter each squad’s placement and player kills. Zero kills are included.",
    roundsCompleted: "rounds completed",
    review: "Round progress",
    scoring: "Round entry",
    players: "players",

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
    restoring: "मैच पुनर्स्थापित हो रहा है…",
    matchError: "आगे बढ़ने से पहले मैच की त्रुटि देखें।",
    offline: "ऑफ़लाइन",
    offlineHeading: "ऑफ़लाइन",
    waiting: "प्रविष्टियाँ भेजने की प्रतीक्षा में",
    sending: "प्रविष्टियाँ भेजी जा रही हैं",
    finishPending: "मैच समाप्त करने की स्वीकृति की प्रतीक्षा",
    entryHint: "हर स्क्वाड का स्थान और खिलाड़ियों के किल दर्ज करें। शून्य किल भी शामिल हैं।",
    roundsCompleted: "राउंड पूरे हुए",
    review: "राउंड की प्रगति",
    scoring: "राउंड दर्ज करें",
    players: "खिलाड़ी",

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
  const finishAccepted = state.finished && match.ready && match.pending === 0 && !match.error;
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
    <main className="score-home placement-pad family-pad" data-testid="placement-pad">
      <header className="score-header">
        <Link href="/score">{copy.matches}</Link>
        <a href={sharePath}>{copy.watch}</a>
      </header>
      <h1>Lobby · {setup.fixtureNumber}</h1>
      <p role="status">
        {match.error
          ? copy.matchError
          : !match.ready
            ? copy.restoring
            : match.pending
              ? `${match.offline ? `${copy.offlineHeading} · ` : ""}${String(match.pending)} ${match.offline ? copy.waiting : copy.sending}`
              : match.offline
                ? `${copy.saved} · ${copy.offline}`
                : copy.saved}
      </p>
      {match.error ? <p role="alert">{match.error}</p> : null}
      <PlacementLiveScore
        panel={placementEngine.publicLiveState(state, names).panel}
        live={placementEngine.publicLiveState(state, names)}
      />
      <TaskWorkspace
        className="family-workspace"
        label={copy.scoring}
        supportingLabel={copy.review}
        supporting={
          <section>
            <h2>{copy.review}</h2>
            <p>
              {state.rounds.length} / {state.format?.rounds ?? setup.format.rounds}{" "}
              {copy.roundsCompleted}
            </p>
            <p>
              {state.teamIds.length} {language === "hi" ? "स्क्वाड" : "squads"}
            </p>
          </section>
        }
      >
        {!state.finished && !result ? (
          <>
            <h2>Round {state.rounds.length + 1}</h2>
            <p>{copy.entryHint}</p>
            <div className="family-squad-grid">
              {state.teamIds.map((id, index) => (
                <details open key={id} className="family-squad-entry">
                  <summary>
                    {names.teams[id]?.name ?? "Squad"} · {(state.squads[id] ?? []).length}{" "}
                    {copy.players}
                  </summary>
                  <fieldset aria-label={names.teams[id]?.name ?? "Squad"}>
                    <legend className="score-sr-only">{names.teams[id]?.name ?? "Squad"}</legend>
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
                </details>
              ))}
            </div>
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
          <p data-testid={finishAccepted ? "placement-finished" : "placement-finish-pending"}>
            {finishAccepted ? copy.finished : copy.finishPending}
          </p>
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
        {finishAccepted && nextMatch ? <Link href={nextMatch}>Next match</Link> : null}
      </TaskWorkspace>
    </main>
  );
}
