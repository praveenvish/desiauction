"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, TaskWorkspace } from "@desiauction/ui";
import { raidEngine } from "@desiauction/core/scoring/raid-engine";
import type { MatchEvent, NameBook } from "@desiauction/core/scoring";
import type { RaidScoringSetup } from "../../../../server/scoring/home";
import { useRaidMatch } from "../use-raid-match";
export function RaidPad({
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
  setup: RaidScoringSetup;
  sharePath: string;
  nextMatch: string | null;
}) {
  const match = useRaidMatch(fixtureId, actorId, events, {
    actorId,
    names,
    setup,
    language: "en",
    sharePath,
    nextMatch,
  });
  const state = match.state;
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const side = state.nextRaidingSide,
    defence = side === "home" ? "away" : "home";
  const [pickedRaider, setPickedRaider] = useState("");
  const raider = state.mat[side].includes(pickedRaider) ? pickedRaider : (state.mat[side][0] ?? "");
  const [touched, setTouched] = useState<string[]>([]),
    [lineOut, setLineOut] = useState<string[]>([]),
    [bonus, setBonus] = useState(false),
    [tackled, setTackled] = useState(false),
    [primary, setPrimary] = useState(""),
    [assists, setAssists] = useState<string[]>([]);
  const playable =
    match.ready &&
    match.setupAccepted &&
    state.running &&
    !state.interrupted &&
    !state.finished &&
    !state.halfClosed;
  const delta =
    state.running && !state.halfClosed && now !== null
      ? Math.max(0, now - (state.anchorAt ?? now))
      : 0;
  const limit = (state.format?.halfMinutes ?? 20) * 60000,
    elapsed = Math.min(limit, state.halfElapsedMs + delta);
  const raidElapsed = Math.min(
    30000,
    (state.raidStartGameMs === null ? 0 : state.gameElapsedMs - state.raidStartGameMs) + delta,
  );
  const time = (ms: number) =>
    `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const name = (id: string) => names.players[id]?.name ?? "Player";
  function reset() {
    setTouched([]);
    setLineOut([]);
    setBonus(false);
    setTackled(false);
    setPrimary("");
    setAssists([]);
    setPickedRaider("");
  }
  function record(empty = false) {
    match.applyBatch([
      {
        type: "raid",
        payload: {
          raiderId: raider,
          touchedIds:
            empty || tackled ? [] : touched.filter((id) => state.mat[defence].includes(id)),
          lineOut: empty
            ? []
            : lineOut.filter((id) => id === raider || state.mat[defence].includes(id)),
          bonus: empty ? false : bonus,
          tackled: empty ? false : tackled,
          tacklerIds:
            !empty && tackled
              ? [
                  primary,
                  ...assists.filter((id) => id !== primary && state.mat[defence].includes(id)),
                ]
              : [],
        },
      },
    ]);
    reset();
  }
  const result = raidEngine.deriveResult(state),
    bonusAllowed = state.mat[defence].length >= 6,
    primaryValid = state.mat[defence].includes(primary);
  const finishAccepted = state.finished && match.ready && match.pending === 0 && !match.error;
  return (
    <main className="score-home raid-pad family-pad" data-testid="raid-pad">
      <header className="score-header">
        <Link href="/score">Matches</Link>
        <a href={sharePath}>Watch live</a>
      </header>
      <p className="score-cap">{setup.fixtureNumber} · Raid scoring</p>
      <h1>{setup.teams.map((team) => team.name).join(" vs ")}</h1>
      <p role="status">
        {match.error
          ? "Check the match error before continuing."
          : !match.ready
            ? "Restoring match…"
            : match.pending
              ? match.offline
                ? `Offline · ${String(match.pending)} entries waiting to send`
                : `${String(match.pending)} entries sending`
              : match.offline
                ? "Saved · offline"
                : "Saved"}
      </p>
      {match.error ? <p role="alert">{match.error}</p> : null}
      <div className="rally-score" aria-label="Current points">
        <strong data-testid="raid-home-points">{state.points.home}</strong>
        <span>–</span>
        <strong data-testid="raid-away-points">{state.points.away}</strong>
      </div>
      <p>
        Half {state.half || 1} · <span data-testid="raid-half-clock">{time(elapsed)}</span>
      </p>
      <p>
        Raid timer (advisory): <span data-testid="raid-timer">{time(30000 - raidElapsed)}</span>
      </p>
      <TaskWorkspace
        className="family-workspace"
        label="Raid scoring actions"
        supportingLabel="Mat and revival order"
        supporting={
          <div className="family-mat-summary">
            {(["home", "away"] as const).map((matSide, index) => (
              <section key={matSide} aria-label={`${setup.teams[index]?.name ?? "Team"} mat`}>
                <h2>
                  {setup.teams[index]?.name} · {state.mat[matSide].length} on mat
                </h2>
                <div className="raid-mat">
                  {state.starters[matSide].map((id) => (
                    <span
                      key={id}
                      className={`raid-mat-player ${state.mat[matSide].includes(id) ? "is-active" : "is-out"}`}
                      aria-label={`${name(id)}: ${state.mat[matSide].includes(id) ? "on mat" : state.cards[id]?.red ? "red card" : state.cards[id]?.untilGameMs ? "suspended" : "out"}`}
                      title={name(id)}
                    >
                      <span aria-hidden="true">{state.mat[matSide].includes(id) ? "●" : "○"}</span>
                      {name(id)}
                    </span>
                  ))}
                </div>
                <p data-testid={`raid-outs-${matSide}`}>
                  Outs FIFO: {state.outs[matSide].map(name).join(" → ") || "None"}
                </p>
              </section>
            ))}
          </div>
        }
      >
        {state.halfClosed && !state.finished && !result ? (
          <Button
            size="touch"
            disabled={!match.ready || !match.setupAccepted}
            data-testid="raid-start-half"
            onClick={() =>
              match.applyBatch([
                { type: "half_started", payload: { half: state.half === 0 ? 1 : 2 } },
              ])
            }
          >
            Start half {state.half === 0 ? 1 : 2}
          </Button>
        ) : null}
        {!state.halfClosed && !state.finished ? (
          <div className="score-tiles">
            <Button
              disabled={!match.ready || elapsed >= limit || state.interrupted}
              data-testid="raid-clock-toggle"
              onClick={() =>
                match.applyBatch([{ type: "clock", payload: { running: !state.running } }])
              }
            >
              {state.running ? "Pause clock" : "Start clock"}
            </Button>
            <Button
              variant="secondary"
              data-testid="raid-end-half"
              disabled={!match.ready || state.interrupted}
              onClick={() => match.applyBatch([{ type: "half_ended", payload: {} }])}
            >
              End half {state.half}
            </Button>
            <Button
              variant="secondary"
              disabled={!match.ready}
              onClick={() =>
                match.applyBatch([
                  state.interrupted
                    ? { type: "resume", payload: {} }
                    : { type: "interrupt", payload: { reason: "other" } },
                ])
              }
            >
              {state.interrupted ? "Resume match" : "Interrupt match"}
            </Button>
          </div>
        ) : null}
        {!state.halfClosed && !state.finished ? (
          <>
            <h2 className="family-active-side" data-testid="raid-side">
              Raiding: {setup.teams[side === "home" ? 0 : 1].name}
            </h2>
            <p>
              Choose the raider and outcome, then record the raid. {state.mat[defence].length}{" "}
              defenders are on the mat.
            </p>
            {state.empty[side] >= 2 ? (
              <p className="score-cap" data-testid="raid-dod">
                Do-or-die raid
              </p>
            ) : null}
            <label>
              Current raider
              <select
                value={raider}
                disabled={!playable}
                onChange={(event) => {
                  setPickedRaider(event.target.value);
                }}
              >
                {state.mat[side].map((id) => (
                  <option key={id} value={id}>
                    {name(id)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="family-player-choices" disabled={!playable || tackled}>
              <legend>Defenders touched</legend>
              {state.mat[defence].map((id) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    disabled={lineOut.includes(id)}
                    checked={touched.includes(id)}
                    onChange={(event) => {
                      setTouched(
                        event.target.checked
                          ? [...touched, id]
                          : touched.filter((value) => value !== id),
                      );
                    }}
                  />
                  {name(id)}
                </label>
              ))}
            </fieldset>
            <fieldset className="family-player-choices" disabled={!playable}>
              <legend>Line outs (optional)</legend>
              {[raider, ...state.mat[defence]].filter(Boolean).map((id) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={lineOut.includes(id)}
                    disabled={
                      touched.includes(id) ||
                      (tackled && (id === raider || primary === id || assists.includes(id)))
                    }
                    onChange={(event) => {
                      setLineOut(
                        event.target.checked
                          ? [...lineOut, id]
                          : lineOut.filter((value) => value !== id),
                      );
                    }}
                  />
                  {name(id)}
                  {id === raider ? " (raider)" : ""}
                </label>
              ))}
            </fieldset>
            <label>
              <input
                type="checkbox"
                checked={bonus && bonusAllowed}
                disabled={!playable || !bonusAllowed}
                onChange={(event) => {
                  setBonus(event.target.checked);
                }}
              />
              Bonus
            </label>
            {!bonusAllowed ? <p>Bonus needs at least 6 defenders on the mat.</p> : null}
            <label>
              <input
                type="checkbox"
                checked={tackled}
                disabled={!playable}
                onChange={(event) => {
                  setTackled(event.target.checked);
                  setTouched([]);
                  setLineOut([]);
                  setPrimary("");
                  setAssists([]);
                }}
              />
              Tackled
            </label>
            {tackled ? (
              <fieldset disabled={!playable}>
                <legend>Choose the primary tackler</legend>
                {state.mat[defence].map((id) => (
                  <label key={id}>
                    <input
                      type="radio"
                      name="primary-tackler"
                      disabled={lineOut.includes(id)}
                      checked={primary === id}
                      onChange={() => {
                        setPrimary(id);
                      }}
                    />
                    {name(id)}
                  </label>
                ))}
                <fieldset>
                  <legend>Tackle assists (optional)</legend>
                  {state.mat[defence]
                    .filter((id) => id !== primary)
                    .map((id) => (
                      <label key={id}>
                        <input
                          type="checkbox"
                          disabled={lineOut.includes(id)}
                          checked={assists.includes(id)}
                          onChange={(event) => {
                            setAssists(
                              event.target.checked
                                ? [...assists, id]
                                : assists.filter((value) => value !== id),
                            );
                          }}
                        />
                        {name(id)}
                      </label>
                    ))}
                </fieldset>
              </fieldset>
            ) : null}
            <div className="score-tiles">
              <Button
                size="touch"
                data-testid="raid-record"
                disabled={!playable || elapsed >= limit || !raider || (tackled && !primaryValid)}
                onClick={() => {
                  record();
                }}
              >
                Record raid
              </Button>
              <Button
                size="touch"
                variant="secondary"
                data-testid="raid-empty"
                disabled={!playable || elapsed >= limit || !raider}
                onClick={() => {
                  record(true);
                }}
              >
                Empty raid
              </Button>
            </div>
          </>
        ) : null}
        {!state.halfClosed && !state.finished && (
          <section aria-label="Discipline and technical points">
            <h2>Discipline and technical points</h2>
            {setup.teams.map((team) => (
              <details key={team.id}>
                <summary>{team.name}</summary>
                <Button
                  disabled={!playable || elapsed >= limit}
                  onClick={() =>
                    match.applyBatch([
                      {
                        type: "technical_point",
                        payload: { teamId: team.id, reason: "Technical point awarded" },
                      },
                    ])
                  }
                >
                  Technical point for {team.name}
                </Button>
                {team.players.map((player) => (
                  <div key={player.id}>
                    <span>{player.name}</span>
                    {(["green", "yellow", "red"] as const).map((card) => (
                      <Button
                        key={card}
                        variant="secondary"
                        disabled={
                          !playable ||
                          elapsed >= limit ||
                          !state.starters[team.id === state.teams?.home ? "home" : "away"].includes(
                            player.id,
                          )
                        }
                        onClick={() =>
                          match.applyBatch([
                            { type: `${card}_card`, payload: { playerId: player.id } },
                          ])
                        }
                      >
                        {card === "green"
                          ? "Green · 2 minutes"
                          : card === "yellow"
                            ? "Yellow · warning"
                            : "Red · match"}
                      </Button>
                    ))}
                  </div>
                ))}
              </details>
            ))}
          </section>
        )}
        <Button
          variant="secondary"
          data-testid="raid-undo"
          disabled={!match.ready || state.finished || !state.raids.length}
          onClick={() => {
            match.undo();
            reset();
          }}
        >
          Undo raid
        </Button>
        {result ? (
          <section>
            <h2>{result.marginText}</h2>
            {!state.finished ? (
              <Button
                size="touch"
                data-testid="raid-finish"
                disabled={!match.ready}
                onClick={() => match.applyBatch([{ type: "finish", payload: {} }])}
              >
                Finish match
              </Button>
            ) : finishAccepted ? (
              <p data-testid="raid-finished">Match complete</p>
            ) : (
              <p data-testid="raid-finish-pending">
                Finish waiting for acceptance{match.error ? " — check the match error above." : "."}
              </p>
            )}
          </section>
        ) : null}
      </TaskWorkspace>
    </main>
  );
}
