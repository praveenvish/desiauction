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
import { replayRaid } from "@desiauction/core/scoring/raid-replay";
import type { PreparedMatch } from "./prepare";
import { type RaidState, type MatchEvent } from "@desiauction/core/scoring";
const raidPolicy: LocalPolicy<RaidState> = {
  replay: replayRaid,
  accepted: (events, attempt) => {
    const state = replayRaid(events);
    return Boolean(
      state.attempt === attempt &&
      state.format &&
      state.teams &&
      state.squads[state.teams.home]?.length &&
      state.squads[state.teams.away]?.length,
    );
  },
  scoringReady: (state) => state.half > 0 || state.finished,
  undoTypes: ["raid"],
  refusal: (reason) => REJECT_MESSAGES[reason],
};
export class RaidLocalMatch extends LocalMatchModel<RaidState> {
  constructor(
    fixtureId: string,
    actorId: string,
    history: MatchEvent[],
    persist: Persist,
    changed: (view: MatchView<RaidState>) => void,
  ) {
    super(fixtureId, actorId, history, persist, changed, raidPolicy);
  }
}
export function useRaidMatch(
  fixtureId: string,
  actorId: string,
  events: MatchEvent[],
  bootstrap?: PreparedMatch["bootstrap"],
) {
  return useFamilyMatch(fixtureId, actorId, events, bootstrap, raidPolicy);
}
