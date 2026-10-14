import { actualBallLimit, canParticipateInOver, overLength } from "./overs";
import type { ApplyResult, BallPayload, MatchEvent } from "../types";
import { batterLine, bowlerLine, copyConditions, copyInnings, currentInnings } from "./state";
import { phaseOf } from "./phase";
import { canReopenProvisional, closeIfComplete, isLoneBatter } from "./innings";
import { resultOf } from "./outcomes";
import type { InningsState, MatchState, TypedMatchEvent } from "./state";
import { integer, validatePayload } from "./validate";
import { dismiss, recordDismissal, validateDismissal } from "./wickets";
import { validateBowler } from "./bowlers";

const REFUSED = { ok: false, reason: "bad_payload" } as const;

function swap(innings: InningsState): void {
  if (innings.strikerId === null || innings.nonStrikerId === null) return;
  [innings.strikerId, innings.nonStrikerId] = [innings.nonStrikerId, innings.strikerId];
}

function recordBall(
  innings: InningsState,
  payload: BallPayload,
  event: MatchEvent,
  state: MatchState,
): void {
  const format = state.format;
  if (!format) return;
  const { wides = 0, noBall, byes = 0, legByes = 0 } = payload.extras;
  const noBalls = noBall ? (payload.extras.noBallRuns ?? format.noBallRuns) : 0;
  const legal = !(wides && format.wideReBowl) && !(noBall && format.noBallReBowl);
  const total = payload.runsBat + wides + noBalls + byes + legByes;
  const batter = innings.batters[payload.strikerId];
  const bowler = innings.bowlers[payload.bowlerId];
  if (!batter || !bowler) return;
  batter.runs += payload.runsBat;
  batter.balls += wides ? 0 : noBall || legal ? 1 : 0;
  batter.fours += payload.boundary === 4 ? 1 : 0;
  batter.sixes += payload.boundary === 6 ? 1 : 0;
  bowler.runs += payload.runsBat + wides + noBalls;
  bowler.legalBalls += legal ? 1 : 0;
  bowler.wides += wides;
  bowler.noBalls += noBalls;
  // A dot is a legal ball the bowler conceded nothing from: byes and leg-byes
  // are not charged to the bowler, so they do not spoil it.
  bowler.dots += legal && payload.runsBat + wides + noBalls === 0 ? 1 : 0;
  innings.runs += total;
  innings.extras.wides += wides;
  innings.extras.noBalls += noBalls;
  innings.extras.byes += byes;
  innings.extras.legByes += legByes;
  const overIndex = innings.completedOvers;
  let over = innings.overs[overIndex];
  if (!over) {
    over = { bowlerId: payload.bowlerId, balls: [] };
    innings.overs.push(over);
  }
  const batterHand = state.styles[payload.strikerId]?.battingHand;
  const bowlerStyle = state.styles[payload.bowlerId]?.bowlingStyle;
  over.balls.push({
    ...payload,
    extras: { ...payload.extras },
    ...(payload.shot ? { shot: { ...payload.shot } } : {}),
    ...(payload.wicket
      ? {
          wicket: {
            ...payload.wicket,
            fielderIds: [...payload.wicket.fielderIds],
            ...(payload.wicket.substituteFielderIds
              ? { substituteFielderIds: [...payload.wicket.substituteFielderIds] }
              : {}),
            ...(payload.wicket.where ? { where: { ...payload.wicket.where } } : {}),
          },
        }
      : {}),
    eventId: event.eventId,
    seq: event.seq,
    legal,
    total,
    over: `${String(overIndex)}.${String(innings.ballsInOver + 1)}`,
    clientRecordedAt: event.clientRecordedAt,
    conditions: copyConditions(state.conditions),
    ...(batterHand ? { batterHand } : {}),
    ...(bowlerStyle ? { bowlerStyle } : {}),
  });
  innings.legalBalls += legal ? 1 : 0;
  innings.ballsInOver += legal ? 1 : 0;
  if (noBall && format.freeHitOnNoBall) innings.freeHitNext = true;
  else if (legal) innings.freeHitNext = false;
  innings.conditionsAtBall = copyConditions(state.conditions);
  const physicalRuns = wides
    ? wides - format.wideRuns
    : payload.boundary
      ? 0
      : payload.runsBat + byes + legByes + (noBall ? noBalls - format.noBallRuns : 0);
  if (physicalRuns % 2 !== 0) swap(innings);
  if (legal && innings.ballsInOver === overLength(innings, format.ballsPerOver)) {
    if (
      over.balls.every(
        (ball) =>
          ball.bowlerId === payload.bowlerId &&
          ball.runsBat === 0 &&
          !ball.extras.wides &&
          !ball.extras.noBall,
      )
    )
      bowler.maiden += 1;
    innings.completedOvers += 1;
    innings.ballsInOver = 0;
    swap(innings);
    innings.lastBowlerOfPreviousOver = payload.bowlerId;
    innings.bowlerId = null;
  }
}

export function applyTransition(state: MatchState, input: MatchEvent): ApplyResult<MatchState> {
  if (input.attempt !== state.attempt) return { ok: false, reason: "wrong_attempt" };
  if (state.outcome === "void" || (state.finished && input.type !== "match_voided"))
    return { ok: false, reason: "already_finished" };
  if (!integer(input.v, 1, 1) || (input.type === "match_voided" && input.targetEventId !== null))
    return REFUSED;
  const validation = validatePayload(input.type, input.payload);
  if (!validation.ok) return validation;
  const event = input as TypedMatchEvent;
  const next: MatchState = {
    ...state,
    lastSeq: event.seq,
    lastEventAt: event.clientRecordedAt,
    eventHistory: [...state.eventHistory, input],
  };
  switch (event.type) {
    case "match_voided":
      next.outcome = "void";
      next.finished = true;
      break;
    case "match_started": {
      if (state.format) return REFUSED;
      const payload = event.payload;
      if (
        state.originalTieSetting !== null &&
        payload.competition !== undefined &&
        (payload.competition.name !== state.competition?.name ||
          payload.competition.season !== state.competition.season)
      )
        return REFUSED;
      next.competition = payload.competition
        ? { ...payload.competition }
        : state.competition
          ? { ...state.competition }
          : null;
      next.format = { ...payload.format };
      if (
        state.originalTieSetting !== null &&
        payload.superOverTie !== undefined &&
        payload.superOverTie !== state.originalTieSetting
      )
        return REFUSED;
      next.superOverTie = payload.superOverTie ?? state.originalTieSetting ?? "another";
      next.originalTieSetting = next.superOverTie;
      next.conditions = copyConditions(payload.conditions);
      next.teams = { home: payload.homeTeamId, away: payload.awayTeamId };
      break;
    }
    case "lineup_confirmed": {
      const { teamId, battingOrder, captainId, keeperId, substitutes } = event.payload;
      if (
        !state.teams ||
        !state.format ||
        state.toss ||
        (teamId !== state.teams.home && teamId !== state.teams.away)
      )
        return REFUSED;
      if (
        battingOrder.length > state.format.playersPerSide + 4 ||
        battingOrder.length > state.format.playersPerSide + substitutes.length
      )
        return REFUSED;
      const other = Object.entries(state.lineups)
        .filter(([id]) => id !== teamId)
        .flatMap(([, lineup]) => [...lineup.battingOrder, ...lineup.substitutes]);
      if ([...battingOrder, ...substitutes].some((id) => other.includes(id)))
        return { ok: false, reason: "unknown_player" };
      next.lineups = {
        ...state.lineups,
        [teamId]: {
          battingOrder: [...battingOrder],
          captainId,
          keeperId,
          substitutes: [...substitutes],
          out: [],
        },
      };
      break;
    }
    case "toss": {
      const teams = state.teams;
      if (
        !teams ||
        state.toss ||
        !state.lineups[teams.home] ||
        !state.lineups[teams.away] ||
        ![teams.home, teams.away].includes(event.payload.winnerTeamId)
      )
        return REFUSED;
      next.toss = { ...event.payload };
      break;
    }
    case "innings_started": {
      const payload = event.payload;
      const teams = state.teams;
      const format = state.format;
      if (
        !teams ||
        !format ||
        !state.toss ||
        state.interrupted ||
        payload.inningsNo !== state.innings.length + 1
      )
        return REFUSED;
      if (state.innings.length > 0 && !currentInnings(state)?.closed)
        return { ok: false, reason: "innings_over" };
      const batting = state.lineups[payload.battingTeamId];
      const scheduled = state.pendingSuperOver[0];
      const superOver = payload.superOver === true;
      if (
        superOver
          ? !scheduled ||
            scheduled.inningsNo !== payload.inningsNo ||
            scheduled.battingTeamId !== payload.battingTeamId
          : !!scheduled || state.innings.length >= format.innings * 2
      )
        return REFUSED;
      const bowlingTeamId = payload.battingTeamId === teams.home ? teams.away : teams.home;
      const bowling = state.lineups[bowlingTeamId];
      if (
        !batting ||
        !bowling ||
        payload.absentBatterIds?.some(
          (id) =>
            !batting.battingOrder.includes(id) ||
            id === payload.strikerId ||
            id === payload.nonStrikerId,
        ) ||
        !batting.battingOrder.includes(payload.strikerId) ||
        (payload.nonStrikerId !== null && !batting.battingOrder.includes(payload.nonStrikerId))
      )
        return { ok: false, reason: "unknown_player" };
      if (!bowling.battingOrder.includes(payload.bowlerId))
        return { ok: false, reason: "bowler_not_fielding" };
      const firstTeam =
        state.toss.decision === "bat"
          ? state.toss.winnerTeamId
          : state.toss.winnerTeamId === teams.home
            ? teams.away
            : teams.home;
      if (state.innings.length === 0 && payload.battingTeamId !== firstTeam) return REFUSED;
      if (
        !superOver &&
        state.innings.length > 0 &&
        payload.battingTeamId === state.innings[state.innings.length - 1]?.battingTeamId
      )
        return REFUSED;
      const miscountedOvers = { ...payload.miscountedOvers };
      if (Object.values(miscountedOvers).some((count) => count === format.ballsPerOver))
        return REFUSED;
      const innings: InningsState = {
        scoreTrace: [],
        miscountedOvers,
        completedOvers: 0,
        ballsInOver: 0,
        targetMethod: null,
        no: payload.inningsNo,
        superOver,
        battingTeamId: payload.battingTeamId,
        bowlingTeamId,
        runs: 0,
        wickets: 0,
        legalBalls: 0,
        maxBalls: superOver
          ? format.ballsPerOver
          : format.oversPerInnings === null
            ? null
            : format.oversPerInnings * format.ballsPerOver,
        target: superOver
          ? state.pendingSuperOver.length === 1
            ? (state.innings[state.innings.length - 1]?.runs ?? 0) + 1
            : null
          : state.innings.length === 1
            ? (state.innings[0]?.runs ?? 0) + 1
            : null,
        extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0 },
        strikerId: payload.strikerId,
        nonStrikerId: payload.nonStrikerId,
        bowlerId: payload.bowlerId,
        batters: {
          [payload.strikerId]: batterLine(1),
          ...(payload.nonStrikerId !== null ? { [payload.nonStrikerId]: batterLine(2) } : {}),
        },
        bowlers: { [payload.bowlerId]: bowlerLine() },
        battedOrder:
          payload.nonStrikerId === null
            ? [payload.strikerId]
            : [payload.strikerId, payload.nonStrikerId],
        outIds: [],
        retiredHurt: [],
        absentBatterIds: [...(payload.absentBatterIds ?? [])],
        overs: [],
        fallOfWickets: [],
        freeHitNext: false,
        closed: null,
        lastBowlerOfPreviousOver: null,
        conditionsAtBall: copyConditions(state.conditions),
        retirePromptDue: null,
      };
      if (
        innings.maxBalls !== null &&
        actualBallLimit(innings.maxBalls, format.ballsPerOver, miscountedOvers) === undefined
      )
        return REFUSED;
      const pendingPenalty = state.penaltyRuns
        // Pending awards attach only once, when their team's innings opens.
        .filter((penalty) => penalty.teamId === payload.battingTeamId && penalty.inningsNo === null)
        .reduce((sum, penalty) => sum + penalty.runs, 0);
      innings.runs += pendingPenalty;
      innings.extras.penalty += pendingPenalty;
      next.penaltyRuns = state.penaltyRuns.map((penalty) =>
        penalty.teamId === payload.battingTeamId && penalty.inningsNo === null
          ? { ...penalty, inningsNo: innings.no }
          : penalty,
      );
      next.currentInnings = state.innings.length;
      if (payload.nonStrikerId === null && !isLoneBatter(state, innings))
        return { ok: false, reason: "not_batting" };
      if (superOver) next.pendingSuperOver = state.pendingSuperOver.slice(1);
      const revision = state.pendingRevision;
      if (!superOver && revision && revision.inningsNo === innings.no) {
        innings.maxBalls = revision.maxBalls;
        if (revision.targetRuns !== undefined) {
          innings.target = revision.targetRuns;
          innings.targetMethod = revision.method;
        }
        next.pendingRevision = null;
      }
      next.innings = [...state.innings, innings];
      break;
    }
    case "revise":
    case "innings_closed": {
      // A revision for the innings about to start can be entered during the
      // innings break (a DLS target is usually set before the chase begins).
      if (
        event.type === "revise" &&
        state.phase === "innings_break" &&
        state.pendingSuperOver.length === 0 &&
        event.payload.inningsNo === state.innings.length + 1
      ) {
        if (
          !state.format ||
          actualBallLimit(event.payload.maxBalls, state.format.ballsPerOver, {}) === undefined
        )
          return REFUSED;
        next.pendingRevision = {
          inningsNo: event.payload.inningsNo,
          maxBalls: event.payload.maxBalls,
          method: event.payload.method,
          ...(event.payload.targetRuns !== undefined
            ? { targetRuns: event.payload.targetRuns }
            : {}),
        };
        break;
      }
      if (state.phase !== "live" && state.phase !== "interrupted")
        return { ok: false, reason: "not_live" };
      const previous = currentInnings(state);
      if (!previous || previous.closed) return { ok: false, reason: "innings_over" };
      const innings = copyInnings(previous);
      if (event.type === "revise") {
        if (event.payload.inningsNo !== innings.no) return REFUSED;
        if (
          !state.format ||
          actualBallLimit(
            event.payload.maxBalls,
            state.format.ballsPerOver,
            innings.miscountedOvers,
          ) === undefined
        )
          return REFUSED;
        innings.maxBalls = event.payload.maxBalls;
        if (event.payload.targetRuns !== undefined) {
          innings.target = event.payload.targetRuns;
          innings.targetMethod = event.payload.method;
        }
        closeIfComplete(state, innings);
      } else innings.closed = event.payload.reason;
      next.innings = [...state.innings];
      if (state.currentInnings !== null) next.innings[state.currentInnings] = innings;
      break;
    }
    case "super_over_started": {
      const result = resultOf(state);
      if (!state.format?.superOver || !result || result.outcome !== "tie") return REFUSED;
      const last = state.innings[state.innings.length - 1];
      if (!last || !state.teams || state.pendingSuperOver.length > 0) return REFUSED;
      next.pendingSuperOver = [
        { inningsNo: state.innings.length + 1, battingTeamId: last.battingTeamId },
        { inningsNo: state.innings.length + 2, battingTeamId: last.bowlingTeamId },
      ];
      break;
    }
    case "interrupt": {
      if (!state.format || state.outcome || state.interrupted)
        return { ok: false, reason: "not_live" };
      next.interrupted = { reason: event.payload.reason };
      break;
    }
    case "resume": {
      if (!state.interrupted) return { ok: false, reason: "not_live" };
      next.interrupted = null;
      break;
    }
    case "abandon": {
      if (!state.format || (event.payload.kind === "abandoned" && state.innings.length > 0))
        return REFUSED;
      next.outcome = event.payload.kind;
      break;
    }
    case "walkover": {
      if (
        !state.teams ||
        ![state.teams.home, state.teams.away].includes(event.payload.winnerTeamId)
      )
        return REFUSED;
      next.outcome = "walkover";
      next.walkoverWinner = event.payload.winnerTeamId;
      break;
    }
    case "finish": {
      if (!resultOf(state)) return REFUSED;
      next.finished = true;
      break;
    }
    case "conditions_changed": {
      if (!state.format) return REFUSED;
      next.conditions = copyConditions({ ...state.conditions, ...event.payload.conditions });
      break;
    }
    case "player_added": {
      const { teamId, registrationId } = event.payload;
      const lineup = state.lineups[teamId];
      if (
        !lineup ||
        Object.values(state.lineups).some((lineup) =>
          [...lineup.battingOrder, ...lineup.substitutes, ...lineup.out].includes(registrationId),
        )
      )
        return { ok: false, reason: "unknown_player" };
      next.lineups = {
        ...state.lineups,
        [teamId]: { ...lineup, battingOrder: [...lineup.battingOrder, registrationId] },
      };
      break;
    }
    case "substitute": {
      const { teamId, inId, outId } = event.payload;
      const lineup = state.lineups[teamId];
      if (
        !lineup ||
        !lineup.substitutes.includes(inId) ||
        !lineup.battingOrder.includes(outId) ||
        lineup.out.includes(inId) ||
        lineup.out.includes(outId)
      )
        return { ok: false, reason: "unknown_player" };
      next.lineups = {
        ...state.lineups,
        [teamId]: {
          ...lineup,
          battingOrder: lineup.battingOrder.map((id) => (id === outId ? inId : id)),
          substitutes: lineup.substitutes.filter((id) => id !== inId),
          out: [...lineup.out, outId],
        },
      };
      const previous = currentInnings(state);
      const reopening =
        !!previous &&
        canReopenProvisional(state, previous) &&
        teamId === previous.battingTeamId &&
        (event.payload.kind === "concussion" || event.payload.kind === "injury") &&
        previous.retiredHurt.includes(outId) &&
        !previous.outIds.includes(outId) &&
        !previous.battedOrder.includes(inId) &&
        !previous.outIds.includes(inId) &&
        !previous.absentBatterIds.includes(inId);
      if (previous && (!previous.closed || reopening)) {
        const innings = copyInnings(previous);
        if (reopening) innings.closed = null;
        if (innings.strikerId === outId) innings.strikerId = null;
        if (innings.nonStrikerId === outId) innings.nonStrikerId = null;
        if (innings.bowlerId === outId) innings.bowlerId = null;
        if (reopening) closeIfComplete(next, innings);
        next.innings = [...state.innings];
        if (state.currentInnings !== null) next.innings[state.currentInnings] = innings;
      }
      break;
    }
    case "style_set": {
      const { registrationId, ...style } = event.payload;
      if (
        !Object.values(state.lineups).some((lineup) =>
          [...lineup.battingOrder, ...lineup.substitutes].includes(registrationId),
        )
      )
        return { ok: false, reason: "unknown_player" };
      next.styles = {
        ...state.styles,
        [registrationId]: { ...state.styles[registrationId], ...style },
      };
      break;
    }
    case "penalty_runs": {
      const { teamId, runs } = event.payload;
      if (!state.teams || ![state.teams.home, state.teams.away].includes(teamId)) return REFUSED;
      const index = state.innings.findLastIndex((innings) => innings.battingTeamId === teamId);
      const previous = index >= 0 ? state.innings[index] : undefined;
      if (previous) {
        const innings = copyInnings(previous);
        innings.runs += runs;
        innings.extras.penalty += runs;
        closeIfComplete(next, innings);
        next.innings = [...state.innings];
        next.innings[index] = innings;
        // Penalty runs to the side that batted first (Law 41) raise the chase
        // target, unless the target was revised by hand or by DLS. A chase that
        // had already "reached" the old target is open again if it now falls short.
        const chase = state.innings[index + 1];
        if (
          chase &&
          chase.superOver === innings.superOver &&
          chase.battingTeamId !== teamId &&
          chase.targetMethod === null
        ) {
          const updated = copyInnings(chase);
          updated.target = innings.runs + 1;
          if (updated.closed === "target" && updated.runs < updated.target) updated.closed = null;
          closeIfComplete(next, updated);
          next.innings[index + 1] = updated;
        }
      }
      next.penaltyRuns = [...state.penaltyRuns, { teamId, runs, inningsNo: previous?.no ?? null }];
      break;
    }
    case "bowler_set": {
      if (state.phase !== "live") return { ok: false, reason: "not_live" };
      const previous = currentInnings(state);
      if (!previous || previous.closed) return { ok: false, reason: "innings_over" };
      const { bowlerId, midOver } = event.payload;
      const validation = validateBowler(state, previous, bowlerId, midOver);
      if (!validation.ok) return validation;
      const innings = copyInnings(previous);
      innings.bowlerId = bowlerId;
      innings.bowlers[bowlerId] ??= bowlerLine();
      next.innings = [...state.innings];
      if (state.currentInnings !== null) next.innings[state.currentInnings] = innings;
      closeIfComplete(next, innings);
      break;
    }
    case "new_batter":
    case "resume_batting":
    case "retire": {
      const previous = currentInnings(state);
      const reopening =
        event.type === "resume_batting" &&
        !!previous &&
        canReopenProvisional(state, previous) &&
        previous.retiredHurt.includes(event.payload.registrationId);
      if (state.phase !== "live" && !reopening) return { ok: false, reason: "not_live" };
      if (!previous || (previous.closed && !reopening))
        return { ok: false, reason: "innings_over" };
      const innings = copyInnings(previous);
      if (reopening) innings.closed = null;
      const id = event.payload.registrationId;
      const lineup = state.lineups[innings.battingTeamId];
      if (
        !lineup ||
        !lineup.battingOrder.includes(id) ||
        lineup.out.includes(id) ||
        innings.absentBatterIds.includes(id)
      )
        return { ok: false, reason: "unknown_player" };
      if (event.type === "retire") {
        if (id !== innings.strikerId && id !== innings.nonStrikerId)
          return { ok: false, reason: "not_batting" };
        if (event.payload.kind === "out")
          dismiss(innings, id, "retired_out", event.seq, state.conditions);
        else {
          if (innings.strikerId === id) innings.strikerId = null;
          if (innings.nonStrikerId === id) innings.nonStrikerId = null;
          innings.retiredHurt.push(id);
          const batter = innings.batters[id];
          if (batter) batter.retiredHurt = true;
        }
      } else {
        if (innings.outIds.includes(id) || id === innings.strikerId || id === innings.nonStrikerId)
          return { ok: false, reason: "not_batting" };
        const end =
          event.type === "new_batter"
            ? event.payload.end
            : innings.strikerId === null
              ? "striker"
              : "non_striker";
        const field = end === "striker" ? "strikerId" : "nonStrikerId";
        if (innings[field] !== null) return { ok: false, reason: "not_batting" };
        if (event.type === "resume_batting") {
          if (!innings.retiredHurt.includes(id)) return { ok: false, reason: "not_batting" };
          innings.retiredHurt = innings.retiredHurt.filter((retired) => retired !== id);
          const batter = innings.batters[id];
          if (batter) batter.retiredHurt = false;
        } else {
          if (innings.battedOrder.includes(id)) return { ok: false, reason: "not_batting" };
          innings.battedOrder.push(id);
          innings.batters[id] = batterLine(innings.battedOrder.length);
        }
        innings[field] = id;
      }
      closeIfComplete(next, innings);
      next.innings = [...state.innings];
      if (state.currentInnings !== null) next.innings[state.currentInnings] = innings;
      break;
    }
    case "strike_swapped":
    case "ball": {
      if (state.phase !== "live") return { ok: false, reason: "not_live" };
      const previous = currentInnings(state);
      if (!previous) return { ok: false, reason: "no_open_innings" };
      if (previous.closed) return { ok: false, reason: "innings_over" };
      const innings = copyInnings(previous);
      if (event.type === "strike_swapped") {
        if (!isLoneBatter(state, innings))
          [innings.strikerId, innings.nonStrikerId] = [innings.nonStrikerId, innings.strikerId];
      } else {
        const payload = event.payload;
        if (!innings.bowlerId) return REFUSED;
        if (payload.bowlerId !== innings.bowlerId)
          return { ok: false, reason: "bowler_not_fielding" };
        const format = state.format;
        if (
          format &&
          payload.extras.noBallRuns !== undefined &&
          payload.extras.noBallRuns < format.noBallRuns
        )
          return REFUSED;
        if (format && !canParticipateInOver(innings, payload.bowlerId, format.maxOversPerBowler))
          return { ok: false, reason: "bowler_quota" };
        if (
          payload.strikerId !== innings.strikerId ||
          payload.nonStrikerId !== innings.nonStrikerId
        )
          return { ok: false, reason: "not_batting" };
        if (payload.nonStrikerId === null && !isLoneBatter(state, innings))
          return { ok: false, reason: "not_batting" };
        const dismissal = validateDismissal(state, innings, payload);
        if (!dismissal.ok) return dismissal;
        recordBall(innings, payload, event, state);
        recordDismissal(innings, payload, event.seq, state.conditions);
        closeIfComplete(next, innings);
        next.lastBallAt = event.clientRecordedAt;
      }
      next.innings = [...state.innings];
      if (state.currentInnings !== null) next.innings[state.currentInnings] = innings;
      break;
    }
    default:
      return REFUSED;
  }
  next.innings = next.innings.map((innings, index) => {
    const previous = state.innings[index];
    const delivery = event.type === "ball" && index === next.currentInnings;
    if (
      previous &&
      !delivery &&
      previous.runs === innings.runs &&
      previous.wickets === innings.wickets
    )
      return innings;
    const kind = !previous
      ? "opening"
      : delivery
        ? "delivery"
        : event.type === "penalty_runs"
          ? "penalty"
          : "retirement";
    return {
      ...innings,
      scoreTrace: [
        ...innings.scoreTrace,
        {
          seq: event.seq,
          kind,
          runs: innings.runs,
          wickets: innings.wickets,
          legalBalls: innings.legalBalls,
          completedOvers: innings.completedOvers,
          ballsInOver: innings.ballsInOver,
          subsequent:
            kind === "penalty" && previous?.closed !== null && previous?.closed !== undefined,
        },
      ],
    };
  });
  next.phase = phaseOf(next);
  return { ok: true, state: next };
}
