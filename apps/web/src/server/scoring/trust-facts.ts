import {
  detectRallyPace,
  detectRaidPace,
  timedActivity,
  placementActivity,
  timedLiveMinimum,
  LIVE_RECEIPT_WINDOW_MS,
} from "@desiauction/core/scoring";
import { competitions, matches, matchEvents, registrations, type Db } from "@desiauction/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { systemDb } from "../db";
import { persistedMatchEvent } from "./persisted-event";
import {
  isRallyState,
  isRaidState,
  isTimedState,
  isPlacementState,
  isDeliveryState,
  replayScoringState,
  scoringPlayerLines,
  type ScoringState,
} from "./family-state";

export interface PlayWindow {
  start: number;
  end: number;
}
export function playWindow(
  state: ScoringState,
  rows: readonly (typeof matchEvents.$inferSelect)[],
  now: Date,
): PlayWindow | null {
  const effective = new Set(
    isRallyState(state)
      ? state.rallies.map((rally) => rally.eventId)
      : isRaidState(state)
        ? state.raids.map((raid) => raid.eventId)
        : isPlacementState(state)
          ? placementActivity(state).map((event) => event.eventId)
          : isTimedState(state)
            ? timedActivity(state).map((event) => event.eventId)
            : state.innings.flatMap((innings) =>
                innings.overs.flatMap((over) => over.balls.map((ball) => ball.eventId)),
              ),
  );
  const balls = rows.filter(
    (row) =>
      row.attempt === state.attempt &&
      (isTimedState(state) ||
        isPlacementState(state) ||
        row.type === (isRallyState(state) ? "rally" : isRaidState(state) ? "raid" : "ball")) &&
      effective.has(row.eventId),
  );
  if (
    (isTimedState(state) && !timedLiveMinimum(state)) ||
    !balls.length ||
    balls.length !== effective.size ||
    balls.some((ball) => {
      const client = ball.clientRecordedAt.getTime(),
        receipt = ball.receivedAt.getTime();
      return (
        !Number.isFinite(client) ||
        !Number.isFinite(receipt) ||
        client > receipt ||
        receipt - client > LIVE_RECEIPT_WINDOW_MS
      );
    })
  )
    return null;
  if (
    !isDeliveryState(state) &&
    !(isRallyState(state) ? detectRallyPace : detectRaidPace)(
      (isRallyState(state)
        ? state.rallies
        : isPlacementState(state)
          ? placementActivity(state)
          : isTimedState(state)
            ? timedActivity(state)
            : state.raids
      ).map((rally) => {
        const receipt = balls.find((row) => row.eventId === rally.eventId);
        return {
          legal: true,
          clientRecordedAt: rally.clientRecordedAt,
          receivedAt: receipt?.receivedAt.toISOString() ?? "",
        };
      }),
    ).liveScored
  )
    return null;
  const start = Math.min(...balls.map((row) => row.receivedAt.getTime()));
  const finish = rows.findLast((row) => row.attempt === state.attempt && row.type === "finish");
  const end = state.finished && finish ? finish.receivedAt.getTime() : now.getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}
/** Internal C38 Astra exception: relevant canonical identities/windows only; no elevated writes. */
export async function overlappingPlay(
  fixture: { id: string; orgId: string; competitionId: string },
  state: ScoringState,
  window: PlayWindow | null,
  now: Date,
  reader: Db = systemDb,
): Promise<boolean> {
  if (!window) return false;
  const ids = [...scoringPlayerLines(state).keys()];
  if (!ids.length) return false;
  const own = await reader
    .select({ personId: registrations.personId })
    .from(registrations)
    .where(
      and(
        eq(registrations.orgId, fixture.orgId),
        eq(registrations.competitionId, fixture.competitionId),
        inArray(registrations.id, ids),
      ),
    );
  const persons = [...new Set(own.map((row) => row.personId))];
  if (!persons.length) return false;
  const related = await reader
    .select({ id: registrations.id, competitionId: registrations.competitionId })
    .from(registrations)
    .where(inArray(registrations.personId, persons));
  const seasons = [...new Set(related.map((row) => row.competitionId))];
  const candidates = await reader
    .select({
      fixtureId: matches.fixtureId,
      attempt: matches.attempt,
      lastSeq: matches.lastSeq,
      sport: competitions.sport,
    })
    .from(matches)
    .innerJoin(
      competitions,
      and(eq(competitions.id, matches.competitionId), eq(competitions.orgId, matches.orgId)),
    )
    .where(
      and(
        ne(matches.fixtureId, fixture.id),
        ne(matches.phase, "void"),
        inArray(matches.competitionId, seasons),
      ),
    );
  for (const match of candidates) {
    const rows = await reader
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.fixtureId, match.fixtureId))
      .orderBy(matchEvents.seq);
    let other: ScoringState;
    try {
      other = replayScoringState(match.sport, rows.map(persistedMatchEvent));
    } catch {
      continue;
    }
    if (
      other.attempt !== match.attempt ||
      other.lastSeq !== match.lastSeq ||
      other.phase === "void"
    )
      continue;
    const participants = scoringPlayerLines(other);
    if (!related.some((row) => participants.has(row.id))) continue;
    const otherWindow = playWindow(other, rows, now);
    if (otherWindow && window.start < otherWindow.end && otherWindow.start < window.end)
      return true;
  }
  return false;
}
