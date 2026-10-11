"use client";
import { bowlingStyleLabel } from "@desiauction/core";
import { Component, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { PlayerPortrait, Button, Dialog } from "@desiauction/ui";
import {
  publicLiveState,
  deriveResult,
  BATTING_HANDS,
  type BattingHand,
  type MatchEvent,
  type NameBook,
  type BallPayload,
  type BallSummary,
} from "@desiauction/core/scoring";
import type { ScoringSetup } from "../../../server/scoring/home";
import { useMatch } from "./use-match";
import { useCallback } from "react";
import { scoringActions, effectiveStyle, dismissalKey } from "./sheets/sheet-model";
import { BowlerSheet } from "./sheets/bowler-sheet";
import { BatterSheet } from "./sheets/batter-sheet";
import { StyleAsk } from "./sheets/style-ask";
import { ShotSheet } from "./sheets/shot-sheet";
import { WicketSheet } from "./sheets/wicket-sheet";
import type { ShotMode, ScoreTheme } from "./sheets/menu-sheet";
import { inningsStartPayload } from "./sheets/innings-start-model";
import { missingRestartSetupEntries } from "./sheets/menu-model";
import { strings } from "./strings";
import "./pad.css";

function SheetLoading() {
  return (
    <div className="scoring-sheet-loading" role="status">
      Opening match options…
    </div>
  );
}
const InningsStartSheet = dynamic(
  () => import("./sheets/options-entry").then((module) => module.InningsStartSheet),
  { loading: SheetLoading },
);
const HandoverSheet = dynamic(
  () => import("./sheets/options-entry").then((module) => module.HandoverSheet),
  { loading: SheetLoading },
);
const MenuSheet = dynamic(
  () => import("./sheets/options-entry").then((module) => module.MenuSheet),
  {
    loading: SheetLoading,
  },
);
const EditBallSheet = dynamic(
  () => import("./sheets/options-entry").then((module) => module.EditBallSheet),
  { loading: SheetLoading },
);
const FinishSheet = dynamic(
  () => import("./sheets/options-entry").then((module) => module.FinishSheet),
  { loading: SheetLoading },
);
const ReviseSheet = dynamic(
  () => import("./sheets/options-entry").then((module) => module.ReviseSheet),
  { loading: SheetLoading },
);
class SheetBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <Dialog
          open
          title="Match options could not open"
          onClose={this.props.onRetry}
          footer={<Button onClick={this.props.onRetry}>Try again</Button>}
        >
          <p>Your scoring entries stay saved on this phone. Reload to try again.</p>
        </Dialog>
      );
    return this.props.children;
  }
}

type Modifier = "wide" | "noBall" | "bye" | "legBye";
export function Pad({
  fixtureId,
  actorId,
  events,
  names,
  setup,
  language,
  sharePath,
  nextMatch,
  matchupHints = {},
}: {
  fixtureId: string;
  actorId: string;
  events: MatchEvent[];
  names: NameBook;
  setup: ScoringSetup;
  language: "en" | "hi";
  sharePath: string;
  nextMatch: string | null;
  matchupHints?: Record<string, string>;
}) {
  const match = useMatch(fixtureId, actorId, events, {
      actorId,
      names,
      setup,
      language,
      sharePath,
      nextMatch,
    }),
    copy = strings[language];
  const router = useRouter();
  const [finishDismissed, setFinishDismissed] = useState(false);
  const [handover, setHandover] = useState(false);
  const [takeover, setTakeover] = useState(false);
  const [takingOver, setTakingOver] = useState(false);
  const [takeoverError, setTakeoverError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [revise, setRevise] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editing, setEditing] = useState<BallSummary | null>(null);
  const [shotMode, setShotMode] = useState<ShotMode>(setup.shotMap);
  useEffect(() => {
    const value = localStorage.getItem(`ls1:shot-map:${fixtureId}`);
    if (value === "every" || value === "boundaries" || value === "off")
      void Promise.resolve().then(() => {
        setShotMode(value);
      });
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      if (localStorage.getItem("ls1:theme") === "auto")
        document.documentElement.setAttribute(
          "data-theme",
          media.matches ? "floodlight" : "daylight",
        );
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, [fixtureId]);
  function changeTheme(theme: ScoreTheme) {
    localStorage.setItem("ls1:theme", theme);
    document.documentElement.setAttribute(
      "data-theme",
      theme === "auto"
        ? matchMedia("(prefers-color-scheme: dark)").matches
          ? "floodlight"
          : "daylight"
        : theme,
    );
  }
  useEffect(() => {
    if (
      !match.ready ||
      match.pending > 0 ||
      match.state.attempt <= 1 ||
      match.state.toss ||
      match.error
    )
      return;
    const restart = match.state.eventHistory.findLast((event) => event.type === "restart");
    if (!restart || !match.accepted(restart.eventId)) return;
    const entries = missingRestartSetupEntries(match.state, restart.eventId);
    if (entries.length) {
      if (entries.length) void Promise.resolve().then(() => match.applyBatch(entries));
    } else {
      router.replace(`/score/${fixtureId}/setup`);
    }
  }, [match, fixtureId, router]);
  const [wicket, setWicket] = useState(false);
  const [shot, setShot] = useState<{ id: string; payload: BallPayload; hand: BattingHand } | null>(
    null,
  );
  const closeShot = useCallback(() => {
    setShot(null);
  }, []);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const players = setup.teams.flatMap((team) => team.players);
  useEffect(() => {
    const saved = new Set<string>();
    for (const player of setup.teams.flatMap((team) => team.players))
      for (const what of ["battingHand", "bowlingStyle"] as const) {
        if (localStorage.getItem(dismissalKey(fixtureId, player.id, what)))
          saved.add(`${player.id}:${what}`);
      }
    void Promise.resolve().then(() => {
      setDismissed(saved);
    });
  }, [fixtureId, setup.teams]);
  const actions = scoringActions(match.state, players, dismissed);
  const startInnings = actions.find((action) => action.kind === "start_innings");
  const pickBowler = actions.find((action) => action.kind === "pick_bowler");
  const pickBatter = actions.find((action) => action.kind === "pick_new_batter");
  const askStyle = actions.find((action) => action.kind === "ask_style");
  const [modifier, setModifier] = useState<Modifier | null>(null);
  const [more, setMore] = useState(false),
    [extraRuns, setExtraRuns] = useState(7);
  const [toast, setToast] = useState<{ id: string; label: string } | null>(null);
  const state = match.state,
    inning = state.currentInnings === null ? undefined : state.innings[state.currentInnings];
  const live = publicLiveState(state, names);
  const batting = inning ? names.teams[inning.battingTeamId] : undefined;
  const left = live.ballsLeft;
  const fraction = left === null ? 0 : left / Math.max(1, left + (inning?.legalBalls ?? 0));
  const finishAction = actions.find((action) => action.kind === "finish");
  const result =
    finishAction?.kind === "finish"
      ? finishAction.result
      : state.finished
        ? deriveResult(state)
        : null;
  const canScore =
    match.ready &&
    state.phase === "live" &&
    !inning?.closed &&
    Boolean(inning?.strikerId && inning.bowlerId);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 5000);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);
  function delivery(runs: number): BallPayload | null {
    if (!inning || !canScore || !inning.bowlerId || !inning.strikerId) return null;
    const extras: BallPayload["extras"] = {};
    if (modifier === "wide") extras.wides = (state.format?.wideRuns ?? 1) + runs;
    if (modifier === "noBall") extras.noBall = true;
    if (modifier === "bye" && runs > 0) extras.byes = runs;
    if (modifier === "legBye" && runs > 0) extras.legByes = runs;
    const batRuns = modifier === "wide" || modifier === "bye" || modifier === "legBye" ? 0 : runs;
    return {
      bowlerId: inning.bowlerId,
      strikerId: inning.strikerId,
      nonStrikerId: inning.nonStrikerId,
      runsBat: batRuns,
      extras,
      ...(batRuns === 4 || batRuns === 6 ? { boundary: batRuns } : {}),
    };
  }
  function run(runs: number) {
    const payload = delivery(runs);
    if (!payload) return;
    const hand =
      effectiveStyle(
        state,
        players.find((player) => player.id === payload.strikerId),
        payload.strikerId,
      ).battingHand ?? BATTING_HANDS[0];
    const id = match.apply("ball", payload);
    if (id) {
      if (
        payload.runsBat > 0 &&
        (shotMode === "every" || (shotMode === "boundaries" && payload.boundary))
      )
        void match
          .whenDurable()
          .then(() => {
            setShot({ id, payload, hand });
          })
          .catch(() => undefined);
      setToast({ id, label: modifier ? `${String(runs)} ${copy[modifier]}` : String(runs) });
      setModifier(null);
      setMore(false);
    }
  }
  const activeShot =
    shot && state.eventHistory.some((event) => event.eventId === shot.id) ? shot : null;
  const wicketPayload = wicket ? delivery(0) : null;
  const bowler = inning?.bowlerId ? names.players[inning.bowlerId] : undefined;
  const styleKey = inning?.bowlerId
    ? effectiveStyle(
        state,
        players.find((player) => player.id === inning.bowlerId),
        inning.bowlerId,
      ).bowlingStyle
    : null;
  const bowlerStyle = styleKey ? bowlingStyleLabel(styleKey) : "";
  if (match.error === "Signed out. Sign in again to score.")
    return (
      <main className="score-home">
        <h1>Signed out</h1>
        <p>Sign in again to open this match.</p>
      </main>
    );
  return (
    <main className="pad" data-testid="pad" lang={language}>
      <h1 className="pad-title">{setup.fixtureNumber} scoring</h1>
      <header className="pad-top">
        <span className="score-cap">Live</span>
        <span data-testid="pad-sync" data-pending={match.pending} aria-live="polite">
          {match.pending ? `${String(match.pending)} waiting` : copy.allSent}
        </span>
      </header>
      {match.offline && (
        <div className="pad-offline" data-testid="pad-offline-banner" role="status">
          No signal · {match.pending} {copy.offlineSaved}
        </div>
      )}
      <Button
        variant="ghost"
        data-testid="claim-force"
        disabled={
          match.offline ||
          takingOver ||
          match.pending > 0 ||
          state.phase === "void" ||
          state.finished
        }
        onClick={() => {
          setTakeoverError(null);
          setTakeover(true);
        }}
      >
        Take over scoring
      </Button>
      {takeover && (
        <Dialog
          open
          title="Take over scoring?"
          onClose={() => {
            if (!takingOver) setTakeover(false);
          }}
          footer={
            <Button
              disabled={takingOver || match.offline || match.pending > 0}
              onClick={() => {
                setTakingOver(true);
                void match
                  .takeOver()
                  .then(() => {
                    setTakeover(false);
                  })
                  .catch((error: unknown) => {
                    setTakeoverError(
                      error instanceof Error ? error.message : "Could not take over scoring.",
                    );
                  })
                  .finally(() => {
                    setTakingOver(false);
                  });
              }}
            >
              {takingOver ? "Checking match…" : "Confirm takeover"}
            </Button>
          }
        >
          <p>
            This phone will become the scoring device. The current scorer must have been quiet for
            two minutes unless you organise this match. Saved deliveries stay on their original
            phone.
          </p>
          {takeoverError && <p role="alert">{takeoverError}</p>}
        </Dialog>
      )}
      <section className="pad-score-card" aria-label="Match score">
        <div>
          <p className="score-cap">
            {batting?.name ?? "Match"}
            {inning?.target ? ` · Chasing ${String(inning.target)}` : ""}
          </p>
          <div className="pad-score-line">
            <strong data-testid="pad-score">
              {inning?.runs ?? 0}/{inning?.wickets ?? 0}
            </strong>
            <span data-testid="pad-overs">
              ({inning ? `${String(inning.completedOvers)}.${String(inning.ballsInOver)}` : "0.0"})
            </span>
          </div>
          <p data-testid="pad-need">{live.situation}</p>
        </div>
        {left !== null && (
          <div className="pad-balls">
            <svg viewBox="0 0 80 80" aria-hidden="true">
              <circle cx="40" cy="40" r="34" />
              <circle
                cx="40"
                cy="40"
                r="34"
                pathLength="100"
                strokeDasharray={`${String(fraction * 100)} 100`}
              />
            </svg>
            <strong>{left}</strong>
            <small>balls left</small>
          </div>
        )}
      </section>
      {inning?.freeHitNext && (
        <div className="pad-free-hit" data-testid="pad-free-hit">
          {copy.freeHit}
        </div>
      )}
      <section className="pad-batters" aria-label="Batters">
        {[inning?.strikerId, inning?.nonStrikerId].map((id, index) => {
          const player = id ? names.players[id] : undefined;
          const line = id ? inning?.batters[id] : undefined;
          return (
            <div className={`pad-batter ${index === 0 ? "pad-striker" : ""}`} key={index}>
              <PlayerPortrait
                name={player?.name ?? "Player"}
                seed={id ?? ""}
                src={player?.photoUrl}
                decorative
                className="pad-portrait"
              />
              <div>
                <strong>
                  {index === 0 ? "★ " : ""}
                  {player?.name ?? "Pick batter"}
                </strong>
                <small>
                  {line?.runs ?? 0} ({line?.balls ?? 0})
                </small>
              </div>
            </div>
          );
        })}
        <button
          className="pad-swap"
          type="button"
          aria-label="Swap strike"
          disabled={!canScore}
          onClick={() => {
            match.apply("strike_swapped", {});
          }}
        >
          ⇄
        </button>
      </section>
      <section className="pad-bowler" aria-label={copy.nextBowler}>
        <PlayerPortrait
          name={bowler?.name ?? "Player"}
          src={bowler?.photoUrl}
          seed={inning?.bowlerId ?? ""}
          decorative
          className="pad-portrait"
        />
        <div>
          <strong>{bowler?.name ?? copy.nextBowler}</strong>
          <small>{bowlerStyle || "Style not set"}</small>
        </div>
        <span>{inning?.bowlerId ? (live.bowler?.figures ?? "") : ""}</span>
      </section>
      <div className="pad-over" role="group" aria-label="This over">
        {inning?.overs.at(-1)?.balls.map((ball) => (
          <button
            type="button"
            key={ball.eventId}
            aria-label={`Edit delivery ${ball.over}`}
            disabled={!match.ready || state.phase === "void"}
            onClick={() => {
              setEditing(ball);
            }}
          >
            {ball.wicket
              ? "W"
              : ball.extras.wides
                ? "Wd"
                : ball.extras.noBall
                  ? "Nb"
                  : ball.total === 0
                    ? "•"
                    : ball.total}
          </button>
        ))}
      </div>
      <Button
        variant="ghost"
        disabled={!match.ready || state.phase === "void"}
        onClick={() => {
          setHistoryOpen(true);
        }}
      >
        Edit an earlier delivery
      </Button>
      <div className="pad-controls">
        <p className="pad-instruction">{modifier ? copy.nowRuns : copy.tapRuns}</p>
        <div className="pad-modifiers">
          {(["wide", "noBall", "bye", "legBye"] as const).map((key) => (
            <button
              type="button"
              key={key}
              data-testid={`pad-mod-${key === "noBall" ? "noball" : key === "legBye" ? "legbye" : key}`}
              aria-pressed={modifier === key}
              disabled={!canScore}
              onClick={() => {
                setModifier(modifier === key ? null : key);
              }}
            >
              {copy[key]}
            </button>
          ))}
        </div>
        <div className="pad-run-grid">
          {[0, 1, 2, 3, 4, 6, 5].map((value) => (
            <button
              type="button"
              key={value}
              data-testid={`pad-run-${String(value)}`}
              className={value === 4 || value === 6 ? "pad-boundary" : ""}
              disabled={!canScore}
              aria-label={value === 0 ? "Dot ball" : String(value)}
              onClick={() => {
                run(value);
              }}
            >
              {value === 0 ? "•" : value}
            </button>
          ))}
          <button
            type="button"
            data-testid="pad-run-more"
            disabled={!canScore}
            onClick={() => {
              setMore(true);
            }}
          >
            7+
          </button>
        </div>
        <div className="pad-bottom">
          <button
            type="button"
            data-testid="pad-wicket"
            disabled={!canScore}
            onClick={() => {
              setWicket(true);
            }}
            className="pad-wicket"
          >
            {copy.wicket}
          </button>
          <button
            type="button"
            data-testid="pad-undo"
            disabled={!match.ready}
            onClick={() => {
              match.undo();
              setToast(null);
            }}
          >
            {copy.undo}
          </button>
          <button
            type="button"
            data-testid="pad-menu"
            aria-label="Match options"
            disabled={!match.ready || !state.format || state.phase === "void"}
            onClick={() => {
              setMenu(true);
            }}
          >
            ⋯
          </button>
        </div>
      </div>
      {toast && (
        <div role="status" className="pad-toast" data-testid="pad-toast">
          {toast.label} saved
          <button
            type="button"
            onClick={() => {
              match.undo(toast.id);
              setToast(null);
            }}
          >
            {copy.undo}
          </button>
        </div>
      )}
      <SheetBoundary
        onRetry={() => {
          void match.whenDurable().then(() => {
            location.reload();
          });
        }}
      >
        <div className="pad-modal">
          <Dialog
            open={historyOpen}
            onClose={() => {
              setHistoryOpen(false);
            }}
            title="Recorded deliveries"
          >
            <div className="scoring-menu-rows">
              {state.innings.flatMap((recorded) =>
                recorded.overs.flatMap((over) =>
                  over.balls.map((ball) => (
                    <Button
                      key={ball.eventId}
                      variant="ghost"
                      onClick={() => {
                        setHistoryOpen(false);
                        setEditing(ball);
                      }}
                    >
                      Innings {recorded.no} · {ball.over} ·{" "}
                      {names.players[ball.strikerId]?.name ?? "Player"} · {ball.total} runs
                      {ball.wicket ? " · wicket" : ""}
                    </Button>
                  )),
                ),
              )}
            </div>
          </Dialog>

          {result && !finishDismissed && !menu && !handover && !editing && !revise && (
            <FinishSheet
              result={result}
              names={names}
              finished={state.finished}
              pending={match.pending}
              sharePath={sharePath}
              nextMatch={nextMatch}
              onBack={() => {
                setFinishDismissed(true);
              }}
              onFinish={() => {
                match.apply("finish", {});
              }}
            />
          )}

          {handover && (
            <SheetBoundary
              onRetry={() => {
                void match.whenDurable().then(() => {
                  location.reload();
                });
              }}
            >
              <HandoverSheet
                fixtureId={fixtureId}
                pending={match.pending}
                onClose={() => {
                  setHandover(false);
                }}
              />
            </SheetBoundary>
          )}
          {menu && (
            <MenuSheet
              onHandover={() => {
                setMenu(false);
                setHandover(true);
              }}
              state={state}
              names={names}
              organiser={setup.organiser}
              shotMode={shotMode}
              onShotMode={(value) => {
                localStorage.setItem(`ls1:shot-map:${fixtureId}`, value);
                setShotMode(value);
              }}
              onTheme={changeTheme}
              onClose={() => {
                setMenu(false);
              }}
              onRevise={() => {
                setMenu(false);
                setRevise(true);
              }}
              onEvent={(entry) => {
                if (match.applyBatch([entry])) setMenu(false);
              }}
            />
          )}
          {revise && (
            <ReviseSheet
              state={state}
              onClose={() => {
                setRevise(false);
              }}
              onSave={(payload) => {
                if (match.apply("revise", payload)) setRevise(false);
              }}
            />
          )}
          {editing && (
            <EditBallSheet
              key={editing.eventId}
              ball={editing}
              state={state}
              names={names}
              onClose={() => {
                setEditing(null);
              }}
              onSave={(payload) => {
                if (match.apply("amend", { payload }, editing.eventId)) setEditing(null);
              }}
              onVoid={() => {
                if (match.apply("void", {}, editing.eventId)) setEditing(null);
              }}
            />
          )}

          {wicket && wicketPayload && (
            <WicketSheet
              state={state}
              payload={wicketPayload}
              names={names}
              preview={(entries) => match.preview(entries)}
              onClose={() => {
                setWicket(false);
              }}
              onConfirm={(entries) => {
                try {
                  if (match.applyBatch(entries)) {
                    setWicket(false);
                    setModifier(null);
                  }
                } catch {
                  setWicket(false);
                }
              }}
            />
          )}
          {!wicket && activeShot && (
            <ShotSheet
              hand={activeShot.hand}
              name={names.players[activeShot.payload.strikerId]?.name ?? "Player"}
              language={language}
              onClose={closeShot}
              onShot={(value) => {
                match.apply(
                  "amend",
                  { payload: { ...activeShot.payload, shot: value } },
                  activeShot.id,
                );
                setShot(null);
              }}
            />
          )}
          {!historyOpen &&
            !menu &&
            !handover &&
            !revise &&
            !editing &&
            !wicket &&
            !shot &&
            !match.error &&
            match.ready &&
            (startInnings?.kind === "start_innings" ? (
              <InningsStartSheet
                key={`${String(state.attempt)}:${String(startInnings.inningsNo)}:${startInnings.battingTeamId}`}
                state={state}
                names={names}
                onConfirm={(players) => {
                  const payload = inningsStartPayload(
                    match.preview([]),
                    {
                      attempt: state.attempt,
                      inningsNo: startInnings.inningsNo,
                      battingTeamId: startInnings.battingTeamId,
                    },
                    players,
                  );
                  return Boolean(match.apply("innings_started", payload));
                }}
              />
            ) : pickBatter?.kind === "pick_new_batter" ? (
              <BatterSheet
                names={names}
                suggestedId={pickBatter.suggestedId}
                ids={
                  inning
                    ? (state.lineups[inning.battingTeamId]?.battingOrder.filter(
                        (id) =>
                          id !== inning.strikerId &&
                          id !== inning.nonStrikerId &&
                          !inning.outIds.includes(id) &&
                          !inning.retiredHurt.includes(id) &&
                          !inning.absentBatterIds.includes(id),
                      ) ?? [])
                    : []
                }
                onPick={(id) => {
                  match.apply("new_batter", { registrationId: id, end: pickBatter.end });
                }}
              />
            ) : pickBowler?.kind === "pick_bowler" ? (
              <BowlerSheet
                names={names}
                matchupHint={inning?.strikerId ? (matchupHints[inning.strikerId] ?? null) : null}
                action={pickBowler}
                onPick={(id) => {
                  match.apply("bowler_set", { bowlerId: id, midOver: false });
                }}
              />
            ) : askStyle?.kind === "ask_style" ? (
              <StyleAsk
                key={`${askStyle.registrationId}:${askStyle.what}`}
                action={askStyle}
                profile={players.find((player) => player.id === askStyle.registrationId)}
                name={names.players[askStyle.registrationId]?.name ?? "Player"}
                onSkip={() => {
                  localStorage.setItem(
                    dismissalKey(fixtureId, askStyle.registrationId, askStyle.what),
                    "1",
                  );
                  setDismissed(
                    (previous) =>
                      new Set([...previous, `${askStyle.registrationId}:${askStyle.what}`]),
                  );
                }}
                onSave={(payload) => {
                  match.apply("style_set", payload);
                }}
              />
            ) : null)}
          <Dialog
            open={more}
            onClose={() => {
              setMore(false);
            }}
            title="Seven or more runs"
            footer={
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setMore(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    run(extraRuns);
                  }}
                >
                  Save {extraRuns} runs
                </Button>
              </>
            }
          >
            <label>
              Runs off this delivery
              <input
                type="number"
                min="7"
                max="10"
                step="1"
                value={extraRuns}
                onChange={(event) => {
                  setExtraRuns(Math.min(10, Math.max(7, Math.trunc(Number(event.target.value)))));
                }}
              />
            </label>
          </Dialog>
          <Dialog
            open={Boolean(match.error)}
            onClose={() => {
              match.dismissError();
            }}
            title="Scoring entry refused"
            footer={
              <Button
                onClick={() => {
                  match.dismissError();
                }}
              >
                Close
              </Button>
            }
          >
            <p role="alert">{match.error}</p>
          </Dialog>
        </div>
      </SheetBoundary>
    </main>
  );
}
