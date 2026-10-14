import type { FamilyEngine } from "../family";
import type { PlayerLine } from "../types";
import { initialRaidState, type RaidState } from "./state";
import { applyRaid } from "./apply";
import { replayRaid } from "./replay";
import { raidNextActions } from "./next-actions";
import { deriveRaidResult, raidResultScore } from "./result";
import { raidPublicLiveState, type RaidPanel } from "./public-state";
export function raidPlayerLines(state: RaidState): Map<string, PlayerLine> {
  return new Map(
    Object.entries(state.participants).map(([registrationId, entry]) => [
      registrationId,
      { registrationId, teamId: entry.teamId, appeared: true, raid: { ...entry.stats } },
    ]),
  );
}
export const raidEngine = {
  family: "raid" as const,
  initialState: initialRaidState,
  apply: applyRaid,
  replay: replayRaid,
  nextActions: raidNextActions,
  deriveResult: deriveRaidResult,
  scoreForResult: raidResultScore,
  playerLines: raidPlayerLines,
  publicLiveState: raidPublicLiveState,
} satisfies FamilyEngine<RaidState, RaidPanel>;
