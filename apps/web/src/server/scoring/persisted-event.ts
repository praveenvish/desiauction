import type { MatchEvent } from "@desiauction/core/scoring";
import type { matchEvents } from "@desiauction/db";

export function persistedMatchEvent(row: typeof matchEvents.$inferSelect): MatchEvent {
  return {
    eventId: row.eventId,
    seq: row.seq,
    attempt: row.attempt,
    type: row.type as MatchEvent["type"],
    v: row.v as 1,
    payload: row.payload as MatchEvent["payload"],
    targetEventId: row.targetEventId,
    actorPersonId: row.actorPersonId,
    clientSeq: row.clientSeq,
    clientRecordedAt: row.clientRecordedAt.toISOString(),
  };
}
