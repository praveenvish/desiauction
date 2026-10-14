import { fixtures, teams, type Db } from "@desiauction/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { assignTeam, transition } from "../competition/registration-aggregate";
import { addClubOnlyPlayer } from "../competition/registrations";
import { authorityKind } from "./authority";
import { representedTeams } from "./trust-ledger";

export class GuestRefusal extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}
const guestInput = z.object({
  teamId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  name: z.string().trim().min(1).max(120),
});
/** Caller owns the tenant transaction; controlled refusals must escape it. */
export async function addScoringGuest(db: Db, fixtureId: string, actorId: string, raw: unknown) {
  const input = guestInput.safeParse(raw);
  if (!input.success)
    return { ok: false as const, error: "bad_payload", message: "Enter the player name and team." };
  const [fixture] = await db
    .select()
    .from(fixtures)
    .where(eq(fixtures.id, fixtureId))
    .for("update");
  if (!fixture) return { ok: false as const, error: "not_found", message: "Match not found." };
  if (!["published", "in_progress"].includes(fixture.status))
    return {
      ok: false as const,
      error: "not_ready",
      message: "This match is not open for players.",
    };
  const authority = await authorityKind(db, actorId, fixture);
  if (!authority)
    return {
      ok: false as const,
      error: "forbidden",
      message: "You cannot add players to this match.",
    };
  if (![fixture.homeTeamId, fixture.awayTeamId].includes(input.data.teamId))
    return {
      ok: false as const,
      error: "wrong_team",
      message: "Choose a team playing this match.",
    };
  // F09: a team's manager (or their handed-over scorer) fills their own side,
  // never the opposition's.
  if (
    authority === "d" &&
    !(await representedTeams(db, fixture, actorId)).includes(input.data.teamId)
  )
    return {
      ok: false as const,
      error: "wrong_team",
      message: "You can add guests only to your own team.",
    };
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      and(
        eq(teams.id, input.data.teamId),
        eq(teams.orgId, fixture.orgId),
        eq(teams.competitionId, fixture.competitionId),
      ),
    );
  if (!team)
    return { ok: false as const, error: "wrong_team", message: "That team is not in this season." };
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext('scoring-guest'), hashtext(${fixture.competitionId}))`,
  );
  const created = await addClubOnlyPlayer(
    db,
    fixture.competitionId,
    fixture.orgId,
    actorId,
    { name: input.data.name, role: "", basePriceBand: null },
    "scorer_guest",
  );
  if (!created.ok)
    throw new GuestRefusal(created.reason, "A player with that name is already in this season.");
  const approved = await transition(
    db,
    fixture.orgId,
    fixture.competitionId,
    created.registrationId,
    actorId,
    { type: "approve" },
    { notifyPlayer: false },
  );
  if (!approved.ok)
    throw new GuestRefusal(
      approved.reason,
      "message" in approved ? approved.message : "This player could not be approved.",
    );
  const assigned = await assignTeam(
    db,
    fixture.orgId,
    fixture.competitionId,
    created.registrationId,
    input.data.teamId,
    actorId,
  );
  if (!assigned.ok)
    throw new GuestRefusal(assigned.reason, "This player could not join that team.");
  return { ok: true as const, registrationId: created.registrationId };
}
