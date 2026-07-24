import {
  competitionTransition,
  nextSeasonName,
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
  tournaments,
  teams,
  writeSurvivingConstraint,
  type Db,
} from "@desiauction/db";
import { and, desc, eq } from "drizzle-orm";

import { storage } from "../media";

// Competition + Tournament + Team persistence (IP-3 §4). All rules come from core;
// this module fetches/writes and writes audit. Web actions are the only callers.

export interface TournamentSummary {
  id: string;
  name: string;
  slug: string;
}

export async function createTournament(
  db: Db,
  orgId: string,
  personId: string,
  name: string,
): Promise<TournamentSummary> {
  const valid = validateName(name);
  if (!valid.ok) {
    throw new Error("tournament name must be at least 3 characters");
  }
  const id = newId();
  // ULID suffix keeps the slug unique without a retry loop (competitions pattern).
  const slug = `${slugifyName(valid.value)}-${id.slice(-4).toLowerCase()}`;
  await db.insert(tournaments).values({ id, orgId, name: valid.value, slug, createdBy: personId });
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "tournament.created",
    scopeType: "org",
    scopeId: orgId,
    subject: id,
    meta: { name: valid.value, slug },
  });
  return { id, name: valid.value, slug };
}

export async function tournamentsOf(db: Db, orgId: string): Promise<TournamentSummary[]> {
  return db
    .select({ id: tournaments.id, name: tournaments.name, slug: tournaments.slug })
    .from(tournaments)
    .where(eq(tournaments.orgId, orgId))
    .orderBy(tournaments.name);
}

export interface CompetitionSummary {
  id: string;
  orgId: string;
  /** The recurring tournament this is an edition of; null for a one-off. */
  tournamentId: string | null;
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
  /** The recurring tournament this edition belongs to. */
  tournamentId?: string;
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
    ...(input.tournamentId !== undefined ? { tournamentId: input.tournamentId } : {}),
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
    tournamentId: input.tournamentId ?? null,
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
      tournamentId: competitions.tournamentId,
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
      tournamentId: competitions.tournamentId,
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
  coachName: string | null;
  /** Ready-to-render crest URL (storage key resolved), or null for the fallback. */
  logoUrl: string | null;
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
  // Unique (competition_id, name) — team names are unique within a competition.
  const inserted = await writeSurvivingConstraint(db, (tx) =>
    tx.insert(teams).values({
      id,
      orgId,
      competitionId,
      name: valid.value,
      ...(shortName !== undefined && shortName !== "" ? { shortName } : {}),
      ...(primaryColor !== undefined && primaryColor !== "" ? { primaryColor } : {}),
      createdBy: personId,
    }),
  );
  if (!inserted) {
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
      coachName: null,
      logoUrl: null,
    },
  };
}

export interface CloneResult {
  competition: CompetitionSummary;
  teamsCloned: number;
}

/**
 * Clone a competition into a fresh DRAFT in the same org — the "run it again"
 * retention path (collapses the cost of a second season). Copies identity (name
 * with the season year bumped, location) and the TEAM SHELLS (name / short /
 * colour / coach). Does NOT copy the player pool (no PII — the new season opens
 * fresh registration), fixtures, or auction state; dates reset so the organizer
 * sets the new schedule. Composes the existing audited primitives and emits one
 * `competition.cloned` event.
 */
export async function cloneCompetition(
  db: Db,
  orgId: string,
  personId: string,
  source: CompetitionSummary,
  sourceTeams: TeamSummary[],
): Promise<CloneResult> {
  const competition = await createCompetition(db, orgId, personId, {
    name: nextSeasonName(source.name),
    ...(source.location !== null ? { location: source.location } : {}),
  });
  let teamsCloned = 0;
  for (const team of sourceTeams) {
    const created = await createTeam(
      db,
      orgId,
      competition.id,
      personId,
      team.name,
      team.shortName ?? undefined,
      team.primaryColor ?? undefined,
    );
    if (!created.ok) {
      continue;
    }
    teamsCloned += 1;
    if (team.coachName !== null && team.coachName !== "") {
      await setTeamCoach(db, orgId, competition.id, created.team.id, team.coachName, personId);
    }
  }
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "competition.cloned",
    scopeType: "org",
    scopeId: orgId,
    subject: competition.id,
    meta: { source: source.id, teamsCloned: String(teamsCloned) },
  });
  return { competition, teamsCloned };
}

/** Set (or clear) a team's coach — non-bidding organizer metadata. */
export async function setTeamCoach(
  db: Db,
  orgId: string,
  competitionId: string,
  teamId: string,
  coachName: string | null,
  actorId: string,
): Promise<{ ok: boolean }> {
  const trimmed = coachName === null || coachName.trim() === "" ? null : coachName.trim();
  await db
    .update(teams)
    .set({ coachName: trimmed })
    .where(and(eq(teams.id, teamId), eq(teams.competitionId, competitionId)));
  await db.insert(auditLog).values({
    id: newId(),
    actor: actorId,
    action: "team.coach_set",
    scopeType: "org",
    scopeId: orgId,
    subject: teamId,
    meta: trimmed !== null ? { coachName: trimmed } : {},
  });
  return { ok: true };
}

export async function teamsOf(db: Db, competitionId: string): Promise<TeamSummary[]> {
  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      shortName: teams.shortName,
      primaryColor: teams.primaryColor,
      coachName: teams.coachName,
      logoKey: teams.logoUrl,
    })
    .from(teams)
    .where(eq(teams.competitionId, competitionId))
    .orderBy(desc(teams.createdAt));
  return rows.map(({ logoKey, ...team }) => ({
    ...team,
    logoUrl: logoKey === null ? null : storage.readUrl(logoKey),
  }));
}
