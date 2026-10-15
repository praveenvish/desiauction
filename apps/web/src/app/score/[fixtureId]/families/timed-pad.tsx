"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, TaskWorkspace } from "@desiauction/ui";
import { timedEngine } from "@desiauction/core/scoring/timed-engine";
import type { MatchEvent, NameBook } from "@desiauction/core/scoring";
import type { TimedScoringSetup } from "../../../../server/scoring/home";
import { timedStrings } from "../timed-strings";
import { useTimedMatch } from "../use-timed-match";
export function TimedPad({
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
  setup: TimedScoringSetup;
  sharePath: string;
  nextMatch: string | null;
  language?: "en" | "hi";
}) {
  const match = useTimedMatch(fixtureId, actorId, events, {
    actorId,
    names,
    setup,
    language,
    sharePath,
    nextMatch,
  });
  const state = match.state;
  const copy = (value: keyof typeof timedStrings.en) => timedStrings[language][value];
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const [side, setSide] = useState<"home" | "away">("home"),
    [scorer, setScorer] = useState(""),
    [assist, setAssist] = useState(""),
    [player, setPlayer] = useState(""),
    [incoming, setIncoming] = useState(""),
    [ownGoal, setOwnGoal] = useState(false),
    [penalty, setPenalty] = useState(false);
  const basket = setup.sport === "basketball",
    teamId = state.teams?.[side] ?? setup.teams[side === "home" ? 0 : 1].id;
  const active = state.active[side],
    other = side === "home" ? "away" : "home",
    scorers = ownGoal ? state.active[other] : active;
  const selectedPlayer = active.includes(player) ? player : (active[0] ?? "");
  const bench = (state.squads[teamId] ?? []).filter(
    (id) => !active.includes(id) && !state.red.includes(id),
  );
  const inId = bench.includes(incoming) ? incoming : (bench[0] ?? "");
  const ready = match.ready && match.setupAccepted && !state.finished && !state.interrupted;
  const open = ready && !state.periodClosed;
  const result = timedEngine.deriveResult(state);
  const delta =
    state.running && !state.periodClosed && now !== null
      ? Math.max(0, now - (state.anchorAt ?? now))
      : 0;
  const duration = (state.format?.periodMinutes ?? 0) * 60000,
    elapsed = Math.min(duration, state.periodElapsedMs + delta);
  const time = (ms: number) =>
    `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const name = (id: string) => names.players[id]?.name ?? "Player";
  function record(points: number) {
    match.applyBatch([
      {
        type: "score",
        payload: {
          teamId,
          points,
          ...(scorers.includes(scorer) ? { scorerId: scorer } : {}),
          ...(!basket && !ownGoal && active.includes(assist) && assist !== scorer
            ? { assistId: assist }
            : {}),
          ...(!basket && ownGoal ? { ownGoal: true } : {}),
          ...(!basket && penalty && !ownGoal ? { penalty: true } : {}),
        },
      },
    ]);
    setScorer("");
    setAssist("");
    setOwnGoal(false);
    setPenalty(false);
  }
  const playerControls = (
    <fieldset disabled={!open}>
      <legend>{copy("Players")}</legend>
      <label>
        {copy("Active player")}
        <select
          value={selectedPlayer}
          onChange={(event) => {
            setPlayer(event.target.value);
          }}
        >
          {active.map((id) => (
            <option key={id} value={id}>
              {name(id)}
            </option>
          ))}
        </select>
      </label>
      {basket ? (
        <Button
          size="touch"
          variant="secondary"
          disabled={!selectedPlayer}
          onClick={() => {
            match.applyBatch([{ type: "foul", payload: { teamId, playerId: selectedPlayer } }]);
          }}
        >
          {copy("Foul")}
        </Button>
      ) : (
        ["yellow", "red", ...(setup.sport === "hockey" ? ["green"] : [])].map((colour) => (
          <Button
            key={colour}
            size="touch"
            variant="secondary"
            disabled={!selectedPlayer}
            onClick={() => {
              match.applyBatch([
                {
                  type: "card",
                  payload: {
                    playerId: selectedPlayer,
                    colour: colour as "yellow" | "red" | "green",
                  },
                },
              ]);
            }}
          >
            {colour[0]?.toUpperCase()}
            {colour.slice(1)} card
          </Button>
        ))
      )}
      <label>
        {copy("Substitute in")}
        <select
          value={inId}
          onChange={(event) => {
            setIncoming(event.target.value);
          }}
        >
          <option value="">{copy("No substitute available")}</option>
          {bench.map((id) => (
            <option key={id} value={id}>
              {name(id)}
            </option>
          ))}
        </select>
      </label>
      <Button
        size="touch"
        disabled={!inId || !selectedPlayer}
        onClick={() => {
          match.applyBatch([{ type: "sub", payload: { teamId, inId, outId: selectedPlayer } }]);
          setPlayer("");
        }}
      >
        {copy("Substitute")}
      </Button>
    </fieldset>
  );
  return (
    <main className="score-home timed-pad family-pad" data-testid="timed-pad">
      <header className="score-header">
        <Link href="/score">{copy("Matches")}</Link>
        <a href={sharePath}>{copy("Watch live")}</a>
      </header>
      <p className="score-cap">
        {setup.fixtureNumber} · {copy("Timed scoring")}
      </p>
      <h1>{setup.teams.map((team) => team.name).join(" vs ")}</h1>
      <p role="status">
        {match.error
          ? copy("Check the match error before continuing.")
          : !match.ready
            ? copy("Restoring match…")
            : match.pending
              ? `${match.offline ? `${copy("Offline")} · ` : ""}${String(match.pending)} ${copy(match.offline ? "entries waiting to send" : "entries sending")}`
              : match.offline
                ? `${copy("Saved")} · ${copy("offline")}`
                : copy("Saved")}
      </p>
      {match.error ? <p role="alert">{match.error}</p> : null}
      <div className="rally-score" aria-label="Current score">
        <strong data-testid="timed-home-points">{state.points.home}</strong>
        <span>–</span>
        <strong data-testid="timed-away-points">{state.points.away}</strong>
      </div>
      <p>
        Period {state.period} of {state.format?.periods}
      </p>
      <output className="timed-clock" aria-label="Period clock">
        {time(elapsed)}
      </output>
      <TaskWorkspace
        className="family-workspace"
        label={copy("Scoring actions")}
        supportingLabel={copy("Player actions")}
        supporting={playerControls}
      >
        <div className="score-tiles">
          {state.periodClosed && state.period < (state.format?.periods ?? 0) ? (
            <Button
              size="touch"
              disabled={!ready}
              onClick={() => {
                match.applyBatch([
                  { type: "period_started", payload: { period: state.period + 1 } },
                ]);
              }}
            >
              Start period {state.period + 1}
            </Button>
          ) : null}
          <Button
            size="touch"
            disabled={!open}
            onClick={() => {
              match.applyBatch([{ type: "clock", payload: { running: !state.running } }]);
            }}
          >
            {state.running ? copy("Stop clock") : copy("Start clock")}
          </Button>
          <Button
            size="touch"
            variant="secondary"
            disabled={!open}
            onClick={() => {
              match.applyBatch([{ type: "period_ended", payload: { period: state.period } }]);
            }}
          >
            End period {state.period}
          </Button>
        </div>
        <p>{copy("Choose the team, then record the score.")}</p>
        <label>
          {copy("Team")}
          <select
            value={side}
            onChange={(event) => {
              setSide(event.target.value as "home" | "away");
              setPlayer("");
              setScorer("");
              setAssist("");
            }}
          >
            {setup.teams.map((team, index) => (
              <option key={team.id} value={index === 0 ? "home" : "away"}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset disabled={!open}>
          <legend>{basket ? "Points" : "Goal"}</legend>
          <label>
            {copy("Scorer (optional)")}
            <select
              value={scorers.includes(scorer) ? scorer : ""}
              onChange={(event) => {
                setScorer(event.target.value);
              }}
            >
              <option value="">{copy("Not recorded")}</option>
              {scorers.map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
            </select>
          </label>
          {!basket ? (
            <>
              <label>
                {copy("Assist (optional)")}
                <select
                  disabled={ownGoal}
                  value={assist}
                  onChange={(event) => {
                    setAssist(event.target.value);
                  }}
                >
                  <option value="">{copy("Not recorded")}</option>
                  {active
                    .filter((id) => id !== scorer)
                    .map((id) => (
                      <option key={id} value={id}>
                        {name(id)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={ownGoal}
                  onChange={(event) => {
                    setOwnGoal(event.target.checked);
                    setScorer("");
                    setAssist("");
                  }}
                />
                {copy("Own goal")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={penalty}
                  disabled={ownGoal}
                  onChange={(event) => {
                    setPenalty(event.target.checked);
                  }}
                />
                {copy("Penalty goal")}
              </label>
            </>
          ) : null}
          {state.format?.scoreUnits.map((points) => (
            <Button
              key={points}
              size="touch"
              onClick={() => {
                record(points);
              }}
            >
              {basket ? `+ ${String(points)} points` : copy("+ Goal")}
            </Button>
          ))}
        </fieldset>
        {state.shootout && !state.shootout.winner ? (
          <fieldset disabled={!ready}>
            <legend>
              Shootout · {names.teams[state.teams?.[state.shootout.nextSide] ?? ""]?.name}
            </legend>
            <label>
              {copy("Penalty taker")}
              <select
                value={
                  state.shootout.eligible[state.shootout.nextSide].includes(player)
                    ? player
                    : (state.shootout.eligible[state.shootout.nextSide].find(
                        (id) => !state.shootout?.used[state.shootout.nextSide].includes(id),
                      ) ??
                      state.shootout.eligible[state.shootout.nextSide][0] ??
                      "")
                }
                onChange={(event) => {
                  setPlayer(event.target.value);
                }}
              >
                {state.shootout.eligible[state.shootout.nextSide].map((id) => (
                  <option
                    key={id}
                    value={id}
                    disabled={
                      !!state.shootout &&
                      state.shootout.used[state.shootout.nextSide].length <
                        state.shootout.eligible[state.shootout.nextSide].length &&
                      state.shootout.used[state.shootout.nextSide].includes(id)
                    }
                  >
                    {name(id)}
                  </option>
                ))}
              </select>
            </label>
            {[true, false].map((scored) => (
              <Button
                key={String(scored)}
                size="touch"
                onClick={() => {
                  const shootout = state.shootout;
                  if (!shootout || !state.teams) return;
                  const eligible = shootout.eligible[shootout.nextSide],
                    used = shootout.used[shootout.nextSide];
                  const playerId =
                    eligible.includes(player) && !used.includes(player)
                      ? player
                      : (eligible.find((id) => !used.includes(id)) ?? eligible[0]);
                  if (playerId)
                    match.applyBatch([
                      {
                        type: "shootout_attempt",
                        payload: { teamId: state.teams[shootout.nextSide], playerId, scored },
                      },
                    ]);
                  setPlayer("");
                }}
              >
                {scored ? copy("Penalty scored") : copy("Penalty missed")}
              </Button>
            ))}
          </fieldset>
        ) : null}
        {state.shootout ? (
          <p aria-label="Shootout score">
            Penalties {state.shootout.points.home}–{state.shootout.points.away}
          </p>
        ) : null}
        <Button
          size="touch"
          variant="secondary"
          disabled={!match.ready || state.finished || state.periodClosed}
          onClick={() => {
            match.applyBatch([
              state.interrupted
                ? { type: "resume", payload: {} }
                : { type: "interrupt", payload: { reason: "other" } },
            ]);
          }}
        >
          {state.interrupted ? copy("Resume match") : copy("Interrupt match")}
        </Button>
        <Button
          size="touch"
          variant="secondary"
          disabled={!ready}
          onClick={() => {
            match.undo();
          }}
        >
          {copy("Undo last entry")}
        </Button>
        {result ? (
          <>
            <p>{result.marginText}</p>
            <Button
              size="touch"
              disabled={!ready}
              onClick={() => {
                match.applyBatch([{ type: "finish", payload: {} }]);
              }}
            >
              {copy("Finish match")}
            </Button>
          </>
        ) : null}
        {state.finished && match.ready && match.pending === 0 && !match.error ? (
          <>
            <p>{copy("Match finished")}</p>
            <a href={sharePath}>{copy("View result")}</a>
            {nextMatch ? <Link href={nextMatch}>{copy("Next match")}</Link> : null}
          </>
        ) : state.finished ? (
          <p role="status">{copy("Finish waiting for acceptance")}</p>
        ) : null}
      </TaskWorkspace>
      <p className="family-award-note">
        {setup.sport === "hockey"
          ? "Player awards are unavailable for hockey scoring."
          : basket
            ? "Player awards use recorded points and fouls."
            : "Player awards use recorded goals, assists, cards and eligible clean sheets. In-play penalty saves and misses are not tracked."}
      </p>
    </main>
  );
}
