import type { FamilyEngine } from "../family";
import { initialState, type MatchState } from "./state";
import { replayMatch } from "./replay";
import { applyEvent } from "./apply";
import { nextActions } from "./next-actions";
import { deriveResult } from "./result";
import { scoreForResult } from "./nrr";
import { playerLines } from "./lines";
import { publicLiveState, type DeliveryPanel } from "./public-state";
export const deliveryEngine = {
  family: "delivery" as const,
  initialState,
  replay: replayMatch,
  apply: applyEvent,
  nextActions,
  deriveResult,
  scoreForResult(state, rules) {
    const score = scoreForResult(state, rules);
    return { home: { ...score.home }, away: { ...score.away } };
  },
  playerLines,
  publicLiveState,
} satisfies FamilyEngine<MatchState, DeliveryPanel>;
