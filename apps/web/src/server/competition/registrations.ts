import {
  deriveAge,
  isBattingStyle,
  isBowlingStyle,
  isRegistrationRole,
  nameKey,
  registrationNumber,
  type RegistrationStatus,
} from "@desiauction/core";
import {
  auditLog,
  competitions,
  newId,
  people,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";

import { storage } from "../media";

// Registration reads + creation (IP-3 §4, doc 42). STATE TRANSITIONS live only in
// registration-aggregate.ts; this module never writes the `status` column. The
// dashboard queries here are server-driven (search/filter/sort/pagination in SQL)
// so the client never loads the whole dataset (M-IP3-2 performance target).

export type SubmitResult =
  | { ok: true; registrationId: string }
  | { ok: false; reason: "invalid_role" | "not_open" | "duplicate" };

/** Optional self-declared player profile captured at registration (parity §3.2).
 * Each field is validated here; invalid values are dropped, never persisted. */
export interface PlayerProfileInput {
  dateOfBirth?: string;
  battingStyle?: string;
  bowlingStyle?: string;
}

function validProfile(profile: PlayerProfileInput | undefined): Partial<{
  dateOfBirth: string;
  battingStyle: string;
  bowlingStyle: string;
}> {
  if (profile === undefined) {
    return {};
  }
  const out: { dateOfBirth?: string; battingStyle?: string; bowlingStyle?: string } = {};
  if (profile.dateOfBirth !== undefined && deriveAge(profile.dateOfBirth, new Date()) !== null) {
    out.dateOfBirth = profile.dateOfBirth;
  }
  if (profile.battingStyle !== undefined && isBattingStyle(profile.battingStyle)) {
    out.battingStyle = profile.battingStyle;
  }
  if (profile.bowlingStyle !== undefined && isBowlingStyle(profile.bowlingStyle)) {
    out.bowlingStyle = profile.bowlingStyle;
  }
  return out;
}

/**
 * A Person applies to a Competition. Any authenticated person may register while
 * intake is open (they need not be an org member — they are a player, doc 42).
 * Duplicate = same person in the same competition (unique index, invariant).
 */
export async function submitRegistration(
  db: Db,
  competitionId: string,
  orgId: string,
  personId: string,
  role: string,
  basePriceBand?: string,
  profile?: PlayerProfileInput,
): Promise<SubmitResult> {
  if (!isRegistrationRole(role)) {
    return { ok: false, reason: "invalid_role" };
  }
  const [competition] = await db
    .select({ status: competitions.status })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .limit(1);
  if (competition === undefined || competition.status !== "registration_open") {
    return { ok: false, reason: "not_open" };
  }
  const id = newId();
  try {
    await db.insert(registrations).values({
      id,
      orgId,
      competitionId,
      personId,
      role,
      status: "submitted",
      registrationNumber: registrationNumber(id),
      ...(basePriceBand !== undefined && basePriceBand !== "" ? { basePriceBand } : {}),
      ...validProfile(profile),
    });
  } catch {
    return { ok: false, reason: "duplicate" };
  }
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "registration.submitted",
    scopeType: "org",
    scopeId: orgId,
    subject: id,
    meta: { competitionId, role },
  });
  return { ok: true, registrationId: id };
}

export interface RegistrationRow {
  id: string;
  number: string;
  personId: string;
  name: string | null;
  phone: string;
  role: string;
  status: RegistrationStatus;
  teamId: string | null;
  teamName: string | null;
  // Icon (marquee) player: pre-assigned to their team, excluded from the auction.
  isIcon: boolean;
  // Team captain marker (display + team-sheet ordering).
  isCaptain: boolean;
  // Surfaced for the IP-4 AuctionReady pool (additive projection field, M-IP4-1).
  basePriceBand: string | null;
  rejectionReason: string | null;
  duplicateName: boolean;
  // Parity §3.2 profile. photoUrl is DPDP-gated: null unless photo_consent_at is
  // set (render gate, DPDP §5). age is derived from DOB, never stored.
  photoUrl: string | null;
  age: number | null;
  battingStyle: string | null;
  bowlingStyle: string | null;
}

/** Legacy triage list for the M-IP3-1 competition page (latest first, unpaged). */
export async function registrationsOf(db: Db, competitionId: string): Promise<RegistrationRow[]> {
  const query: RegistrationQuery = { page: 1, pageSize: 100, sort: "recent" };
  const { rows } = await queryRegistrations(db, competitionId, query);
  return rows;
}

/** A person's own registration in a competition (their status page seed, doc 42). */
export async function myRegistration(
  db: Db,
  competitionId: string,
  personId: string,
): Promise<{ status: RegistrationStatus; role: string; number: string } | null> {
  const [row] = await db
    .select({
      status: registrations.status,
      role: registrations.role,
      number: registrations.registrationNumber,
    })
    .from(registrations)
    .where(
      and(eq(registrations.competitionId, competitionId), eq(registrations.personId, personId)),
    )
    .limit(1);
  return row ?? null;
}

// --- Dashboard: statistics, search/filter/sort/pagination (M-IP3-2) ----------

export interface RegistrationStats {
  total: number;
  submitted: number;
  approved: number;
  rejected: number;
  waitlisted: number;
  withdrawn: number;
}

export async function registrationStats(db: Db, competitionId: string): Promise<RegistrationStats> {
  const rows = await db
    .select({ status: registrations.status, count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(eq(registrations.competitionId, competitionId))
    .groupBy(registrations.status);
  const stats: RegistrationStats = {
    total: 0,
    submitted: 0,
    approved: 0,
    rejected: 0,
    waitlisted: 0,
    withdrawn: 0,
  };
  for (const row of rows) {
    // Registrations are created in "submitted"; "draft" is a machine-only state
    // that is never persisted here, so it is not a counted bucket.
    if (row.status !== "draft") {
      stats[row.status] = row.count;
    }
    stats.total += row.count;
  }
  return stats;
}

export type RegistrationSort = "recent" | "oldest" | "name" | "number" | "status";

export interface RegistrationQuery {
  search?: string;
  status?: RegistrationStatus;
  teamId?: string;
  sort?: RegistrationSort;
  page: number;
  pageSize: number;
}

export interface RegistrationPage {
  rows: RegistrationRow[];
  total: number; // rows matching the filter (for pagination)
  page: number;
  pageSize: number;
}

const SORTS: Record<RegistrationSort, SQL[]> = {
  recent: [desc(registrations.createdAt), asc(registrations.id)],
  oldest: [asc(registrations.createdAt), asc(registrations.id)],
  name: [asc(people.name), asc(registrations.id)],
  number: [asc(registrations.registrationNumber), asc(registrations.id)],
  status: [asc(registrations.status), asc(registrations.registrationNumber)],
};

/**
 * Deterministic server-driven query. Search matches name / phone / registration
 * number / team name (exact-ish `ILIKE`, no fuzzy). Every sort has a stable
 * tiebreak on id so pagination never drops or repeats a row.
 */
export async function queryRegistrations(
  db: Db,
  competitionId: string,
  query: RegistrationQuery,
): Promise<RegistrationPage> {
  const filters: SQL[] = [eq(registrations.competitionId, competitionId)];
  if (query.status !== undefined) {
    filters.push(eq(registrations.status, query.status));
  }
  if (query.teamId !== undefined && query.teamId !== "") {
    filters.push(eq(registrations.teamId, query.teamId));
  }
  const term = query.search?.trim();
  if (term !== undefined && term !== "") {
    const like = `%${term}%`;
    const clause = or(
      ilike(people.name, like),
      ilike(people.phone, like),
      ilike(registrations.registrationNumber, like),
      ilike(teams.name, like),
    );
    if (clause !== undefined) {
      filters.push(clause);
    }
  }
  const where = and(...filters);

  const pageSize = Math.min(Math.max(query.pageSize, 1), 100);
  const page = Math.max(query.page, 1);
  const order = SORTS[query.sort ?? "recent"];

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    .where(where);
  const total = countRow?.count ?? 0;

  const raw = await db
    .select({
      id: registrations.id,
      number: registrations.registrationNumber,
      personId: registrations.personId,
      name: people.name,
      phone: people.phone,
      role: registrations.role,
      status: registrations.status,
      teamId: registrations.teamId,
      teamName: teams.name,
      isIcon: registrations.isIcon,
      isCaptain: registrations.isCaptain,
      basePriceBand: registrations.basePriceBand,
      rejectionReason: registrations.rejectionReason,
      photoKey: people.photoUrl,
      photoConsentAt: people.photoConsentAt,
      dateOfBirth: registrations.dateOfBirth,
      battingStyle: registrations.battingStyle,
      bowlingStyle: registrations.bowlingStyle,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    .where(where)
    .orderBy(...order)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const dupKeys = await duplicateNameKeys(db, competitionId);
  const now = new Date();
  const rows: RegistrationRow[] = raw.map(
    ({ photoKey, photoConsentAt, dateOfBirth, ...r }) => ({
      ...r,
      duplicateName: dupKeys.has(nameKey(r.name)),
      // DPDP §5 render gate: a stored photo only surfaces with recorded consent.
      photoUrl: photoConsentAt !== null && photoKey !== null ? storage.readUrl(photoKey) : null,
      age: deriveAge(dateOfBirth, now),
    }),
  );
  return { rows, total, page, pageSize };
}

/** Name keys that appear on >1 registration in this competition (dup/conflict flag). */
export async function duplicateNameKeys(db: Db, competitionId: string): Promise<Set<string>> {
  const rows = await db
    .select({ key: sql<string>`lower(btrim(regexp_replace(${people.name}, '\\s+', ' ', 'g')))` })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(and(eq(registrations.competitionId, competitionId), sql`${people.name} is not null`))
    .groupBy(sql`1`)
    .having(sql`count(*) > 1`);
  return new Set(rows.map((r) => r.key));
}

export interface TimelineEntry {
  action: string;
  at: Date;
  meta: unknown;
}

/** A registration's audit timeline (transitions + notes), oldest→newest. */
export async function timelineOf(db: Db, registrationId: string): Promise<TimelineEntry[]> {
  return db
    .select({ action: auditLog.action, at: auditLog.at, meta: auditLog.meta })
    .from(auditLog)
    .where(eq(auditLog.subject, registrationId))
    .orderBy(asc(auditLog.at));
}

/**
 * Deterministic CSV export — stable order (by registration number), competition-
 * scoped by the caller's capability + tenant resolution (no cross-tenant leakage).
 */
export async function exportRegistrationsCsv(db: Db, competitionId: string): Promise<string> {
  const rows = await db
    .select({
      number: registrations.registrationNumber,
      name: people.name,
      phone: people.phone,
      role: registrations.role,
      status: registrations.status,
      team: teams.name,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    .where(eq(registrations.competitionId, competitionId))
    .orderBy(asc(registrations.registrationNumber), asc(registrations.id));
  const header = "registration_number,name,phone,role,status,team";
  const lines = rows.map((r) =>
    [r.number, r.name ?? "", r.phone, r.role, r.status, r.team ?? ""].map(csvCell).join(","),
  );
  return [header, ...lines].join("\n");
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Bulk existence check for a set of ids in a competition (aggregate helper). */
export async function registrationStatuses(
  db: Db,
  competitionId: string,
  ids: readonly string[],
): Promise<{ id: string; status: RegistrationStatus }[]> {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select({ id: registrations.id, status: registrations.status })
    .from(registrations)
    .where(
      and(
        eq(registrations.competitionId, competitionId),
        inArray(registrations.id, ids as string[]),
      ),
    );
}
