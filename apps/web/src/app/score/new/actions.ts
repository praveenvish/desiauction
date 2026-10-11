"use server";
import { currentSession } from "../../../server/auth/actions";
import { fixtures, people, registrations, withTenantDb } from "@desiauction/db";
import { eq, sql } from "drizzle-orm";
import { dbHandle } from "../../../server/db";
import { scoringOrgIds } from "../../../server/scoring/home";
import { createQuickMatch, reuseQuickPlayer } from "../../../server/scoring/quick-match";
export async function createQuickMatchAction(input: unknown) {
  const session = await currentSession();
  if (!session) return { ok: false as const, message: "Sign in to create a match." };
  try {
    const result = await createQuickMatch(session.personId, input);
    return { ok: true as const, fixtureId: result.fixtureId };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "This match could not be created.",
    };
  }
}

export async function reuseQuickPlayerAction(
  fixtureId: string,
  teamId: string,
  previousRegistrationId: string,
) {
  const session = await currentSession();
  if (!session) return { ok: false as const, message: "Sign in to pick players." };
  try {
    for (const orgId of await scoringOrgIds(session.personId)) {
      const result = await withTenantDb(
        dbHandle,
        { personId: session.personId, orgId },
        async (db) => {
          const [fixture] = await db
            .select()
            .from(fixtures)
            .where(eq(fixtures.id, fixtureId))
            .for("update");
          if (!fixture) return null;
          if (
            !["published", "in_progress"].includes(fixture.status) ||
            ![fixture.homeTeamId, fixture.awayTeamId].includes(teamId)
          )
            throw new Error("Choose a team playing this match.");
          const registrationId = await reuseQuickPlayer(
            db,
            orgId,
            session.personId,
            fixture.competitionId,
            teamId,
            previousRegistrationId,
          );
          const [player] = await db
            .select({
              name: sql<string>`coalesce(${registrations.enteredName}, ${people.name}, 'Player')`,
            })
            .from(registrations)
            .innerJoin(people, eq(people.id, registrations.personId))
            .where(eq(registrations.id, registrationId));
          return { ok: true as const, registrationId, name: player?.name ?? "Player" };
        },
      );
      if (result) return result;
    }
    return { ok: false as const, message: "Match not found." };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "This player could not be added.",
    };
  }
}
