import type { MatchEvent } from "../types";
import { applyTransition } from "./transition";
import { initialState } from "./state";
import type { MatchState } from "./state";
import { integer, validatePayload } from "./validate";

import { ReplayError } from "../replay-error";
export { ReplayError } from "../replay-error";

function fold(events: readonly MatchEvent[], initial: MatchState): MatchState {
  const effective = new Map<string, MatchEvent>();
  const roots = new Map<string, string>();
  const seen = new Map<string, MatchEvent>();
  const voided = new Set<string>();
  for (const event of events) {
    const validation = validatePayload(event.type, event.payload);
    if (!validation.ok) throw new ReplayError(event.seq, validation.reason);
    if (event.type === "void" || event.type === "amend") {
      const target = event.targetEventId ? seen.get(event.targetEventId) : undefined;
      const root = target ? roots.get(target.eventId) : undefined;
      if (
        !target ||
        target.type === "match_voided" ||
        !root ||
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
        const valid = validatePayload(original.type, payload);
        if (!valid.ok)
          throw new ReplayError(
            event.seq,
            valid.reason === "bad_payload" ? "amend_type_mismatch" : valid.reason,
          );
        if (original.type === "match_started") {
          const before = original.payload as {
            superOverTie?: string;
            competition?: { name: string; season: string };
          };
          const after = payload as {
            superOverTie?: string;
            competition?: { name: string; season: string };
          };
          const oldCompetition = before.competition ?? initial.competition;
          const newCompetition = after.competition ?? initial.competition;
          if (
            oldCompetition?.name !== newCompetition?.name ||
            oldCompetition?.season !== newCompetition?.season ||
            (before.superOverTie ?? initial.originalTieSetting ?? "another") !==
              (after.superOverTie ?? initial.originalTieSetting ?? "another")
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
    const result = applyTransition(state, event);
    if (!result.ok) {
      const last = events[events.length - 1];
      if (last && (last.type === "amend" || last.type === "void"))
        throw new ReplayError(last.seq, "amend_breaks_later_events");
      throw new ReplayError(event.seq, result.reason);
    }
    state = result.state;
  }
  return state;
}

export function replayMatch(events: readonly MatchEvent[]): MatchState {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  let initial = initialState();
  let segment: MatchEvent[] = [];
  const seen = new Set<string>();
  const sequences = new Set<number>();
  let voidedMatch = false;
  for (const event of ordered) {
    if (voidedMatch) throw new ReplayError(event.seq, "already_finished");
    if (event.type === "match_voided") voidedMatch = true;
    if (seen.has(event.eventId) || sequences.has(event.seq))
      throw new ReplayError(event.seq, "duplicate");
    seen.add(event.eventId);
    sequences.add(event.seq);
    if (!integer(event.v, 1, 1) || !integer(event.seq, 1))
      throw new ReplayError(event.seq, "bad_payload");
    if (event.attempt !== initial.attempt) throw new ReplayError(event.seq, "wrong_attempt");
    if (event.type === "restart") {
      const valid = validatePayload(event.type, event.payload);
      if (!valid.ok || event.targetEventId !== null)
        throw new ReplayError(event.seq, "bad_payload");
      const before = fold(segment, initial);
      if (before.finished) throw new ReplayError(event.seq, "already_finished");
      if (!before.format) throw new ReplayError(event.seq, "not_live");
      initial = {
        ...initialState(initial.attempt + 1),
        superOverTie: before.superOverTie,
        originalTieSetting: before.originalTieSetting,
        competition: before.competition ? { ...before.competition } : null,
      };
      segment = [];
    } else segment.push(event);
  }
  const state = fold(segment, initial);
  const last = ordered[ordered.length - 1];
  return {
    ...state,
    eventHistory: ordered,
    lastSeq: last?.seq ?? 0,
    lastEventAt: last?.clientRecordedAt ?? null,
  };
}
