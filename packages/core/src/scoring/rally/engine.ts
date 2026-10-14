import type { FamilyEngine } from "../family";
import { initialRallyState, type RallyState } from "./state";
import { applyRally } from "./apply";
import { replayRally } from "./replay";
import { rallyNextActions } from "./next-actions";
import { deriveRallyResult, rallyResultScore } from "./result";
import { rallyPlayerLines } from "./lines";
import { rallyPublicLiveState, type RallyPanel } from "./public-state";
export const rallyEngine = {
  family: "rally" as const,
  initialState: initialRallyState,
  apply: applyRally,
  replay: replayRally,
  nextActions: rallyNextActions,
  deriveResult: deriveRallyResult,
  scoreForResult: rallyResultScore,
  playerLines: rallyPlayerLines,
  publicLiveState: rallyPublicLiveState,
} satisfies FamilyEngine<RallyState, RallyPanel>;
