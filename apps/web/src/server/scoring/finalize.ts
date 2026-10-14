import {
  isRallyState,
  isPlacementState,
  isDeliveryState,
  scoringResult,
  scoringStateMatchesSport,
  type ScoringState,
} from "./family-state";
import { placementTable, parseSeasonScoringRules } from "@desiauction/core/scoring";
import {
  auditLog,
  competitions,
  fixtureParticipants,
  fixtureResults,
  fixtures,
  newId,
  type Db,
} from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { persistFinalizedLinesAndAwards } from "./awards";
import { persistFinalizedBallFacts } from "./ball-facts";
import { updateMatchTrust } from "./trust";

export interface FinalizationEffect {
  fixtureId: string;
  slug: string;
}
/** Internal scored-result writer; never enters the typed-result mutation door. */
export async function writeScoredResult(
  db: Db,
  fixture: { id: string; orgId: string; competitionId: string },
  actorId: string,
  state: ScoringState,
  rules: ReturnType<typeof parseSeasonScoringRules>,
  now: Date,
) {
  const [competition] = await db
    .select({ sport: competitions.sport })
    .from(competitions)
    .where(eq(competitions.id, fixture.competitionId));
  if (!competition || !scoringStateMatchesSport(state, competition.sport))
    throw new Error("Scored season has no matching scoring engine");
  if (isPlacementState(state)) {
    if (!state.finished || !state.format) throw new Error("Lobby must be finalized");
    for (const row of placementTable(state))
      await db
        .update(fixtureParticipants)
        .set({
          placement: state.terminal ? null : row.placement,
          score: state.terminal ? null : { kills: row.kills },
          source: "scored",
        })
        .where(
          and(
            eq(fixtureParticipants.fixtureId, fixture.id),
            eq(fixtureParticipants.orgId, fixture.orgId),
            eq(fixtureParticipants.competitionId, fixture.competitionId),
            eq(fixtureParticipants.teamId, row.teamId),
          ),
        );
    return;
  }
  const { result, score } = scoringResult(state, rules);
  if (!result) throw new Error("A finished match must have a derived result");
  const values = {
    fixtureId: fixture.id,
    orgId: fixture.orgId,
    competitionId: fixture.competitionId,
    source: "scored" as const,
    outcome: result.outcome,
    winnerTeamId: result.winnerTeamId,
    score: { home: { ...score.home }, away: { ...score.away } },
    method: result.method,
    note: result.marginText,
    recordedBy: actorId,
    updatedAt: now,
  };
  await db
    .insert(fixtureResults)
    .values(values)
    .onConflictDoUpdate({ target: fixtureResults.fixtureId, set: values });
}
/** Caller holds the match lock in its append transaction. */
export async function finalizeScoredMatch(
  db: Db,
  fixtureId: string,
  actorId: string,
  state: ScoringState,
  now = new Date(),
  options: { recordedBy?: string } = {},
): Promise<FinalizationEffect> {
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!fixture) throw new Error("Scored fixture is missing");
  const [season] = await db
    .select({
      slug: competitions.slug,
      sport: competitions.sport,
      scoringRules: competitions.scoringRules,
    })
    .from(competitions)
    .where(eq(competitions.id, fixture.competitionId));
  if (!season) throw new Error("Scored season is missing");
  await writeScoredResult(
    db,
    fixture,
    options.recordedBy ?? actorId,
    state,
    parseSeasonScoringRules(season.scoringRules),
    now,
  );
  if (fixture.status !== "completed") {
    const updated = await db
      .update(fixtures)
      .set({ status: "completed", completedAt: now })
      .where(and(eq(fixtures.id, fixtureId), eq(fixtures.status, "in_progress")))
      .returning({ id: fixtures.id });
    if (!updated.length) throw new Error("Scored fixture cannot complete from its current status");
  }
  await updateMatchTrust(db, fixtureId, state, now, { finalizedRevision: true });
  if (!isRallyState(state)) {
    await persistFinalizedLinesAndAwards(db, fixture, season.sport, actorId, state, now);
    if (isDeliveryState(state)) await persistFinalizedBallFacts(db, fixture, state);
  }
  await db.insert(auditLog).values({
    id: newId(),
    actor: actorId,
    action: "match.finalized",
    scopeType: "org",
    scopeId: fixture.orgId,
    subject: fixtureId,
    meta: { attempt: state.attempt, lastSeq: state.lastSeq },
    at: now,
  });
  return { fixtureId, slug: season.slug };
}
/** Called only after the append transaction commits. C36/C38 add notification dispatch. */
export function revalidateScoredMatch(effect: FinalizationEffect): void {
  revalidatePath(`/seasons/${effect.slug}/fixtures`);
  revalidatePath(`/seasons/${effect.slug}/standings`);
  revalidatePath(`/c/${effect.slug}`);
}
