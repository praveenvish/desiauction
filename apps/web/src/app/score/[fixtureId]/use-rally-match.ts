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
import { replayRally } from "@desiauction/core/scoring/rally-replay";
import type { PreparedMatch } from "./prepare";
import { type RallyState, type MatchEvent } from "@desiauction/core/scoring";
const rallyPolicy: LocalPolicy<RallyState> = {
  replay: replayRally,
  accepted: (events, attempt) => {
    const state = replayRally(events);
    return Boolean(
      state.attempt === attempt &&
      state.format &&
      state.teams &&
      state.squads[state.teams.home]?.length &&
      state.squads[state.teams.away]?.length,
    );
  },
  scoringReady: (state) => state.rubbers.length > 0 || state.finished,
  undoTypes: ["rally"],
  refusal: (reason) =>
    reason === "innings_over" ? "This game is complete." : REJECT_MESSAGES[reason],
};
export class RallyLocalMatch extends LocalMatchModel<RallyState> {
  constructor(
    fixtureId: string,
    actorId: string,
    history: MatchEvent[],
    persist: Persist,
    changed: (view: MatchView<RallyState>) => void,
  ) {
    super(fixtureId, actorId, history, persist, changed, rallyPolicy);
  }
}
export function useRallyMatch(
  fixtureId: string,
  actorId: string,
  events: MatchEvent[],
  bootstrap?: PreparedMatch["bootstrap"],
) {
  return useFamilyMatch(fixtureId, actorId, events, bootstrap, rallyPolicy);
}
