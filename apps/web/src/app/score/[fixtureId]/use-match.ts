"use client";
import {
  LocalMatchModel,
  useFamilyMatch,
  type LocalPolicy,
  type Persist,
  type MatchView,
} from "./use-family-match";
export type { MatchView, LocalEntry } from "./use-family-match";
import type { PreparedMatch } from "./prepare";
import {
  replayMatch,
  REJECT_MESSAGES,
  type MatchState,
  type MatchEvent,
} from "@desiauction/core/scoring";
import { missingRestartSetupEntries } from "./sheets/menu-model";
export function acceptedSetup(events: readonly MatchEvent[], attempt: number): boolean {
  const canonical = replayMatch(events);
  const restart = events.findLast((event) => event.type === "restart");
  return Boolean(
    (!restart || missingRestartSetupEntries(canonical, restart.eventId).length === 0) &&
    canonical.attempt === attempt &&
    canonical.format &&
    canonical.teams &&
    canonical.lineups[canonical.teams.home] &&
    canonical.lineups[canonical.teams.away],
  );
}

const deliveryPolicy: LocalPolicy<MatchState> = {
  replay: replayMatch,
  accepted: acceptedSetup,
  scoringReady: (state) => state.innings.length > 0 || state.outcome !== null || state.finished,
  undoTypes: ["ball", "strike_swapped"],
  refusal: (reason) => REJECT_MESSAGES[reason],
};
export class LocalMatch extends LocalMatchModel<MatchState> {
  constructor(
    fixtureId: string,
    actorId: string,
    history: MatchEvent[],
    persist: Persist,
    changed: (view: MatchView) => void,
  ) {
    super(fixtureId, actorId, history, persist, changed, deliveryPolicy);
  }
}
export function useMatch(
  fixtureId: string,
  actorId: string,
  events: MatchEvent[],
  bootstrap?: PreparedMatch["bootstrap"],
) {
  return useFamilyMatch(fixtureId, actorId, events, bootstrap, deliveryPolicy);
}
