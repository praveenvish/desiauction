import { actualBallLimit } from "./overs";
import { conditionsLine } from "../conditions";
import type { NameBook, PublicLiveState, TeamRef } from "../types";
import { commentaryLine } from "./commentary";
import { deriveResult } from "./result";
import { currentInnings } from "./state";
import type { BallSummary, InningsState, MatchState } from "./state";

export function oversText(balls: number, perOver: number): string {
  return `${String(Math.floor(balls / perOver))}${balls % perOver ? `.${String(balls % perOver)}` : ""}`;
}
function ballToken(ball: BallSummary): string {
  if (ball.wicket) return "W";
  if (ball.extras.wides) return ball.extras.wides === 1 ? "Wd" : `${String(ball.extras.wides)}Wd`;
  if (ball.extras.noBall) return ball.total === 1 ? "Nb" : `${String(ball.total)}Nb`;
  if (ball.extras.byes) return `${String(ball.extras.byes)}B`;
  if (ball.extras.legByes) return `${String(ball.extras.legByes)}Lb`;
  return ball.total === 0 ? "•" : String(ball.total);
}
export interface DeliveryPanel {
  v: 1;
}
export function publicLiveState(
  state: MatchState,
  names: NameBook,
): PublicLiveState<DeliveryPanel> {
  const team = (id: string): TeamRef =>
    names.teams[id] ?? { id, name: id, initials: id.slice(0, 2).toUpperCase() };
  const home = team(state.teams?.home ?? "home");
  const away = team(state.teams?.away ?? "away");
  const innings = currentInnings(state);
  const perOver = state.format?.ballsPerOver ?? 6;
  const ballsLeft =
    innings?.maxBalls === null || !innings
      ? null
      : Math.max(
          0,
          (actualBallLimit(innings.maxBalls, perOver, innings.miscountedOvers) ?? 0) -
            innings.legalBalls,
        );
  const result = deriveResult(state);
  const resultText = result
    ? result.winnerTeamId
      ? `${team(result.winnerTeamId).name} won ${result.marginText}`
      : result.outcome === "tie"
        ? "Match tied"
        : result.outcome === "no_result"
          ? "No result"
          : "Match abandoned"
    : null;
  const runsNeeded =
    innings?.target === null || !innings ? null : Math.max(0, innings.target - innings.runs);
  const currentRate =
    innings && innings.legalBalls > 0
      ? ((innings.runs * perOver) / innings.legalBalls).toFixed(2)
      : "0.00";
  const requiredRate =
    runsNeeded !== null && ballsLeft !== null && ballsLeft > 0
      ? ((runsNeeded * perOver) / ballsLeft).toFixed(2)
      : null;
  let situation = innings
    ? `${team(innings.battingTeamId).name} ${String(innings.runs)}/${String(innings.wickets)} (${inningsOvers(innings)})`
    : "";
  if (state.outcome === "void") situation = "Match void";
  else if (resultText) situation = resultText;
  else if (state.interrupted) situation = `Play stopped: ${state.interrupted.reason}`;
  else if (state.phase === "innings_break") situation = "Innings break";
  else if (innings && runsNeeded !== null && ballsLeft !== null)
    situation = `${team(innings.battingTeamId).name} need ${String(runsNeeded)} off ${String(ballsLeft)} balls`;
  const balls = innings?.overs.flatMap((over) => over.balls) ?? [];
  const batters: PublicLiveState["batters"] = [];
  const batterShots: PublicLiveState["batterShots"] = {};
  for (const id of [innings?.strikerId, innings?.nonStrikerId]) {
    if (!id || !innings) continue;
    const line = innings.batters[id];
    const ref = names.players[id] ?? {
      name: id,
      initials: id.slice(0, 2).toUpperCase(),
      photoUrl: null,
    };
    batters.push({
      id,
      ...ref,
      runs: line?.runs ?? 0,
      balls: line?.balls ?? 0,
      fours: line?.fours ?? 0,
      sixes: line?.sixes ?? 0,
      onStrike: innings.strikerId === id,
      hand: state.styles[id]?.battingHand ?? null,
    });
    batterShots[id] = balls
      .filter((ball) => ball.strikerId === id && ball.shot)
      .map((ball) => ({ angle: ball.shot?.angle ?? 0, runs: ball.runsBat }));
  }
  const bowlerId = innings?.bowlerId;
  const bowling = bowlerId ? innings.bowlers[bowlerId] : undefined;
  const allBalls = state.innings.flatMap((i) => i.overs.flatMap((over) => over.balls));
  return {
    family: "delivery",
    panel: { v: 1 },
    v: 1,
    seq: state.lastSeq,
    phase: state.phase,
    updatedAt: state.lastEventAt ?? "",
    lastBallAt: state.lastBallAt,
    teams: { home, away },
    tossLine: state.toss
      ? `${team(state.toss.winnerTeamId).name} won the toss and chose to ${state.toss.decision}`
      : null,
    conditionsLine: conditionsLine(state.conditions),
    innings: state.innings.map((i) => ({
      battingTeamId: i.battingTeamId,
      runs: i.runs,
      wickets: i.wickets,
      overs: inningsOvers(i),
      target: i.target,
      superOver: i.superOver,
    })),
    situation,
    batters,
    bowler: bowlerId
      ? {
          id: bowlerId,
          name: names.players[bowlerId]?.name ?? bowlerId,
          style: state.styles[bowlerId]?.bowlingStyle ?? null,
          figures: `${oversText(bowling?.legalBalls ?? 0, perOver)}-${String(bowling?.maiden ?? 0)}-${String(bowling?.runs ?? 0)}-${String(bowling?.wickets ?? 0)}`,
        }
      : null,
    thisOver: innings?.overs[innings.overs.length - 1]?.balls.map(ballToken) ?? [],
    recent: allBalls
      .slice(-12)
      .map((ball) => ({ seq: ball.seq, over: ball.over, text: commentaryLine(ball, names) })),
    batterShots,
    ballsLeft,
    requiredRate,
    currentRate,
    result: resultText,
    trust: "self_scored",
  };
}

function inningsOvers(innings: InningsState): string {
  return `${String(innings.completedOvers)}${innings.ballsInOver ? `.${String(innings.ballsInOver)}` : ""}`;
}
