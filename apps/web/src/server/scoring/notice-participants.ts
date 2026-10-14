import {
  matches,
  competitions,
  matchEvents,
  matchPlayerLines,
  registrations,
  type Db,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { sportPack } from "@desiauction/core";
import { replayScoringState, scoringPlayerLines } from "./family-state";
import { persistedMatchEvent } from "./persisted-event";

/** Canonical rally participation is independent of unavailable award-point rows. */
export async function noticeParticipants(
  db: Db,
  fixtureId: string,
  orgId: string,
  competitionId: string,
) {
  const [season] = await db
    .select({ sport: competitions.sport })
    .from(competitions)
    .where(and(eq(competitions.id, competitionId), eq(competitions.orgId, orgId)));
  if (!season) return [];
  if (["rally", "timed", "placement"].includes(sportPack(season.sport)?.scoring?.family ?? "")) {
    const [match] = await db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.fixtureId, fixtureId),
          eq(matches.orgId, orgId),
          eq(matches.competitionId, competitionId),
        ),
      );
    if (!match?.finishedAt || match.phase === "void") return [];
    const rows = await db
      .select()
      .from(matchEvents)
      .where(
        and(
          eq(matchEvents.fixtureId, fixtureId),
          eq(matchEvents.orgId, orgId),
          eq(matchEvents.competitionId, competitionId),
        ),
      )
      .orderBy(matchEvents.seq);
    let state;
    try {
      state = replayScoringState(season.sport, rows.map(persistedMatchEvent));
    } catch {
      return [];
    }
    if (
      !state.finished ||
      state.phase === "void" ||
      state.attempt !== match.attempt ||
      state.lastSeq !== match.lastSeq
    )
      return [];
    const ids = [...scoringPlayerLines(state).keys()];
    return ids.length
      ? db
          .select({ registrationId: registrations.id, personId: registrations.personId })
          .from(registrations)
          .where(
            and(
              inArray(registrations.id, ids),
              eq(registrations.orgId, orgId),
              eq(registrations.competitionId, competitionId),
            ),
          )
      : [];
  }
  return db
    .select({ registrationId: registrations.id, personId: registrations.personId })
    .from(matchPlayerLines)
    .innerJoin(
      registrations,
      and(
        eq(registrations.id, matchPlayerLines.registrationId),
        eq(registrations.orgId, matchPlayerLines.orgId),
        eq(registrations.competitionId, matchPlayerLines.competitionId),
      ),
    )
    .where(
      and(
        eq(matchPlayerLines.fixtureId, fixtureId),
        eq(matchPlayerLines.orgId, orgId),
        eq(matchPlayerLines.competitionId, competitionId),
      ),
    );
}
