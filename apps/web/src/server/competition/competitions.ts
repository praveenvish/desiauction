import {
  competitionTransition,
  slugifyName,
  validateName,
  type CompetitionStatus,
} from "@desiauction/core";
import {
  auditLog,
  competitions,
  newId,
  organizations,
  orgMembers,
  seasons,
  teams,
  type Db,
} from "@desiauction/db";
import { and, desc, eq } from "drizzle-orm";

// Competition + Season + Team persistence (IP-3 §4). All rules come from core;
// this module fetches/writes and writes audit. Web actions are the only callers.

export interface SeasonSummary {
  id: string;
  name: string;
  year: number;
}

export async function createSeason(
  db: Db,
  orgId: string,
  personId: string,
  name: string,
  year: number,
): Promise<SeasonSummary> {
  const valid = validateName(name);
  if (!valid.ok) {
    throw new Error("season name must be at least 3 characters");
  }
  const id = newId();
  await db.insert(seasons).values({ id, orgId, name: valid.value, year, createdBy: personId });
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "season.created",
    scopeType: "org",
    scopeId: orgId,
    subject: id,
    meta: { name: valid.value, year: String(year) },
  });
  return { id, name: valid.value, year };
}

export async function seasonsOf(db: Db, orgId: string): Promise<SeasonSummary[]> {
  return db
    .select({ id: seasons.id, name: seasons.name, year: seasons.year })
    .from(seasons)
    .where(eq(seasons.orgId, orgId))
    .orderBy(desc(seasons.year));
}

export interface CompetitionSummary {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  status: CompetitionStatus;
  // PX-5: the public-page switch (existing column, now surfaced).
  visibility: "private" | "public";
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
}

export interface NewCompetition {
  name: string;
  seasonId?: string;
  location?: string;
  startsOn?: string;
  endsOn?: string;
}

export async function createCompetition(
  db: Db,
  orgId: string,
  personId: string,
  input: NewCompetition,
): Promise<CompetitionSummary> {
  const valid = validateName(input.name);
  if (!valid.ok) {
    throw new Error("competition name must be at least 3 characters");
  }
  const id = newId();
  // ULID suffix keeps the slug unique without a retry loop (orgs pattern).
  const slug = `${slugifyName(valid.value)}-${id.slice(-4).toLowerCase()}`;
  await db.insert(competitions).values({
    id,
    orgId,
    name: valid.value,
    slug,
    ...(input.seasonId !== undefined ? { seasonId: input.seasonId } : {}),
    ...(input.location !== undefined && input.location !== "" ? { location: input.location } : {}),
    ...(input.startsOn !== undefined && input.startsOn !== "" ? { startsOn: input.startsOn } : {}),
    ...(input.endsOn !== undefined && input.endsOn !== "" ? { endsOn: input.endsOn } : {}),
    createdBy: personId,
  });
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "competition.created",
    scopeType: "org",
    scopeId: orgId,
    subject: id,
    meta: { name: valid.value, slug },
  });
  return {
    id,
    orgId,
    name: valid.value,
    slug,
    status: "draft",
    visibility: "private",
    location: input.location ?? null,
    startsOn: input.startsOn ?? null,
    endsOn: input.endsOn ?? null,
  };
}

/** Competitions across every org the person belongs to (their organizer surface). */
export async function competitionsForPerson(
  db: Db,
  personId: string,
): Promise<(CompetitionSummary & { orgName: string })[]> {
  return db
    .select({
      id: competitions.id,
      orgId: competitions.orgId,
      name: competitions.name,
      slug: competitions.slug,
      status: competitions.status,
      visibility: competitions.visibility,
      location: competitions.location,
      startsOn: competitions.startsOn,
      endsOn: competitions.endsOn,
      orgName: organizations.name,
    })
    .from(competitions)
    .innerJoin(orgMembers, eq(orgMembers.orgId, competitions.orgId))
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(eq(orgMembers.personId, personId))
    .orderBy(desc(competitions.createdAt));
}

/** Membership-gated resolution (mirrors resolveTenant): non-members get null. */
export async function resolveCompetition(
  db: Db,
  personId: string,
  slug: string,
): Promise<CompetitionSummary | null> {
  const [row] = await db
    .select({
      id: competitions.id,
      orgId: competitions.orgId,
      name: competitions.name,
      slug: competitions.slug,
      status: competitions.status,
      visibility: competitions.visibility,
      location: competitions.location,
      startsOn: competitions.startsOn,
      endsOn: competitions.endsOn,
    })
    .from(competitions)
    .innerJoin(
      orgMembers,
      and(eq(orgMembers.orgId, competitions.orgId), eq(orgMembers.personId, personId)),
    )
    .where(eq(competitions.slug, slug))
    .limit(1);
  return row ?? null;
}

/** Public lookup by slug for the registration link (no membership needed). */
export async function competitionForRegistration(
  db: Db,
  slug: string,
): Promise<{ id: string; orgId: string; name: string; status: CompetitionStatus } | null> {
  const [row] = await db
    .select({
      id: competitions.id,
      orgId: competitions.orgId,
      name: competitions.name,
      status: competitions.status,
    })
    .from(competitions)
    .where(eq(competitions.slug, slug))
    .limit(1);
  return row ?? null;
}

export type AdvanceResult =
  | { ok: true; status: CompetitionStatus }
  | { ok: false; reason: "illegal_transition" | "guard_failed" };

/**
 * Advance a competition's lifecycle. The decision is core's pure machine; the
 * guard for Setup→RegistrationOpen consults the competition's own fields (doc 44).
 */
export async function advanceCompetition(
  db: Db,
  competition: CompetitionSummary,
  personId: string,
  to: CompetitionStatus,
): Promise<AdvanceResult> {
  const decision = competitionTransition(competition.status, to, {
    hasName: competition.name.trim().length >= 3,
    hasDates: competition.startsOn !== null && competition.endsOn !== null,
    hasLocation: competition.location !== null,
  });
  if (!decision.ok) {
    return decision;
  }
  await db.update(competitions).set({ status: to }).where(eq(competitions.id, competition.id));
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "competition.status_changed",
    scopeType: "org",
    scopeId: competition.orgId,
    subject: competition.id,
    meta: { from: competition.status, to },
  });
  return { ok: true, status: to };
}

export interface TeamSummary {
  id: string;
  name: string;
  shortName: string | null;
  primaryColor: string | null;
}

export type CreateTeamResult =
  { ok: true; team: TeamSummary } | { ok: false; reason: "invalid_name" | "duplicate_name" };

export async function createTeam(
  db: Db,
  orgId: string,
  competitionId: string,
  personId: string,
  name: string,
  shortName?: string,
  primaryColor?: string,
): Promise<CreateTeamResult> {
  const valid = validateName(name);
  if (!valid.ok) {
    return { ok: false, reason: "invalid_name" };
  }
  const id = newId();
  try {
    await db.insert(teams).values({
      id,
      orgId,
      competitionId,
      name: valid.value,
      ...(shortName !== undefined && shortName !== "" ? { shortName } : {}),
      ...(primaryColor !== undefined && primaryColor !== "" ? { primaryColor } : {}),
      createdBy: personId,
    });
  } catch {
    // Unique (competition_id, name) — team names are unique within a competition.
    return { ok: false, reason: "duplicate_name" };
  }
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "team.created",
    scopeType: "org",
    scopeId: orgId,
    subject: id,
    meta: { competitionId, name: valid.value },
  });
  return {
    ok: true,
    team: {
      id,
      name: valid.value,
      shortName: shortName ?? null,
      primaryColor: primaryColor ?? null,
    },
  };
}

export async function teamsOf(db: Db, competitionId: string): Promise<TeamSummary[]> {
  return db
    .select({
      id: teams.id,
      name: teams.name,
      shortName: teams.shortName,
      primaryColor: teams.primaryColor,
    })
    .from(teams)
    .where(eq(teams.competitionId, competitionId))
    .orderBy(desc(teams.createdAt));
}
