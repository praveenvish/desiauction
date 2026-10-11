import { integer } from "../validate-primitives";
import type { PlacementEventPayloads } from "./payloads";
import type { MatchEvent } from "../types";
import { ReplayError } from "../replay-error";
import { initialPlacementState, type PlacementState } from "./state";
import { placementTransition } from "./transition";
import { validatePlacementPayload } from "./validate";
function fold(events: readonly MatchEvent[], initial: PlacementState): PlacementState {
  const effective = new Map<string, MatchEvent>(),
    roots = new Map<string, string>(),
    seen = new Map<string, MatchEvent>(),
    voided = new Set<string>();
  for (const event of events) {
    const valid = validatePlacementPayload(event.type, event.payload);
    if (!valid.ok) throw new ReplayError(event.seq, valid.reason);
    if (event.type === "void" || event.type === "amend") {
      const target = event.targetEventId ? seen.get(event.targetEventId) : undefined,
        root = target ? roots.get(target.eventId) : undefined;
      if (
        !target ||
        !root ||
        target.type === "match_voided" ||
        target.seq >= event.seq ||
        target.attempt !== event.attempt ||
        voided.has(root)
      )
        throw new ReplayError(event.seq, "unknown_target");
      const original = effective.get(root);
      if (!original) throw new ReplayError(event.seq, "unknown_target");
      if (event.type === "void") {
        if (target.type === "amend") throw new ReplayError(event.seq, "unknown_target");
        voided.add(root);
      } else {
        const payload = (event.payload as { payload: unknown }).payload;
        if (!validatePlacementPayload(original.type, payload).ok)
          throw new ReplayError(event.seq, "amend_type_mismatch");
        if (original.type === "match_started") {
          const before = original.payload as PlacementEventPayloads["match_started"];
          const after = payload as PlacementEventPayloads["match_started"];
          const oldCompetition = before.competition ?? initial.competition;
          const newCompetition = after.competition ?? initial.competition;
          if (
            oldCompetition?.name !== newCompetition?.name ||
            oldCompetition?.season !== newCompetition?.season
          )
            throw new ReplayError(event.seq, "amend_type_mismatch");
        }
        effective.set(root, { ...original, payload } as MatchEvent);
        roots.set(event.eventId, root);
      }
    } else {
      if (event.targetEventId !== null) throw new ReplayError(event.seq, "bad_payload");
      effective.set(event.eventId, event);
      roots.set(event.eventId, event.eventId);
    }
    seen.set(event.eventId, event);
  }
  let state = initial;
  for (const event of effective.values()) {
    if (voided.has(event.eventId)) continue;
    const result = placementTransition(state, event);
    if (!result.ok) {
      const last = events.at(-1);
      throw new ReplayError(
        last && (last.type === "void" || last.type === "amend") ? last.seq : event.seq,
        last && (last.type === "void" || last.type === "amend")
          ? "amend_breaks_later_events"
          : result.reason,
      );
    }
    state = result.state;
  }
  return state;
}
export function replayPlacement(events: readonly MatchEvent[]): PlacementState {
  const ordered = [...events].sort((a, b) => a.seq - b.seq),
    ids = new Set<string>(),
    seqs = new Set<number>();
  let previousStamp: number | null = null;
  let initial = initialPlacementState(),
    segment: MatchEvent[] = [],
    terminalVoid = false;
  for (const event of ordered) {
    const stamp = Date.parse(event.clientRecordedAt);
    if (!Number.isFinite(stamp) || (previousStamp !== null && stamp < previousStamp))
      throw new ReplayError(event.seq, "bad_payload");
    previousStamp = stamp;
    if (terminalVoid) throw new ReplayError(event.seq, "already_finished");
    if (ids.has(event.eventId) || seqs.has(event.seq))
      throw new ReplayError(event.seq, "duplicate");
    ids.add(event.eventId);
    seqs.add(event.seq);
    if (!integer(event.v, 1, 1) || !Number.isSafeInteger(event.seq) || event.seq < 1)
      throw new ReplayError(event.seq, "bad_payload");
    if (event.attempt !== initial.attempt) throw new ReplayError(event.seq, "wrong_attempt");
    if (event.type === "match_voided") terminalVoid = true;
    if (event.type === "restart") {
      if (!validatePlacementPayload(event.type, event.payload).ok || event.targetEventId !== null)
        throw new ReplayError(event.seq, "bad_payload");
      const before = fold(segment, initial);
      if (before.finished) throw new ReplayError(event.seq, "already_finished");
      if (!before.format) throw new ReplayError(event.seq, "not_live");
      initial = { ...initialPlacementState(initial.attempt + 1), competition: before.competition };
      segment = [];
    } else segment.push(event);
  }
  const state = fold(segment, initial),
    last = ordered.at(-1);
  return {
    ...state,
    eventHistory: ordered,
    lastSeq: last?.seq ?? 0,
    lastEventAt: last?.clientRecordedAt ?? null,
  };
}
