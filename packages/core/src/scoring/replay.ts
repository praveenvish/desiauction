import type { FamilyEngine } from "./family";
import type { MatchEvent } from "./types";
import type { MatchState } from "./delivery/state";
import { deliveryEngine } from "./delivery/engine";
export function replayMatch(events: readonly MatchEvent[]): MatchState;
export function replayMatch<S, P>(engine: FamilyEngine<S, P>, events: readonly MatchEvent[]): S;
export function replayMatch<S, P>(
  engineOrEvents: FamilyEngine<S, P> | readonly MatchEvent[],
  events?: readonly MatchEvent[],
): S | MatchState {
  if (Array.isArray(engineOrEvents)) return deliveryEngine.replay(engineOrEvents);
  if (!events) throw new Error("Match events are required.");
  return (engineOrEvents as FamilyEngine<S, P>).replay(events);
}
export function replayDelivery(events: readonly MatchEvent[]): MatchState {
  return replayMatch(deliveryEngine, events);
}
