import { NEW_SEASON_SCORING_RULES, formatByKey } from "@desiauction/core/scoring";
import {
  auditLog,
  competitions,
  fixtures,
  franchises,
  grants,
  newId,
  organizations,
  orgMembers,
  people,
  registrations,
  teams,
  withTenantDb,
  type Db,
} from "@desiauction/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { dbHandle } from "../db";
import { scoringDay } from "./home";

const teamName = z.string().trim().min(1).max(120);
export const quickMatchInput = z.object({
  sport: z.enum(["cricket", "box_cricket"]),
  homeName: teamName,
  awayName: teamName,
  formatKey: z.string(),
});

/** The caller supplies the minted org boundary; an existing space is only read here. */
export async function ensurePersonalOrg(db: Db, personId: string, mintedId: string) {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext('personal-org'), hashtext(${personId}))`,
  );
  const [existing] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.createdBy, personId), eq(organizations.kind, "personal")));
  if (existing) return existing.id;
  const [person] = await db
    .select({ name: people.name })
    .from(people)
    .where(eq(people.id, personId));
  if (!person) throw new Error("Sign in to create a match.");
  await db.insert(organizations).values({
    id: mintedId,
    kind: "personal",
    createdBy: personId,
    name: `${person.name?.trim() || "Player"}'s matches`,
    slug: `p-${mintedId.toLowerCase()}`,
  });
  await db.insert(orgMembers).values({ orgId: mintedId, personId });
  await db.insert(grants).values({
    id: newId(),
    personId,
    scopeType: "org",
    scopeId: mintedId,
    capabilitySet: "org:owner",
    grantedBy: personId,
  });
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "org.created",
    scopeType: "org",
    scopeId: mintedId,
    meta: { kind: "personal" },
  });
  return mintedId;
}

async function annualTeam(
  db: Db,
  orgId: string,
  competitionId: string,
  sport: string,
  name: string,
  personId: string,
) {
  const [existing] = await db
    .select()
    .from(teams)
    .where(
      and(eq(teams.orgId, orgId), eq(teams.competitionId, competitionId), eq(teams.name, name)),
    );
  const identities = await db
    .select({ id: franchises.id })
    .from(franchises)
    .innerJoin(teams, eq(teams.franchiseId, franchises.id))
    .innerJoin(competitions, eq(competitions.id, teams.competitionId))
    .where(
      and(
        eq(franchises.orgId, orgId),
        eq(franchises.name, name),
        eq(teams.orgId, orgId),
        eq(competitions.orgId, orgId),
        eq(competitions.sport, sport),
      ),
    );
  const ids = [...new Set(identities.map((row) => row.id))];
  if (ids.length > 1) throw new Error("This team has more than one identity. Choose another name.");
  if (existing) return existing.id;
  const franchiseId = ids[0] ?? newId();
  if (!ids.length)
    await db.insert(franchises).values({ id: franchiseId, orgId, name, createdBy: personId });
  const id = newId();
  await db
    .insert(teams)
    .values({ id, orgId, competitionId, franchiseId, name, createdBy: personId });
  return id;
}

/** A personal-space lock serializes annual identities and fixture sequence allocation. */
export async function createQuickFixture(
  db: Db,
  orgId: string,
  personId: string,
  raw: unknown,
  now = new Date(),
) {
  const input = quickMatchInput.parse(raw);
  if (input.homeName === input.awayName) throw new Error("Choose two different team names.");
  const format = formatByKey(input.formatKey);
  if (!format || (input.sport === "box_cricket") !== input.formatKey.startsWith("box"))
    throw new Error("Choose a format for this sport.");
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('quick-match'), hashtext(${orgId}))`);
  const [org] = await db
    .select()
    .from(organizations)
    .where(
      and(
        eq(organizations.id, orgId),
        eq(organizations.createdBy, personId),
        eq(organizations.kind, "personal"),
      ),
    );
  if (!org) throw new Error("This match space is not yours.");
  const year = scoringDay(now).slice(0, 4),
    name = `Friendlies ${year}`;
  const seasons = await db
    .select()
    .from(competitions)
    .where(
      and(
        eq(competitions.orgId, orgId),
        eq(competitions.sport, input.sport),
        eq(competitions.name, name),
      ),
    );
  if (seasons.length > 1) throw new Error("This year has more than one match season.");
  const competitionId = seasons[0]?.id ?? newId();
  if (!seasons.length) {
    await db.insert(competitions).values({
      id: competitionId,
      orgId,
      sport: input.sport,
      name,
      slug: `p-${competitionId.toLowerCase()}`,
      visibility: "private",
      status: "registration_closed",
      createdBy: personId,
      scoringRules: NEW_SEASON_SCORING_RULES,
      teamFormation: "organizer",
    });
    await db.insert(grants).values({
      id: newId(),
      personId,
      scopeType: "tournament",
      scopeId: competitionId,
      capabilitySet: "fixture:scorer",
      grantedBy: personId,
    });
  }
  const homeTeamId = await annualTeam(
    db,
    orgId,
    competitionId,
    input.sport,
    input.homeName,
    personId,
  );
  const awayTeamId = await annualTeam(
    db,
    orgId,
    competitionId,
    input.sport,
    input.awayName,
    personId,
  );
  const [sequence] = await db
    .select({ n: sql<number>`coalesce(max(${fixtures.seq}), 0)::int` })
    .from(fixtures)
    .where(eq(fixtures.competitionId, competitionId));
  const seq = (sequence?.n ?? 0) + 1,
    fixtureId = newId();
  await db.insert(fixtures).values({
    id: fixtureId,
    orgId,
    competitionId,
    seq,
    fixtureNumber: `FR${year}-${String(seq)}`,
    homeTeamId,
    awayTeamId,
    createdBy: personId,
    status: "published",
    publishedAt: now,
    kickoffAt: `${scoringDay(now)}T${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now)}`,
  });
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "match.quick_created",
    scopeType: "org",
    scopeId: orgId,
    subject: fixtureId,
    meta: { competitionId, formatKey: format.key },
  });
  return { fixtureId, competitionId, homeTeamId, awayTeamId, formatKey: format.key };
}

export async function createQuickMatch(personId: string, raw: unknown) {
  quickMatchInput.parse(raw);
  const mintedId = newId();
  const orgId = await withTenantDb(dbHandle, { personId, orgId: mintedId }, (db) =>
    ensurePersonalOrg(db, personId, mintedId),
  );
  return withTenantDb(dbHandle, { personId, orgId }, (db) =>
    createQuickFixture(db, orgId, personId, raw),
  );
}

/** Explicit previous-registration identity only; names never identify people. */
export async function reuseQuickPlayer(
  db: Db,
  orgId: string,
  personId: string,
  competitionId: string,
  teamId: string,
  previousRegistrationId: string,
) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('quick-match'), hashtext(${orgId}))`);
  const [org] = await db
    .select()
    .from(organizations)
    .where(
      and(
        eq(organizations.id, orgId),
        eq(organizations.createdBy, personId),
        eq(organizations.kind, "personal"),
      ),
    );
  const [team] = await db
    .select()
    .from(teams)
    .where(
      and(eq(teams.id, teamId), eq(teams.orgId, orgId), eq(teams.competitionId, competitionId)),
    );
  const [previous] = await db
    .select()
    .from(registrations)
    .where(and(eq(registrations.id, previousRegistrationId), eq(registrations.orgId, orgId)));
  if (!org || !team || !previous) throw new Error("Choose one of your previous players.");
  const [existing] = await db
    .select()
    .from(registrations)
    .where(
      and(
        eq(registrations.competitionId, competitionId),
        eq(registrations.personId, previous.personId),
      ),
    );
  if (existing) {
    if (existing.teamId !== teamId || existing.status !== "approved")
      throw new Error("This player is already assigned elsewhere in this season.");
    return existing.id;
  }
  const id = newId();
  await db.insert(registrations).values({
    id,
    orgId,
    competitionId,
    teamId,
    personId: previous.personId,
    enteredName: previous.enteredName,
    role: previous.role,
    dateOfBirth: previous.dateOfBirth,
    status: "approved",
    registrationNumber: `P-${id.slice(-8)}`,
  });
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "registration.added",
    scopeType: "org",
    scopeId: orgId,
    subject: id,
    meta: { competitionId, source: "quick_match_previous", previousRegistrationId },
  });
  return id;
}
