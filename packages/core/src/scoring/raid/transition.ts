import type { ApplyResult, MatchEvent } from "../types";
import type { TypedRaidEvent, Side } from "./events";
import { completed, emptyRaidStats, halfExpired, other, type RaidState } from "./state";
import { raidFormat } from "./formats";
import { validateRaidPayload } from "./validate";
const refused = { ok: false, reason: "bad_payload" } as const;
const sides = ["home", "away"] as const;
function eligible(state: RaidState, id: string): boolean {
  const card = state.cards[id];
  return (
    !card?.red &&
    (card?.untilGameMs === null ||
      card?.untilGameMs === undefined ||
      card.untilGameMs <= state.gameElapsedMs)
  );
}
function advance(state: RaidState, stamp: number): void {
  if (state.running && state.anchorAt !== null && state.format && !state.halfClosed) {
    const elapsed = Math.min(
      stamp - state.anchorAt,
      Math.max(0, state.format.halfMinutes * 60000 - state.halfElapsedMs),
    );
    state.halfElapsedMs += elapsed;
    state.gameElapsedMs += elapsed;
  }
  state.anchorAt = stamp;
  if (halfExpired(state)) state.running = false;
  for (const [id, card] of Object.entries(state.cards)) {
    if (card.untilGameMs !== null && card.untilGameMs <= state.gameElapsedMs) {
      card.untilGameMs = null;
      const side = sides.find((side) => state.starters[side].includes(id));
      if (
        side &&
        card.removedFromMat &&
        !card.red &&
        !state.outs[side].includes(id) &&
        !state.mat[side].includes(id)
      )
        state.mat[side].push(id);
      card.removedFromMat = false;
    }
  }
  for (const side of sides) if (state.mat[side].length) state.allOutArmed[side] = true;
}
function out(state: RaidState, side: Side, id: string): void {
  state.mat[side] = state.mat[side].filter((entry) => entry !== id);
  if (!state.outs[side].includes(id)) state.outs[side].push(id);
}
function revive(state: RaidState, side: Side, count: number): void {
  for (let n = 0; n < count; n++) {
    const index = state.outs[side].findIndex((id) => eligible(state, id));
    if (index < 0) break;
    const id = state.outs[side].splice(index, 1)[0];
    if (id) state.mat[side].push(id);
  }
}
function scores(state: RaidState, base: Record<Side, number>): void {
  for (const side of sides) {
    state.points[side] += base[side];
    revive(state, side, base[side]);
  }
  const allOut = sides.filter((side) => state.mat[side].length === 0 && state.allOutArmed[side]);
  for (const side of allOut) {
    state.allOutArmed[side] = false;
    state.points[other(side)] += 2;
    revive(state, side, state.outs[side].length);
  }
  // Bonus revivals occur once, after the fixed all-out set; never recurse.
  for (const side of allOut) revive(state, other(side), 2);
  for (const side of sides) if (state.mat[side].length) state.allOutArmed[side] = true;
}
export function raidTransition(state: RaidState, raw: MatchEvent): ApplyResult<RaidState> {
  if (raw.attempt !== state.attempt) return { ok: false, reason: "wrong_attempt" };
  const valid = validateRaidPayload(raw.type, raw.payload);
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
  const next: RaidState = {
    ...state,
    raids: [...state.raids],
    conditions: structuredClone(state.conditions),
    squads: structuredClone(state.squads),
    starters: structuredClone(state.starters),
    mat: structuredClone(state.mat),
    outs: structuredClone(state.outs),
    points: { ...state.points },
    empty: { ...state.empty },
    cards: structuredClone(state.cards),
    participants: structuredClone(state.participants),
    allOutArmed: { ...state.allOutArmed },
  };
  advance(next, stamp);
  const event = raw as TypedRaidEvent;
  switch (event.type) {
    case "match_started":
      if (state.format) return refused;
      if (
        state.competition &&
        event.payload.competition &&
        (state.competition.name !== event.payload.competition.name ||
          state.competition.season !== event.payload.competition.season)
      )
        return refused;
      next.format = raidFormat(event.payload.format);
      next.conditions = structuredClone(event.payload.conditions);
      next.teams = { home: event.payload.homeTeamId, away: event.payload.awayTeamId };
      next.competition = event.payload.competition
        ? { ...event.payload.competition }
        : state.competition;
      break;
    case "lineup_confirmed": {
      const { teamId, players, startingMat } = event.payload;
      const side = sides.find((side) => state.teams?.[side] === teamId);
      if (!side || state.half || state.squads[teamId]) return refused;
      if (
        Object.values(state.squads)
          .flat()
          .some((id) => players.includes(id))
      )
        return { ok: false, reason: "unknown_player" };
      next.squads[teamId] = [...players];
      next.starters[side] = [...startingMat];
      next.mat[side] = [...startingMat];
      for (const id of startingMat) next.participants[id] = { teamId, stats: emptyRaidStats() };
      break;
    }
    case "half_started":
      if (
        !state.format ||
        !state.teams ||
        !sides.every((side) => state.squads[state.teams?.[side] ?? ""]) ||
        !state.halfClosed ||
        event.payload.half !== state.half + 1
      )
        return refused;
      next.half = event.payload.half;
      next.halfClosed = false;
      next.halfElapsedMs = 0;
      next.running = false;
      next.raidStartGameMs = null;
      next.empty = { home: 0, away: 0 };
      next.nextRaidingSide = next.half === 1 ? "home" : "away";
      break;
    case "clock":
      if (!state.half || state.halfClosed || halfExpired(next))
        return { ok: false, reason: "not_live" };
      next.running = event.payload.running;
      if (next.running && next.raidStartGameMs === null) next.raidStartGameMs = next.gameElapsedMs;
      break;
    case "half_ended":
      if (!state.half || state.halfClosed) return refused;
      next.halfClosed = true;
      next.running = false;
      next.raidStartGameMs = null;
      break;
    case "raid": {
      if (!state.format || !next.running || next.halfClosed || halfExpired(next))
        return { ok: false, reason: "not_live" };
      next.raids.push({
        eventId: raw.eventId,
        seq: raw.seq,
        clientRecordedAt: raw.clientRecordedAt,
      });
      const side = state.nextRaidingSide,
        defence = other(side);
      const { raiderId, touchedIds, bonus, tackled, tacklerIds } = event.payload,
        lineOut = event.payload.lineOut ?? [];
      const defenders = next.mat[defence];
      if (
        !next.mat[side].includes(raiderId) ||
        !touchedIds.every((id) => defenders.includes(id)) ||
        !tacklerIds.every((id) => defenders.includes(id)) ||
        !lineOut.every((id) => id === raiderId || defenders.includes(id))
      )
        return { ok: false, reason: "unknown_player" };
      if (
        touchedIds.some((id) => lineOut.includes(id)) ||
        tacklerIds.some((id) => lineOut.includes(id)) ||
        (tackled && (!tacklerIds.length || touchedIds.length || lineOut.includes(raiderId))) ||
        (!tackled && tacklerIds.length) ||
        (bonus && defenders.length < state.format.bonusLineMinDefenders)
      )
        return refused;
      const doOrDie = state.empty[side] >= state.format.doOrDieAfterEmpty;
      const raidPoints =
        touchedIds.length + lineOut.filter((id) => id !== raiderId).length + (bonus ? 1 : 0);
      const superTackle = tackled && defenders.length <= state.format.superTackleAtOrBelow;
      let defencePoints = tackled ? (superTackle ? 2 : 1) : lineOut.includes(raiderId) ? 1 : 0;
      const failedDoD = doOrDie && raidPoints === 0;
      const raiderOut = tackled || lineOut.includes(raiderId) || failedDoD;
      if (failedDoD && defencePoints === 0) defencePoints = 1;
      for (const id of [...touchedIds, ...lineOut.filter((id) => id !== raiderId)])
        out(next, defence, id);
      if (raiderOut) out(next, side, raiderId);
      const stats = next.participants[raiderId]?.stats;
      if (!stats) return refused;
      stats.raidPoints += raidPoints;
      if (raidPoints > 0) stats.successfulRaids++;
      else stats.emptyRaids++;
      if (raidPoints >= 3) stats.superRaids++;
      if (doOrDie && raidPoints > 0) stats.doOrDieSuccesses++;
      if (tackled) stats.tackled++;
      stats.super10 = stats.raidPoints >= 10 ? 1 : 0;
      if (tackled)
        for (const [index, id] of tacklerIds.entries()) {
          const stats = next.participants[id]?.stats;
          if (!stats) return refused;
          if (index === 0) {
            stats.tacklePoints += defencePoints;
            if (superTackle) stats.superTackles++;
            stats.high5 = stats.tacklePoints >= 5 ? 1 : 0;
          } else stats.assists++;
        }
      next.empty[side] = raidPoints > 0 ? 0 : state.empty[side] + 1;
      scores(
        next,
        side === "home"
          ? { home: raidPoints, away: defencePoints }
          : { home: defencePoints, away: raidPoints },
      );
      next.nextRaidingSide = defence;
      next.raidStartGameMs = next.gameElapsedMs;
      break;
    }
    case "technical_point": {
      const side = sides.find((side) => state.teams?.[side] === event.payload.teamId);
      if (!side || !state.half || next.halfClosed || halfExpired(next)) return refused;
      scores(next, side === "home" ? { home: 1, away: 0 } : { home: 0, away: 1 });
      break;
    }
    case "green_card":
    case "yellow_card":
    case "red_card": {
      const id = event.payload.playerId,
        side = sides.find((side) => state.starters[side].includes(id));
      if (!side || !state.half || next.halfClosed || halfExpired(next) || next.cards[id]?.red)
        return refused;
      const stats = next.participants[id]?.stats;
      if (!stats) return refused;
      if (event.type === "yellow_card") {
        stats.yellowCards++;
        break;
      }
      const old = next.cards[id],
        removed = next.mat[side].includes(id) || old?.removedFromMat === true;
      next.mat[side] = next.mat[side].filter((entry) => entry !== id);
      next.cards[id] = {
        red: event.type === "red_card",
        untilGameMs: event.type === "green_card" ? next.gameElapsedMs + 120000 : null,
        removedFromMat: removed,
      };
      if (event.type === "red_card") stats.redCards++;
      else stats.greenCards++;
      scores(next, { home: 0, away: 0 });
      break;
    }
    case "conditions_changed":
      if (!state.format) return refused;
      next.conditions = { ...next.conditions, ...structuredClone(event.payload.conditions) };
      break;
    case "interrupt":
      if (!state.format || completed(next)) return refused;
      next.interrupted = true;
      next.running = false;
      break;
    case "resume":
      if (!state.interrupted) return refused;
      next.interrupted = false;
      next.running = false;
      break;
    case "abandon":
      if (!state.format) return refused;
      next.terminal = event.payload.kind;
      next.finished = true;
      break;
    case "walkover":
      if (!state.teams || !Object.values(state.teams).includes(event.payload.winnerTeamId))
        return refused;
      next.terminal = "walkover";
      next.walkoverWinner = event.payload.winnerTeamId;
      next.finished = true;
      break;
    case "finish":
      if (!completed(next)) return refused;
      next.finished = true;
      break;
    case "match_voided":
      next.terminal = "void";
      next.finished = true;
      break;
    default:
      return refused;
  }
  if (next.finished) next.running = false;
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
                : completed(next)
                  ? "result_reached"
                  : next.half
                    ? "live"
                    : "not_started";
  next.lastSeq = raw.seq;
  next.lastEventAt = raw.clientRecordedAt;
  next.eventHistory = [...state.eventHistory, raw];
  return { ok: true, state: next };
}
