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
import { replayTimed } from "@desiauction/core/scoring/timed-replay";
import type { PreparedMatch } from "./prepare";
import { type TimedState, type MatchEvent } from "@desiauction/core/scoring";
const timedPolicy: LocalPolicy<TimedState> = {
  replay: replayTimed,
  accepted: (events, attempt) => {
    const state = replayTimed(events);
    return Boolean(
      state.attempt === attempt &&
      state.format &&
      state.teams &&
      state.squads[state.teams.home]?.length &&
      state.squads[state.teams.away]?.length,
    );
  },
  scoringReady: (state) => state.period > 0 || state.finished,
  undoTypes: ["score", "card", "foul", "shootout_attempt"],
  refusal: (reason) => REJECT_MESSAGES[reason],
};
export class TimedLocalMatch extends LocalMatchModel<TimedState> {
  constructor(
    fixtureId: string,
    actorId: string,
    history: MatchEvent[],
    persist: Persist,
    changed: (view: MatchView<TimedState>) => void,
  ) {
    super(fixtureId, actorId, history, persist, changed, timedPolicy);
  }
}
export function useTimedMatch(
  fixtureId: string,
  actorId: string,
  events: MatchEvent[],
  bootstrap?: PreparedMatch["bootstrap"],
) {
  return useFamilyMatch(fixtureId, actorId, events, bootstrap, timedPolicy);
}
