import type { TimedAction } from "./timed/actions";
import type { RaidAction } from "./raid/actions";
import type { RallyAction } from "./rally/actions";
import type {
  ApplyResult,
  DerivedResult,
  MatchEvent,
  NameBook,
  NextAction,
  PlayerLine,
  PublicLiveState,
  ScoringFamily,
} from "./types";
import type { SeasonScoringRules } from "./season-rules";
export type FamilyAction = NextAction | RallyAction | RaidAction | TimedAction;
export interface FamilyEngine<S, P = unknown> {
  family: ScoringFamily;
  initialState(): S;
  replay(events: readonly MatchEvent[]): S;
  apply(state: S, event: MatchEvent): ApplyResult<S>;
  nextActions(state: S): FamilyAction[];
  deriveResult(state: S): DerivedResult | null;
  scoreForResult(
    state: S,
    rules: SeasonScoringRules,
  ): { home: Record<string, number>; away: Record<string, number> };
  playerLines(state: S): Map<string, PlayerLine>;
  publicLiveState(state: S, names: NameBook): PublicLiveState<P>;
}
