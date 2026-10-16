"use client";
import {
  LocalMatchModel,
  useFamilyMatch,
  type LocalPolicy,
  type Persist,
  type MatchView,
} from "./use-family-match";
export type { MatchView, LocalEntry } from "./use-family-match";
import { REJECT_MESSAGES } from "@desiauction/core/scoring/messages";
import { replayPlacement } from "@desiauction/core/scoring/placement-replay";
import type { PreparedMatch } from "./prepare";
import { type PlacementState, type MatchEvent } from "@desiauction/core/scoring";
const placementPolicy: LocalPolicy<PlacementState> = {
  replay: replayPlacement,
  accepted: (events, attempt) => {
    const state = replayPlacement(events);
    return Boolean(
      state.attempt === attempt &&
      state.format &&
      state.teamIds.length &&
      state.teamIds.every((id) => state.squads[id]?.length),
    );
  },
  scoringReady: (state) => state.rounds.length > 0 || state.finished,
  undoTypes: ["lobby_round"],
  refusal: (reason) => REJECT_MESSAGES[reason],
};
export class PlacementLocalMatch extends LocalMatchModel<PlacementState> {
  constructor(
    fixtureId: string,
    actorId: string,
    history: MatchEvent[],
    persist: Persist,
    changed: (view: MatchView<PlacementState>) => void,
  ) {
    super(fixtureId, actorId, history, persist, changed, placementPolicy);
  }
}
export function usePlacementMatch(
  fixtureId: string,
  actorId: string,
  events: MatchEvent[],
  bootstrap?: PreparedMatch["bootstrap"],
) {
  return useFamilyMatch(fixtureId, actorId, events, bootstrap, placementPolicy);
}
