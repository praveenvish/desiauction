import {
  ReplayError,
  placementEngine,
  type PlacementState,
  deliveryEngine,
  rallyEngine,
  raidEngine,
  timedEngine,
  type TimedState,
  type RaidState,
  type MatchState,
  type RallyState,
  type MatchEvent,
  type NameBook,
  type SeasonScoringRules,
} from "@desiauction/core/scoring";
import { sportPack } from "@desiauction/core";

export type ScoringState = MatchState | RallyState | RaidState | TimedState | PlacementState;
export function isPlacementState(state: ScoringState): state is PlacementState {
  return "family" in state && state.family === "placement";
}
export function isRallyState(state: ScoringState): state is RallyState {
  return "family" in state && state.family === "rally";
}
export function isRaidState(state: ScoringState): state is RaidState {
  return "family" in state && state.family === "raid";
}
export function isTimedState(state: ScoringState): state is TimedState {
  return "family" in state && state.family === "timed";
}
export function isDeliveryState(state: ScoringState): state is MatchState {
  return !("family" in state);
}
/** Strict persisted sport identity selects the canonical fold, never a label fallback. */
export function replayScoringState(sport: string, events: readonly MatchEvent[]): ScoringState {
  const family = sportPack(sport)?.scoring?.family;
  if (family === "placement") return placementEngine.replay(events);
  if (family === "delivery") return deliveryEngine.replay(events);
  if (family === "rally") {
    const state = rallyEngine.replay(events);
    const scoring = sportPack(sport)?.scoring;
    if (
      state.format &&
      (scoring?.family !== "rally" ||
        !scoring.formats.some((format) => format.key === state.format?.key))
    )
      throw new ReplayError(state.lastSeq, "bad_payload");
    return state;
  }
  if (family === "raid") {
    const state = raidEngine.replay(events),
      scoring = sportPack(sport)?.scoring;
    if (
      state.format &&
      (scoring?.family !== "raid" ||
        !scoring.formats.some((format) => format.key === state.format?.key))
    )
      throw new ReplayError(state.lastSeq, "bad_payload");
    return state;
  }
  if (family === "timed") {
    const state = timedEngine.replay(events),
      scoring = sportPack(sport)?.scoring;
    if (
      state.format &&
      (scoring?.family !== "timed" ||
        !scoring.formats.some((format) => format.key === state.format?.key))
    )
      throw new ReplayError(state.lastSeq, "bad_payload");
    return state;
  }
  throw new Error("Season has no supported scoring engine");
}
export function scoringPlayerLines(state: ScoringState) {
  return isPlacementState(state)
    ? placementEngine.playerLines(state)
    : isRallyState(state)
      ? rallyEngine.playerLines(state)
      : isRaidState(state)
        ? raidEngine.playerLines(state)
        : isTimedState(state)
          ? timedEngine.playerLines(state)
          : deliveryEngine.playerLines(state);
}
export function scoringPublicState(state: ScoringState, names: NameBook) {
  return isPlacementState(state)
    ? placementEngine.publicLiveState(state, names)
    : isRallyState(state)
      ? rallyEngine.publicLiveState(state, names)
      : isRaidState(state)
        ? raidEngine.publicLiveState(state, names)
        : isTimedState(state)
          ? timedEngine.publicLiveState(state, names)
          : deliveryEngine.publicLiveState(state, names);
}
export function scoringResult(state: ScoringState, rules: SeasonScoringRules) {
  if (isPlacementState(state)) throw new Error("Lobby results use their own participant writer");
  return isRallyState(state)
    ? { result: rallyEngine.deriveResult(state), score: rallyEngine.scoreForResult(state, rules) }
    : isRaidState(state)
      ? { result: raidEngine.deriveResult(state), score: raidEngine.scoreForResult(state, rules) }
      : isTimedState(state)
        ? {
            result: timedEngine.deriveResult(state),
            score: timedEngine.scoreForResult(state, rules),
          }
        : {
            result: deliveryEngine.deriveResult(state),
            score: deliveryEngine.scoreForResult(state, rules),
          };
}
export function scoringStateMatchesSport(state: ScoringState, sport: string): boolean {
  return (
    sportPack(sport)?.scoring?.family ===
    (isPlacementState(state)
      ? "placement"
      : isRallyState(state)
        ? "rally"
        : isRaidState(state)
          ? "raid"
          : isTimedState(state)
            ? "timed"
            : "delivery")
  );
}
