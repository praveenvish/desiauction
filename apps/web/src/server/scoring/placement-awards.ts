import {
  placementFormat,
  placementPlayers,
  topFragger,
  type PlacementState,
} from "@desiauction/core/scoring";
import { matchAwards, matches, newId, type Db } from "@desiauction/db";
import { and, desc, eq } from "drizzle-orm";
export async function persistPlacementAward(
  db: Db,
  fixture: { id: string; orgId: string; competitionId: string },
  actorId: string,
  state: PlacementState,
  now: Date,
) {
  const [match] = await db.select().from(matches).where(eq(matches.fixtureId, fixture.id));
  if (
    !match ||
    !state.format ||
    match.awardVersion !== `top-fragger-v1/${state.format.key}` ||
    JSON.stringify(state.format) !== JSON.stringify(placementFormat(match.format)) ||
    match.attempt !== state.attempt ||
    match.lastSeq !== state.lastSeq
  )
    throw new Error("Frozen lobby award configuration is inconsistent");
  const rows = await db
    .select()
    .from(matchAwards)
    .where(
      and(
        eq(matchAwards.fixtureId, fixture.id),
        eq(matchAwards.scope, "match"),
        eq(matchAwards.kind, "top_fragger"),
      ),
    )
    .orderBy(desc(matchAwards.createdAt), desc(matchAwards.id));
  if (rows.some((row) => row.source === "organizer")) return;
  const winner = topFragger(state),
    score = winner ? (placementPlayers(state).get(winner)?.kills ?? 0).toFixed(2) : null,
    previous = rows[0];
  if (
    previous?.source === "auto" &&
    previous.computedRegistrationId === winner &&
    previous.winnerRegistrationId === winner &&
    previous.score === score
  )
    return;
  await db.insert(matchAwards).values({
    id: newId(),
    fixtureId: fixture.id,
    orgId: fixture.orgId,
    competitionId: fixture.competitionId,
    scope: "match",
    kind: "top_fragger",
    computedRegistrationId: winner,
    winnerRegistrationId: winner,
    source: "auto",
    score,
    actorPersonId: actorId,
    createdAt: new Date(
      Math.max(now.getTime(), previous ? previous.createdAt.getTime() + 1 : now.getTime()),
    ),
  });
}
