import { FOOTBALL_ROLE_KEYS } from "../../sports/football";
import { HOCKEY_ROLE_KEYS } from "../../sports/hockey";
import { BASKETBALL_ROLE_KEYS } from "../../sports/basketball";
import type { ApplyResult, MatchEvent } from "../types";
import type { TypedTimedEvent, Side } from "./events";
import { timedFormat, timedSport } from "./formats";
import { validateTimedPayload } from "./validate";
import { emptyTimedStats, other, timedCompleted, type TimedState } from "./state";
import { deriveTimedResult } from "./result";
const sides = ["home", "away"] as const;
const refused = { ok: false, reason: "bad_payload" } as const;
function advance(state: TimedState, stamp: number) {
  if (state.running && state.anchorAt !== null && state.format && !state.periodClosed) {
    const elapsed = Math.min(
      stamp - state.anchorAt,
      Math.max(0, state.format.periodMinutes * 60000 - state.periodElapsedMs),
    );
    state.periodElapsedMs += elapsed;
    state.gameClockMs += elapsed;
  }
  state.anchorAt = stamp;
  if (state.format && state.periodElapsedMs >= state.format.periodMinutes * 60000)
    state.running = false;
}
function enter(state: TimedState, side: Side, id: string) {
  const player = state.participants[id] ?? {
    teamId: required(state.teams)[side],
    stats: emptyTimedStats(state.roles[id] ?? null),
  };
  if (!player.stats.activeIntervals.some((interval) => interval.toGameMs === null))
    player.stats.activeIntervals.push({
      fromGameMs: state.gameClockMs,
      toGameMs: null,
      period: state.period,
    });
  state.participants[id] = player;
}
function leave(state: TimedState, id: string) {
  const interval = state.participants[id]?.stats.activeIntervals.at(-1);
  if (interval?.toGameMs === null) interval.toGameMs = state.gameClockMs;
}
export function timedTransition(state: TimedState, raw: MatchEvent): ApplyResult<TimedState> {
  if (raw.attempt !== state.attempt) return { ok: false, reason: "wrong_attempt" };
  const valid = validateTimedPayload(raw.type, raw.payload);
  if (!valid.ok) return valid;
  if (state.terminal === "void" || (state.finished && raw.type !== "match_voided"))
    return { ok: false, reason: "already_finished" };
  if (
    state.interrupted &&
    !["resume", "conditions_changed", "abandon", "walkover", "match_voided"].includes(raw.type)
  )
    return { ok: false, reason: "not_live" };
  const stamp = Date.parse(raw.clientRecordedAt);
  if (!Number.isFinite(stamp) || (state.anchorAt !== null && stamp < state.anchorAt))
    return refused;
  const next: TimedState = {
    ...state,
    conditions: structuredClone(state.conditions),
    squads: structuredClone(state.squads),
    active: structuredClone(state.active),
    roles: { ...state.roles },
    red: [...state.red],
    participants: structuredClone(state.participants),
    points: { ...state.points },
    timeline: [...state.timeline],
    shootout: state.shootout ? structuredClone(state.shootout) : null,
  };
  advance(next, stamp);
  const event = raw as TypedTimedEvent;
  const sideFor = (id: string) => sides.find((side) => next.teams?.[side] === id);
  const activeSide = (id: string) => sides.find((side) => next.active[side].includes(id));
  const open = () => !!next.format && !next.periodClosed && next.period > 0 && !next.terminal;
  switch (event.type) {
    case "match_started": {
      if (next.format) return refused;
      const { format, conditions, homeTeamId, awayTeamId, competition } = event.payload;
      next.format = timedFormat(format);
      next.conditions = structuredClone(conditions);
      next.teams = { home: homeTeamId, away: awayTeamId };
      next.competition = competition ?? next.competition;
      break;
    }
    case "lineup_confirmed": {
      const { teamId, players, startingActive, roles } = event.payload,
        side = sideFor(teamId);
      if (
        !side ||
        !next.format ||
        next.period ||
        next.squads[teamId] ||
        players.some((id) => next.squads[required(next.teams)[other(side)]]?.includes(id))
      )
        return refused;
      const allowed: readonly string[] =
        timedSport(next.format) === "basketball"
          ? BASKETBALL_ROLE_KEYS
          : timedSport(next.format) === "hockey"
            ? HOCKEY_ROLE_KEYS
            : FOOTBALL_ROLE_KEYS;
      if (Object.values(roles ?? {}).some((role) => !allowed.includes(role))) return refused;
      next.squads[teamId] = [...players];
      next.active[side] = [...startingActive];
      Object.assign(next.roles, roles ?? {});
      break;
    }
    case "period_started": {
      if (
        !next.format ||
        !next.teams ||
        !next.periodClosed ||
        event.payload.period !== next.period + 1 ||
        event.payload.period > next.format.periods ||
        sides.some((side) => !next.squads[required(next.teams)[side]])
      )
        return refused;
      next.period = event.payload.period;
      next.periodClosed = false;
      next.periodElapsedMs = 0;
      next.running = next.format.clock === "running";
      for (const side of sides) for (const id of next.active[side]) enter(next, side, id);
      break;
    }
    case "period_ended": {
      if (!open() || event.payload.period !== next.period) return refused;
      next.periodClosed = true;
      next.running = false;
      for (const side of sides) for (const id of next.active[side]) leave(next, id);
      if (
        timedCompleted(next) &&
        required(next.format).shootout &&
        next.points.home === next.points.away
      )
        next.shootout = {
          eligible: structuredClone(next.active),
          used: { home: [], away: [] },
          attempts: { home: 0, away: 0 },
          points: { home: 0, away: 0 },
          nextSide: "home",
          winner: null,
        };
      break;
    }
    case "clock":
      if (!open()) return refused;
      next.running =
        event.payload.running && next.periodElapsedMs < required(next.format).periodMinutes * 60000;
      break;
    case "score": {
      const p = event.payload,
        side = sideFor(p.teamId);
      if (
        !open() ||
        !side ||
        !required(next.format).scoreUnits.includes(p.points) ||
        !Number.isSafeInteger(next.points[side] + p.points)
      )
        return refused;
      const basketball = timedSport(required(next.format)) === "basketball";
      if (basketball && (p.ownGoal !== undefined || p.penalty !== undefined)) return refused;
      if (p.ownGoal && (p.assistId !== undefined || p.penalty)) return refused;
      if (p.scorerId && activeSide(p.scorerId) !== (p.ownGoal ? other(side) : side)) return refused;
      if (p.assistId && (activeSide(p.assistId) !== side || p.assistId === p.scorerId))
        return refused;
      next.points[side] += p.points;
      if (p.scorerId) {
        const stats = required(next.participants[p.scorerId]).stats;
        if (p.ownGoal) stats.ownGoals += 1;
        else {
          stats.points += p.points;
          if (!basketball) stats.goals += 1;
          if (p.penalty) stats.penaltiesScored += 1;
        }
      }
      if (p.assistId) required(next.participants[p.assistId]).stats.assists += 1;
      next.timeline.push({
        seq: event.seq,
        gameClockMs: next.gameClockMs,
        period: next.period,
        type: "score",
        payload: { ...p },
      });
      break;
    }
    case "sub": {
      const p = event.payload,
        side = sideFor(p.teamId);
      if (
        !open() ||
        !side ||
        !next.active[side].includes(p.outId) ||
        next.active[side].includes(p.inId) ||
        !next.squads[p.teamId]?.includes(p.inId) ||
        next.red.includes(p.inId)
      )
        return refused;
      leave(next, p.outId);
      next.active[side] = next.active[side].map((id) => (id === p.outId ? p.inId : id));
      enter(next, side, p.inId);
      break;
    }
    case "card": {
      const p = event.payload,
        side = activeSide(p.playerId);
      if (!open() || !side) return refused;
      const stats = required(next.participants[p.playerId]).stats;
      if (p.colour === "red") {
        stats.redCards++;
        next.red.push(p.playerId);
        leave(next, p.playerId);
        next.active[side] = next.active[side].filter((id) => id !== p.playerId);
      } else if (p.colour === "yellow") stats.yellowCards++;
      else stats.greenCards++;
      next.timeline.push({
        seq: event.seq,
        gameClockMs: next.gameClockMs,
        period: next.period,
        type: "card",
        payload: { ...p },
      });
      break;
    }
    case "foul": {
      const p = event.payload,
        side = sideFor(p.teamId);
      if (
        !open() ||
        !side ||
        timedSport(required(next.format)) !== "basketball" ||
        !next.active[side].includes(p.playerId)
      )
        return refused;
      required(next.participants[p.playerId]).stats.fouls++;
      break;
    }
    case "shootout_attempt": {
      const p = event.payload,
        s = next.shootout,
        side = sideFor(p.teamId);
      if (!s || s.winner || !side || side !== s.nextSide || !s.eligible[side].includes(p.playerId))
        return refused;
      if (s.used[side].length === s.eligible[side].length) s.used[side] = [];
      if (s.used[side].includes(p.playerId)) return refused;
      s.used[side].push(p.playerId);
      s.attempts[side]++;
      if (p.scored) s.points[side]++;
      const stats = required(next.participants[p.playerId]).stats;
      stats.shootoutAttempts++;
      if (p.scored) stats.shootoutConversions++;
      if (s.attempts.home <= 5 && s.attempts.away <= 5) {
        if (s.points.home > s.points.away + (5 - s.attempts.away)) s.winner = "home";
        else if (s.points.away > s.points.home + (5 - s.attempts.home)) s.winner = "away";
      } else if (s.attempts.home === s.attempts.away && s.points.home !== s.points.away)
        s.winner = s.points.home > s.points.away ? "home" : "away";
      s.nextSide = other(side);
      break;
    }
    case "interrupt":
      if (!open()) return refused;
      next.interrupted = true;
      next.running = false;
      break;
    case "resume":
      if (!next.interrupted) return refused;
      next.interrupted = false;
      next.running = false;
      break;
    case "conditions_changed":
      next.conditions = structuredClone(event.payload.conditions);
      break;
    case "abandon":
      if (!next.format) return refused;
      next.terminal = event.payload.kind;
      next.running = false;
      break;
    case "walkover":
      if (!sideFor(event.payload.winnerTeamId)) return refused;
      next.terminal = "walkover";
      next.walkoverWinner = event.payload.winnerTeamId;
      next.running = false;
      break;
    case "match_voided":
      next.terminal = "void";
      next.running = false;
      break;
    case "finish":
      if (!deriveTimedResult(next)) return refused;
      next.finished = true;
      next.running = false;
      break;
    default:
      return refused;
  }
  if (next.terminal || next.finished)
    for (const side of sides) for (const id of next.active[side]) leave(next, id);
  next.phase =
    next.terminal === "void"
      ? "void"
      : next.terminal === "walkover"
        ? "walkover"
        : next.terminal === "abandoned"
          ? "abandoned"
          : next.terminal === "no_result"
            ? "no_result"
            : next.finished
              ? "finished"
              : next.interrupted
                ? "interrupted"
                : deriveTimedResult(next)
                  ? "result_reached"
                  : next.period
                    ? "live"
                    : "not_started";
  next.lastSeq = raw.seq;
  next.lastEventAt = raw.clientRecordedAt;
  next.eventHistory = [...state.eventHistory, raw];
  return { ok: true, state: next };
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing timed state.");
  return value;
}
