"use client";
import { rallyEngine } from "@desiauction/core/scoring/rally-engine";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@desiauction/ui";
import {
  type MatchEvent,
  type NameBook,
  type Side,
  type RallyEventPayloads,
} from "@desiauction/core/scoring";
import type { RallyScoringSetup } from "../../../../server/scoring/home";
import { scoringRead } from "../../storage";
import { useRallyMatch } from "../use-rally-match";
import { RubberSelection, type RubberProposal } from "../rally-selection";
export function RallyPad({
  fixtureId,
  actorId,
  events,
  names,
  setup,
  sharePath,
  nextMatch,
}: {
  fixtureId: string;
  actorId: string;
  events: MatchEvent[];
  names: NameBook;
  setup: RallyScoringSetup;
  sharePath: string;
  nextMatch: string | null;
}) {
  const match = useRallyMatch(fixtureId, actorId, events, {
    actorId,
    names,
    setup,
    language: "en",
    sharePath,
    nextMatch,
  });
  const state = match.state,
    rubber = state.rubbers.at(-1),
    game = rubber?.games.at(-1);
  const result = rallyEngine.deriveResult(state);
  const [proposals, setProposals] = useState<RubberProposal[]>([]);
  const [selection, setSelection] = useState<RubberProposal | null>(null);
  const [details, setDetails] = useState(false);
  const [endedBy, setEndedBy] = useState<RallyEventPayloads["rally"]["endedBy"]>(undefined);
  const [volumeSupported, setVolumeSupported] = useState(false),
    [volumeOptIn, setVolumeOptIn] = useState(false);
  const playable =
    match.ready &&
    match.setupAccepted &&
    state.phase === "live" &&
    !game?.winner &&
    !state.finished;
  function point(winner: Side) {
    match.applyBatch([
      { type: "rally", payload: { winner, ...(details && endedBy ? { endedBy } : {}) } },
    ]);
  }
  useEffect(() => {
    let active = true;
    void scoringRead<{ actorId: string; proposals: RubberProposal[] }>(
      `ls1:rally-proposals:${fixtureId}`,
    )
      .then((value) => {
        if (active && value?.actorId === actorId && Array.isArray(value.proposals))
          setProposals(value.proposals);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [fixtureId, actorId]);
  useEffect(() => {
    if (!/Android/.test(navigator.userAgent) || !/Chrome\//.test(navigator.userAgent)) return;
    function key(event: KeyboardEvent) {
      if (event.key !== "AudioVolumeUp" && event.key !== "AudioVolumeDown") return;
      if (!volumeSupported) {
        setVolumeSupported(true);
        return;
      }
      if (
        !volumeOptIn ||
        !playable ||
        event.repeat ||
        (event.target instanceof HTMLElement &&
          event.target.closest(
            'textarea,select,[contenteditable],input:not([type="checkbox"]):not([type="radio"]):not([type="button"])',
          ))
      )
        return;
      point(event.key === "AudioVolumeUp" ? "home" : "away");
    }
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
    };
  });
  function nextGame() {
    const no = rubber?.winner ? rubber.no + 1 : (rubber?.no ?? 1);
    const proposed = proposals.find((row) => row.rubberNo === no);
    setSelection({
      rubberNo: no,
      homePlayers: rubber && !rubber.winner ? rubber.active.home : (proposed?.homePlayers ?? []),
      awayPlayers: rubber && !rubber.winner ? rubber.active.away : (proposed?.awayPlayers ?? []),
      firstServer: proposed?.firstServer ?? "home",
    });
  }
  return (
    <main className="score-home rally-pad" data-testid="rally-pad">
      <header className="score-header">
        <Link href="/score">Matches</Link>
        <a href={sharePath}>Watch live</a>
      </header>
      <h1>{setup.teams.map((team) => team.name).join(" vs ")}</h1>
      <p role="status">
        {match.offline
          ? `Offline · ${String(match.pending)} saved entries`
          : match.pending
            ? `${String(match.pending)} entries sending`
            : "Saved"}
      </p>
      {match.error ? <p role="alert">{match.error}</p> : null}
      <p className="score-cap">
        Rubber {rubber?.no ?? 1} · Game {game?.no ?? 1}
      </p>
      <div className="rally-score" aria-label="Current points">
        <strong data-testid="rally-home-points">{game?.points.home ?? 0}</strong>
        <span>–</span>
        <strong data-testid="rally-away-points">{game?.points.away ?? 0}</strong>
      </div>
      {game && !game.winner && !state.finished ? (
        <p data-testid="rally-server">
          Serving: {setup.teams[game.server === "home" ? 0 : 1].name}
        </p>
      ) : null}
      {state.streak ? (
        <p>
          {setup.teams[state.streak.side === "home" ? 0 : 1].name} · {state.streak.count} rallies in
          a row
        </p>
      ) : null}
      <p>Tap the side that won the rally.</p>
      <div className="rally-point-buttons">
        {(["home", "away"] as const).map((side, index) => (
          <Button
            key={side}
            size="touch"
            data-testid={`rally-point-${side}`}
            disabled={!playable}
            onClick={() => {
              point(side);
            }}
          >
            {setup.teams[index]?.name} · {game?.points[side] ?? 0}
          </Button>
        ))}
      </div>
      <Button
        variant="secondary"
        size="touch"
        data-testid="rally-undo"
        disabled={!match.ready || state.finished || !state.rallies.length}
        onClick={() => {
          match.undo();
        }}
      >
        Undo rally
      </Button>
      <Button
        variant="secondary"
        size="touch"
        aria-pressed={details}
        onClick={() => {
          setDetails(!details);
        }}
      >
        Track how points end
      </Button>
      {details ? (
        <fieldset>
          <legend>How the rally ended (optional)</legend>
          <div className="score-tiles">
            {(["ace", "winner", "error", "kill", "block", "fault"] as const).map((value) => (
              <Button
                key={value}
                variant="secondary"
                aria-pressed={endedBy === value}
                onClick={() => {
                  setEndedBy(endedBy === value ? undefined : value);
                }}
              >
                {value}
              </Button>
            ))}
          </div>
        </fieldset>
      ) : null}
      {volumeSupported ? (
        <label>
          <input
            type="checkbox"
            checked={volumeOptIn}
            onChange={(event) => {
              setVolumeOptIn(event.target.checked);
            }}
          />
          Use volume buttons: up for {setup.teams[0].name}, down for {setup.teams[1].name}
        </label>
      ) : null}
      {game?.winner && !result && !selection ? (
        <Button size="touch" data-testid="rally-next-game" onClick={nextGame}>
          Next {rubber?.winner ? "rubber" : "game"}
        </Button>
      ) : null}
      {selection ? (
        <>
          <RubberSelection teams={setup.teams} value={selection} onChange={setSelection} />
          <Button
            size="touch"
            disabled={
              !match.ready || !selection.homePlayers.length || !selection.awayPlayers.length
            }
            data-testid="rally-start-game"
            onClick={() => {
              if (match.applyBatch([{ type: "rubber_started", payload: selection }]))
                setSelection(null);
            }}
          >
            Start game
          </Button>
        </>
      ) : null}
      {result ? (
        <section>
          <h2 data-testid="rally-result">
            {result.winnerTeamId
              ? `${names.teams[result.winnerTeamId]?.name ?? "Winner"} won · `
              : ""}
            {result.marginText}
          </h2>
          {!state.finished ? (
            <Button
              size="touch"
              data-testid="rally-finish"
              disabled={!match.ready || match.pending > 0}
              onClick={() => {
                match.applyBatch([{ type: "finish", payload: {} }]);
              }}
            >
              Finish match
            </Button>
          ) : (
            <p>Match finished</p>
          )}
        </section>
      ) : null}
      <section>
        <h2>Games</h2>
        <ul>
          {state.rubbers.map((row) => (
            <li key={row.no}>
              Rubber {row.no}:{" "}
              {row.games
                .map((value) => `${String(value.points.home)}–${String(value.points.away)}`)
                .join(" · ")}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
