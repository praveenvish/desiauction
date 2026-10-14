import type { MatchEvent } from "../types";
import type { TimedState } from "./state";
const types = new Set([
  "period_started",
  "period_ended",
  "clock",
  "interrupt",
  "resume",
  "score",
  "card",
  "sub",
  "foul",
  "shootout_attempt",
]);
/** Already validated canonical history: amendments retain the original activity receipt identity. */
export function timedActivity(state: TimedState): MatchEvent[] {
  const effective = new Map<string, MatchEvent>(),
    roots = new Map<string, string>();
  for (const event of state.eventHistory) {
    if (event.attempt !== state.attempt) continue;
    if (event.type === "void") {
      if (event.targetEventId) effective.delete(event.targetEventId);
    } else if (event.type === "amend") {
      const root = event.targetEventId ? roots.get(event.targetEventId) : undefined;
      const original = root ? effective.get(root) : undefined;
      if (root && original) {
        effective.set(root, {
          ...original,
          payload: (event.payload as { payload: unknown }).payload,
        } as MatchEvent);
        roots.set(event.eventId, root);
      }
    } else {
      effective.set(event.eventId, event);
      roots.set(event.eventId, event.eventId);
    }
  }
  return [...effective.values()].filter((event) => types.has(event.type));
}
export function timedLiveMinimum(state: TimedState): boolean {
  const activity = timedActivity(state);
  return (
    activity.some((event) => event.type === "score" || event.type === "shootout_attempt") ||
    (state.gameClockMs > 0 &&
      activity.some((event) => event.type === "period_started" || event.type === "clock"))
  );
}
