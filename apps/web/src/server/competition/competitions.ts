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
import { and, asc, desc, eq } from "drizzle-orm";

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

/**
 * The editions of ONE tournament, for the tournament page.
 *
 * Scoped in SQL rather than by filtering `competitionsForPerson` in JS: the
 * page renders one tournament, and a person in thirty clubs should not pay to
 * read all thirty. Callers must already have proved org membership — this is a
 * projection, not a gate (the same division `countsFor` works under).
 */
export async function competitionsOfTournament(
  db: Db,
  tournamentId: string,
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
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(eq(competitions.tournamentId, tournamentId));
}

/**
 * Newest EDITION first — by the season's own dates, not by when the row was
 * typed in. An organizer back-filling "BPL 1" after "BPL 3" was getting their
 * editions interleaved by data-entry order, which is the one ordering that
 * carries no meaning on a page whose whole job is "which edition is which".
 *
 * Undated seasons sort last: a season with no dates is being drafted, and a
 * draft should not jump ahead of an edition that has actually been scheduled.
 * `startsOn` is an ISO day string, so a plain string compare is a date compare.
 */
export function byEditionDate<T extends { startsOn: string | null }>(seasons: T[]): T[] {
  return [...seasons].sort((a, b) => {
    if (a.startsOn === b.startsOn) {
      return 0;
    }
    if (a.startsOn === null) {
      return 1;
    }
    if (b.startsOn === null) {
      return -1;
    }
    return a.startsOn < b.startsOn ? 1 : -1;
  });
}

/**
 * The edition running right now — the answer to the question this page exists
 * to answer. Inclusive of both ends, and only ever true for a season that has
 * stated both dates: "started, end unknown" is a guess, not a fact.
 */
export function isRunningNow(
  season: { startsOn: string | null; endsOn: string | null },
  today: string,
): boolean {
  return season.startsOn !== null && season.endsOn !== null
    ? season.startsOn <= today && today <= season.endsOn
    : false;
}

/** Today as an ISO day, in the timezone the season dates are written in (UTC). */
export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
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

/**
 * What must be true before a season may be put on the public internet (DA-12).
 *
 * Publishing used to be a footer control with no gate at all: a season still in
 * `setup`, with nobody registered, published in one click a page that told the
 * public "REGISTRATION CLOSED — the organizer has not approved any players into
 * the pool". The rule is deliberately about the READER's experience, not the
 * organizer's progress: a public page is worth having when it can say when the
 * season is, where it is, and whether you can still enter.
 */
export interface PublishBlocker {
  code: "dates" | "location" | "intake";
  message: string;
}

export function publishBlockers(competition: {
  status: CompetitionStatus;
  startsOn: string | null;
  endsOn: string | null;
  location: string | null;
}): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  if (competition.startsOn === null || competition.endsOn === null) {
    blockers.push({
      code: "dates",
      message: "Add the season dates — the page has nothing to announce.",
    });
  }
  if (competition.location === null || competition.location.trim() === "") {
    blockers.push({
      code: "location",
      message: "Add the location — players need to know where this is.",
    });
  }
  if (competition.status === "draft" || competition.status === "setup") {
    blockers.push({
      code: "intake",
      message:
        "Open registration first — until you do, the public page reads “registration closed”.",
    });
  }
  return blockers;
}

export interface CompetitionDetails {
  name: string;
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
}

export type UpdateDetailsResult =
  | { ok: true; competition: CompetitionSummary }
  | { ok: false; reason: "invalid_name" | "reversed_dates" };

/**
 * DA-11: the season's own identity — its name, its dates, its location — was
 * write-once. Nothing in the product could change a single one of them after
 * the create dialog closed, and because that dialog leaves dates and location
 * OPTIONAL, the default path produced seasons whose only forward control
 * ("Open registration") refused forever, naming three fields no screen could
 * reach. This is the missing writer; the slug is deliberately NOT recomputed,
 * because it is the season's public address and printed registration links.
 */
export async function updateCompetitionDetails(
  db: Db,
  competition: CompetitionSummary,
  personId: string,
  input: CompetitionDetails,
): Promise<UpdateDetailsResult> {
  const valid = validateName(input.name);
  if (!valid.ok) {
    return { ok: false, reason: "invalid_name" };
  }
  if (input.startsOn !== null && input.endsOn !== null && input.endsOn < input.startsOn) {
    return { ok: false, reason: "reversed_dates" };
  }
  const next = {
    name: valid.value,
    location: input.location,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
  };
  await db.update(competitions).set(next).where(eq(competitions.id, competition.id));
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "competition.details_changed",
    scopeType: "org",
    scopeId: competition.orgId,
    subject: competition.id,
    meta: {
      from: {
        name: competition.name,
        location: competition.location,
        startsOn: competition.startsOn,
        endsOn: competition.endsOn,
      },
      to: next,
    },
  });
  return { ok: true, competition: { ...competition, ...next } };
}

/**
 * Publish / unpublish the public page. Audited, because putting a season on the
 * public internet — or taking it back down — is exactly the class of act the
 * audit log exists for; it used to be the one lifecycle-shaped write on this
 * screen that left no trace at all.
 */
export async function setCompetitionVisibility(
  db: Db,
  competition: CompetitionSummary,
  personId: string,
  visibility: "private" | "public",
): Promise<void> {
  await db.update(competitions).set({ visibility }).where(eq(competitions.id, competition.id));
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "competition.visibility_changed",
    scopeType: "org",
    scopeId: competition.orgId,
    subject: competition.id,
    meta: { from: competition.visibility, to: visibility, slug: competition.slug },
  });
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

export type UpdateTeamResult =
  | { ok: true; team: TeamSummary }
  | { ok: false; reason: "invalid_name" | "duplicate_name" | "unknown_team" };

/**
 * DA-35: rename a team, or correct its short name or colour.
 *
 * A team could be created and never touched again — a typo in a franchise name
 * was permanent for the life of the season, on the auction board, the public
 * page and every share card. This edits the three identity fields and nothing
 * else: the team's IDENTITY is editable, its EXISTENCE is not (see DA-07 — the
 * team set is what paddles were issued against and what settlement sealed).
 */
export async function updateTeamDetails(
  db: Db,
  orgId: string,
  competitionId: string,
  teamId: string,
  input: { name: string; shortName: string; primaryColor: string },
  actorId: string,
): Promise<UpdateTeamResult> {
  const valid = validateName(input.name);
  if (!valid.ok) {
    return { ok: false, reason: "invalid_name" };
  }
  const [existing] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.competitionId, competitionId)))
    .limit(1);
  if (existing === undefined) {
    return { ok: false, reason: "unknown_team" };
  }
  const shortName = input.shortName.trim() === "" ? null : input.shortName.trim();
  const primaryColor = input.primaryColor.trim() === "" ? null : input.primaryColor.trim();
  const written = await writeSurvivingConstraint(db, (tx) =>
    tx
      .update(teams)
      .set({ name: valid.value, shortName, primaryColor })
      .where(and(eq(teams.id, teamId), eq(teams.competitionId, competitionId))),
  );
  if (!written) {
    return { ok: false, reason: "duplicate_name" };
  }
  await db.insert(auditLog).values({
    id: newId(),
    actor: actorId,
    action: "team.updated",
    scopeType: "org",
    scopeId: orgId,
    subject: teamId,
    meta: { name: valid.value },
  });
  const [row] = await db
    .select({
      id: teams.id,
      name: teams.name,
      shortName: teams.shortName,
      primaryColor: teams.primaryColor,
      coachName: teams.coachName,
      logoKey: teams.logoUrl,
    })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (row === undefined) {
    return { ok: false, reason: "unknown_team" };
  }
  const { logoKey, ...team } = row;
  return {
    ok: true,
    team: { ...team, logoUrl: logoKey === null ? null : storage.readUrl(logoKey) },
  };
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
    // DA-31: `created_at` alone ties whenever two teams are created in the same
    // millisecond (a seed, an import, two quick clicks), and Postgres is free to
    // return a tied set in any order — the grid reshuffled between loads. The id
    // is a ULID, so it is the creation order and breaks every tie the same way.
    .orderBy(desc(teams.createdAt), asc(teams.id));
  return rows.map(({ logoKey, ...team }) => ({
    ...team,
    logoUrl: logoKey === null ? null : storage.readUrl(logoKey),
  }));
}
