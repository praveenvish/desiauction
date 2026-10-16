import type { DerivedResult } from "../types";
import type { MatchState } from "./state";
import { resultOf } from "./outcomes";

export function deriveResult(state: MatchState): DerivedResult | null {
  return resultOf(state);
}
