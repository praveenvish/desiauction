import type { DeliveryEventType, EventType, ValidationResult } from "../types";
import { BATTING_HANDS } from "../types";
import { CRICKET_BOWLING_STYLE_KEYS } from "../../sports/cricket";

import {
  isRecord,
  isId,
  integer,
  ids,
  keys,
  checked,
  oneOf,
  validConditions,
} from "../validate-primitives";
export {
  isRecord,
  isId,
  integer,
  ids,
  keys,
  checked,
  oneOf,
  validConditions,
} from "../validate-primitives";

export function validFormat(value: unknown): boolean {
  if (!isRecord(value) || !isId(value.key) || !isId(value.label)) return false;
  for (const key of [
    "ballsPerOver",
    "playersPerSide",
    "wicketsPerInnings",
    "wideRuns",
    "noBallRuns",
    "deathFromOver",
  ]) {
    if (!integer(value[key], 1)) return false;
  }
  for (const key of ["oversPerInnings", "maxOversPerBowler", "retireAt"]) {
    if (value[key] !== null && !integer(value[key], 1)) return false;
  }
  for (const key of [
    "lastManStands",
    "noConsecutiveOvers",
    "wideReBowl",
    "noBallReBowl",
    "freeHitOnNoBall",
    "lbw",
    "superOver",
  ]) {
    if (typeof value[key] !== "boolean") return false;
  }
  return (
    integer(value.powerplayOvers) &&
    (value.innings === 1 || value.innings === 2) &&
    Number(value.playersPerSide) >= 2 &&
    Number(value.wicketsPerInnings) <= Number(value.playersPerSide) &&
    (value.oversPerInnings === null ||
      (Number(value.deathFromOver) <= Number(value.oversPerInnings) &&
        value.powerplayOvers <= Number(value.oversPerInnings)))
  );
}

export function validateMatchStarted(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      (value.competition === undefined ||
        (isRecord(value.competition) &&
          keys(value.competition, ["name", "season"]) &&
          typeof value.competition.name === "string" &&
          value.competition.name.trim().length > 0 &&
          typeof value.competition.season === "string" &&
          value.competition.season.trim().length > 0)) &&
      validFormat(value.format) &&
      validConditions(value.conditions) &&
      isId(value.homeTeamId) &&
      isId(value.awayTeamId) &&
      value.homeTeamId !== value.awayTeamId &&
      (value.superOverTie === undefined ||
        oneOf(value.superOverTie, ["another", "boundary_count"])),
  );
}
export function validateLineupConfirmed(value: unknown): ValidationResult {
  if (!isRecord(value)) return checked(false);
  const battingOrder = value.battingOrder;
  return checked(
    isId(value.teamId) &&
      ids(battingOrder) &&
      battingOrder.length >= 2 &&
      ids(value.substitutes) &&
      isId(value.captainId) &&
      isId(value.keeperId) &&
      battingOrder.includes(value.captainId) &&
      battingOrder.includes(value.keeperId) &&
      value.substitutes.every((id) => !battingOrder.includes(id)),
  );
}
export function validateToss(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      isId(value.winnerTeamId) &&
      (value.decision === "bat" || value.decision === "bowl"),
  );
}
export function validateInningsStarted(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      integer(value.inningsNo, 1) &&
      isId(value.battingTeamId) &&
      isId(value.strikerId) &&
      (value.nonStrikerId === null || isId(value.nonStrikerId)) &&
      value.strikerId !== value.nonStrikerId &&
      isId(value.bowlerId) &&
      (value.absentBatterIds === undefined || ids(value.absentBatterIds)) &&
      (value.superOver === undefined || typeof value.superOver === "boolean") &&
      (value.miscountedOvers === undefined || validMiscountedOvers(value.miscountedOvers)),
  );
}
export function validateStrikeSwapped(value: unknown): ValidationResult {
  return checked(isRecord(value) && Object.keys(value).length === 0);
}
export function validateBall(value: unknown): ValidationResult {
  if (
    !isRecord(value) ||
    !keys(value, [
      "bowlerId",
      "strikerId",
      "nonStrikerId",
      "runsBat",
      "extras",
      "boundary",
      "shot",
      "wicket",
    ])
  )
    return checked(false);
  if (!integer(value.runsBat, 0, 10)) return { ok: false, reason: "runs_out_of_range" };
  if (
    value.boundary !== undefined &&
    ((value.boundary !== 4 && value.boundary !== 6) || value.boundary !== value.runsBat)
  )
    return { ok: false, reason: "boundary_mismatch" };
  if (
    !isId(value.bowlerId) ||
    !isId(value.strikerId) ||
    (value.nonStrikerId !== null && !isId(value.nonStrikerId)) ||
    value.strikerId === value.nonStrikerId ||
    !isRecord(value.extras)
  )
    return checked(false);
  const extras = value.extras;
  if (!keys(extras, ["wides", "noBall", "noBallRuns", "byes", "legByes"])) return checked(false);
  for (const key of ["wides", "byes", "legByes"])
    if (extras[key] !== undefined && !integer(extras[key], 1)) return checked(false);
  if (extras.noBall !== undefined && extras.noBall !== true) return checked(false);
  if (extras.noBallRuns !== undefined && (extras.noBall !== true || !integer(extras.noBallRuns, 1)))
    return checked(false);
  if (extras.byes !== undefined && extras.legByes !== undefined) return checked(false);
  if (
    extras.wides !== undefined &&
    (value.runsBat !== 0 ||
      extras.noBall !== undefined ||
      extras.byes !== undefined ||
      extras.legByes !== undefined)
  )
    return checked(false);
  if ((extras.byes !== undefined || extras.legByes !== undefined) && value.runsBat !== 0)
    return checked(false);
  if (value.shot !== undefined) {
    const shot = value.shot;
    if (
      !isRecord(shot) ||
      !keys(shot, ["zone", "angle"]) ||
      !integer(shot.angle, 0, 359) ||
      !oneOf(shot.zone, [
        "long_off",
        "cover",
        "point",
        "third_man",
        "fine_leg",
        "square_leg",
        "mid_wicket",
        "long_on",
      ])
    )
      return checked(false);
  }
  return value.wicket === undefined ? checked(true) : validateWicket(value.wicket);
}

export function validateWicket(value: unknown): ValidationResult {
  if (
    !isRecord(value) ||
    !keys(value, [
      "kind",
      "playerOutId",
      "fielderIds",
      "substituteFielderIds",
      "unknownFielderCount",
      "where",
      "runsCompleted",
    ]) ||
    !isId(value.playerOutId) ||
    !ids(value.fielderIds) ||
    (value.unknownFielderCount !== undefined && !integer(value.unknownFielderCount, 1)) ||
    (value.kind !== "run_out" &&
      value.fielderIds.length +
        (typeof value.unknownFielderCount === "number" ? value.unknownFielderCount : 0) >
        1)
  )
    return checked(false);
  if (
    !oneOf(value.kind, [
      "bowled",
      "caught",
      "lbw",
      "stumped",
      "run_out",
      "hit_wicket",
      "obstructing",
      "hit_twice",
      "timed_out",
      "caught_and_bowled",
    ])
  )
    return checked(false);
  if (
    value.substituteFielderIds !== undefined &&
    (!ids(value.substituteFielderIds) ||
      value.substituteFielderIds.some((id) => !(value.fielderIds as string[]).includes(id)))
  )
    return checked(false);
  if (
    value.runsCompleted !== undefined &&
    (value.kind !== "run_out" || !integer(value.runsCompleted))
  )
    return checked(false);
  if (value.where !== undefined) {
    const where = value.where;
    if (
      !isRecord(where) ||
      !keys(where, ["x", "y"]) ||
      typeof where.x !== "number" ||
      !Number.isFinite(where.x) ||
      Math.abs(where.x) > 1 ||
      typeof where.y !== "number" ||
      !Number.isFinite(where.y) ||
      Math.abs(where.y) > 1
    )
      return checked(false);
  }
  return checked(true);
}
export function validateNewBatter(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      keys(value, ["registrationId", "end"]) &&
      isId(value.registrationId) &&
      oneOf(value.end, ["striker", "non_striker"]),
  );
}
export function validateRetire(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      keys(value, ["registrationId", "kind"]) &&
      isId(value.registrationId) &&
      oneOf(value.kind, ["hurt", "out"]),
  );
}
export function validateResumeBatting(value: unknown): ValidationResult {
  return checked(isRecord(value) && keys(value, ["registrationId"]) && isId(value.registrationId));
}

export function validateBowlerSet(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      keys(value, ["bowlerId", "midOver", "reason"]) &&
      isId(value.bowlerId) &&
      typeof value.midOver === "boolean" &&
      (value.reason === undefined || oneOf(value.reason, ["injury", "suspended", "other"])) &&
      (!value.midOver || value.reason !== undefined),
  );
}
export function validatePenaltyRuns(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      keys(value, ["teamId", "runs", "reason"]) &&
      isId(value.teamId) &&
      value.runs === 5 &&
      oneOf(value.reason, ["fielding", "helmet", "time_wasting", "pitch_damage", "other"]),
  );
}
export function validateStyleSet(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      keys(value, ["registrationId", "battingHand", "bowlingStyle"]) &&
      isId(value.registrationId) &&
      (value.battingHand !== undefined || value.bowlingStyle !== undefined) &&
      (value.battingHand === undefined || oneOf(value.battingHand, BATTING_HANDS)) &&
      (value.bowlingStyle === undefined || oneOf(value.bowlingStyle, CRICKET_BOWLING_STYLE_KEYS)),
  );
}

export function validateRevise(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      keys(value, ["inningsNo", "maxBalls", "targetRuns", "method"]) &&
      integer(value.inningsNo, 1) &&
      integer(value.maxBalls, 1) &&
      (value.targetRuns === undefined || integer(value.targetRuns, 1)) &&
      oneOf(value.method, ["manual", "dls"]),
  );
}
export function validateInningsClosed(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      keys(value, ["reason"]) &&
      oneOf(value.reason, ["declared", "forfeit", "no_more_batters"]),
  );
}
export function validateSuperOverStarted(value: unknown): ValidationResult {
  return checked(isRecord(value) && Object.keys(value).length === 0);
}

export function validateSubstitute(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      keys(value, ["teamId", "inId", "outId", "kind"]) &&
      isId(value.teamId) &&
      isId(value.inId) &&
      isId(value.outId) &&
      value.inId !== value.outId &&
      oneOf(value.kind, ["injury", "concussion", "impact", "tactical"]),
  );
}
export function validatePlayerAdded(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      keys(value, ["teamId", "registrationId"]) &&
      isId(value.teamId) &&
      isId(value.registrationId),
  );
}
export function validateConditionsChanged(value: unknown): ValidationResult {
  return checked(
    isRecord(value) && keys(value, ["conditions"]) && validConditions(value.conditions),
  );
}
export function validateInterrupt(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      keys(value, ["reason", "note"]) &&
      oneOf(value.reason, ["rain", "bad_light", "other"]) &&
      (value.note === undefined || typeof value.note === "string"),
  );
}
export function validateResume(value: unknown): ValidationResult {
  return validateStrikeSwapped(value);
}
export function validateFinish(value: unknown): ValidationResult {
  return validateStrikeSwapped(value);
}
export function validateVoid(value: unknown): ValidationResult {
  return validateStrikeSwapped(value);
}
export function validateAmend(value: unknown): ValidationResult {
  return checked(isRecord(value) && keys(value, ["payload"]) && isRecord(value.payload));
}
export function validateMatchVoided(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      keys(value, ["reason"]) &&
      isId(value.reason) &&
      value.reason === value.reason.trim() &&
      value.reason.length <= 300,
  );
}
export function validateRestart(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      keys(value, ["reason"]) &&
      isId(value.reason) &&
      value.reason.trim().length > 0,
  );
}
export function validateWalkover(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      keys(value, ["winnerTeamId", "reason"]) &&
      isId(value.winnerTeamId) &&
      isId(value.reason),
  );
}
export function validateAbandon(value: unknown): ValidationResult {
  return checked(
    isRecord(value) &&
      keys(value, ["kind", "reason"]) &&
      oneOf(value.kind, ["no_result", "abandoned"]) &&
      isId(value.reason),
  );
}

const PAYLOAD_VALIDATORS: Record<DeliveryEventType, (value: unknown) => ValidationResult> = {
  match_started: validateMatchStarted,
  lineup_confirmed: validateLineupConfirmed,
  toss: validateToss,
  innings_started: validateInningsStarted,
  strike_swapped: validateStrikeSwapped,
  ball: validateBall,
  new_batter: validateNewBatter,
  retire: validateRetire,
  resume_batting: validateResumeBatting,
  bowler_set: validateBowlerSet,
  penalty_runs: validatePenaltyRuns,
  style_set: validateStyleSet,
  revise: validateRevise,
  innings_closed: validateInningsClosed,
  super_over_started: validateSuperOverStarted,
  substitute: validateSubstitute,
  player_added: validatePlayerAdded,
  conditions_changed: validateConditionsChanged,
  interrupt: validateInterrupt,
  resume: validateResume,
  finish: validateFinish,
  void: validateVoid,
  amend: validateAmend,
  restart: validateRestart,
  match_voided: validateMatchVoided,
  walkover: validateWalkover,
  abandon: validateAbandon,
};
export function validatePayload(type: EventType, payload: unknown): ValidationResult {
  const validator: ((value: unknown) => ValidationResult) | undefined = (
    PAYLOAD_VALIDATORS as Partial<Record<EventType, (value: unknown) => ValidationResult>>
  )[type];
  return validator ? validator(payload) : { ok: false, reason: "bad_payload" };
}

export function validMiscountedOvers(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, count]) => /^(0|[1-9]\d*)$/.test(key) && integer(Number(key)) && integer(count, 1),
    )
  );
}
