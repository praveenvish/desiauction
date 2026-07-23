"use server";

import {
  isRejectionReason,
  parseRegistrationCsv,
  type CsvRowError,
  type RegistrationEvent,
  type RegistrationStatus,
} from "@desiauction/core";
import { competitions, withTenantDb, type Db } from "@desiauction/db";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { dbHandle, systemDb } from "../db";
import { ForbiddenError } from "../orgs/authz";
import { orgsFor } from "../orgs/orgs";
import { canCompetition, requireCompetitionCapability } from "./authz";
import {
  advanceCompetition,
  cloneCompetition,
  competitionForRegistration,
  competitionsForPerson,
  createCompetition,
  createTeam,
  resolveCompetition,
  setTeamCoach,
  teamsOf,
  type CompetitionSummary,
  type TeamSummary,
} from "./competitions";
import {
  addNote,
  assignTeam,
  setRegistrationMarks,
  transition,
  transitionBatch,
} from "./registration-aggregate";
import { commitRegistrationImport } from "./registration-import";
import {
  exportRegistrationsCsv,
  myRegistration,
  queryRegistrations,
  registrationStats,
  registrationsOf,
  submitRegistration,
  timelineOf,
  type RegistrationPage,
  type RegistrationRow,
  type RegistrationSort,
  type RegistrationStats,
  type TimelineEntry,
} from "./registrations";

// Org-scoped internal RPC (C-14, IP-3_DESIGN D1). Every action resolves the
// session, then the tenant, then the capability, then acts — no other path.
//
// PRP-1 §1 tenant wiring: slug resolution and the public registration landing
// are PRE-TENANT reads (competitions carries an org-arm-only policy and the
// resolver's membership join / the landing's open-status gate ARE the scope) —
// they run on the system pool, mirroring the invite-token precedent. Every
// org-scoped read and every write runs inside a withTenantDb boundary whose
// orgId comes from that resolution; player registration paths run under the
// competition's org context, legitimized by the aggregate's open/duplicate
// gates.

async function requireSession() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login");
  }
  return session;
}

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Membership-gated slug → competition (system pool; the join is the gate). */
async function resolveCompetitionScoped(
  personId: string,
  slug: string,
): Promise<CompetitionSummary | null> {
  return resolveCompetition(systemDb, personId, slug);
}

function inCompetitionOrg<T>(
  personId: string,
  competition: { orgId: string },
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  return withTenantDb(dbHandle, { personId, orgId: competition.orgId }, fn);
}

export interface CompetitionsView {
  orgs: { id: string; name: string }[];
  competitions: (CompetitionSummary & { orgName: string })[];
}

export async function competitionsView(): Promise<CompetitionsView> {
  const session = await requireSession();
  const [orgs, competitions] = await Promise.all([
    withTenantDb(dbHandle, { personId: session.personId }, (db) => orgsFor(db, session.personId)),
    // Cross-org union scoped by the membership join — system pool by design.
    competitionsForPerson(systemDb, session.personId),
  ]);
  return { orgs: orgs.map((o) => ({ id: o.id, name: o.name })), competitions };
}

export async function createCompetitionAction(
  _previous: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  const session = await requireSession();
  const orgId = formString(formData, "orgId");
  const name = formString(formData, "name");
  const location = formString(formData, "location");
  const startsOn = formString(formData, "startsOn");
  const endsOn = formString(formData, "endsOn");
  // Membership + capability: only an owner/staff of THIS org may create in it.
  const memberships = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    orgsFor(db, session.personId),
  );
  if (!memberships.some((o) => o.id === orgId)) {
    return { error: "Choose one of your organizations." };
  }
  let slug: string;
  try {
    const competition = await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId },
      async (db) => {
        await requireCompetitionCapability(db, session.personId, { orgId }, "competition.create");
        return createCompetition(db, orgId, session.personId, {
          name,
          location,
          startsOn,
          endsOn,
        });
      },
    );
    slug = competition.slug;
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You can't create competitions in this organization." };
    }
    return { error: "Give the competition a name of at least 3 characters." };
  }
  redirect(`/seasons/${slug}`);
}

export interface CompetitionView {
  competition: CompetitionSummary;
  teams: TeamSummary[];
  registrations: RegistrationRow[];
  viewer: { canManage: boolean; canReview: boolean };
}

export async function competitionView(slug: string): Promise<CompetitionView | null> {
  const session = await requireSession();
  const competition = await resolveCompetitionScoped(session.personId, slug);
  if (competition === null) {
    return null;
  }
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  return inCompetitionOrg(session.personId, competition, async (db) => {
    const [teams, registrations, canManage, canReview] = await Promise.all([
      teamsOf(db, competition.id),
      registrationsOf(db, competition.id),
      canCompetition(db, session.personId, scope, "competition.manage"),
      canCompetition(db, session.personId, scope, "registration.review"),
    ]);
    return { competition, teams, registrations, viewer: { canManage, canReview } };
  });
}

export async function advanceCompetitionAction(
  slug: string,
  to: CompetitionSummary["status"],
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const competition = await resolveCompetitionScoped(session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    await inCompetitionOrg(session.personId, competition, (db) =>
      requireCompetitionCapability(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "competition.manage",
      ),
    );
  } catch {
    return { ok: false, error: "You can't manage this competition." };
  }
  const result = await inCompetitionOrg(session.personId, competition, (db) =>
    advanceCompetition(db, competition, session.personId, to),
  );
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "guard_failed"
          ? "Set a name, dates and location before opening registration."
          : "That step isn't available yet.",
    };
  }
  return { ok: true };
}

// Retention ("run it again"): clone a competition into a fresh draft in the same
// org — team shells + coach carry over, the player pool does NOT (fresh
// registration, no PII copy). Gated by `competition.create` (you are creating a
// new competition), scoped to the source's org.
export async function cloneCompetitionAction(
  sourceSlug: string,
): Promise<{ ok: boolean; slug?: string; error?: string }> {
  const session = await requireSession();
  const source = await resolveCompetitionScoped(session.personId, sourceSlug);
  if (source === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    const result = await inCompetitionOrg(session.personId, source, async (db) => {
      await requireCompetitionCapability(
        db,
        session.personId,
        { orgId: source.orgId, competitionId: source.id },
        "competition.create",
      );
      const teams = await teamsOf(db, source.id);
      return cloneCompetition(db, source.orgId, session.personId, source, teams);
    });
    return { ok: true, slug: result.competition.slug };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You can't create competitions in this organization." };
    }
    return { ok: false, error: "Could not duplicate this competition." };
  }
}

// PX-5: publish/unpublish the public competition page. A thin write to the
// EXISTING visibility column (schema-designed, dormant until now), behind the
// existing competition.manage capability. No new rules: the directory and
// /c/[slug] read this column; nothing else changes.
export async function setCompetitionVisibilityAction(
  slug: string,
  visibility: "private" | "public",
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const competition = await resolveCompetitionScoped(session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    await inCompetitionOrg(session.personId, competition, (db) =>
      requireCompetitionCapability(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "competition.manage",
      ),
    );
  } catch {
    return { ok: false, error: "You can't manage this competition." };
  }
  await inCompetitionOrg(session.personId, competition, (db) =>
    db.update(competitions).set({ visibility }).where(eq(competitions.id, competition.id)),
  );
  return { ok: true };
}

export async function createTeamAction(
  slug: string,
  name: string,
  shortName: string,
  primaryColor: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const competition = await resolveCompetitionScoped(session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    await inCompetitionOrg(session.personId, competition, (db) =>
      requireCompetitionCapability(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "team.manage",
      ),
    );
  } catch {
    return { ok: false, error: "You can't manage teams here." };
  }
  const result = await inCompetitionOrg(session.personId, competition, (db) =>
    createTeam(
      db,
      competition.orgId,
      competition.id,
      session.personId,
      name,
      shortName,
      primaryColor,
    ),
  );
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "duplicate_name"
          ? "A team with that name already exists in this competition."
          : "Give the team a name of at least 3 characters.",
    };
  }
  return { ok: true };
}

export type TriageAction = "approve" | "reject" | "waitlist" | "restore" | "withdraw";

/**
 * Resolve tenant + require registration.review, then build the core event. The
 * ONE gate every triage path (single + bulk) passes; the aggregate does the write.
 */
async function reviewGate(
  slug: string,
): Promise<
  { ok: true; personId: string; competition: CompetitionSummary } | { ok: false; error: string }
> {
  const session = await requireSession();
  const competition = await resolveCompetitionScoped(session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    // Approval's human gate (invariant 5): only a registration.review holder.
    await inCompetitionOrg(session.personId, competition, (db) =>
      requireCompetitionCapability(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "registration.review",
      ),
    );
  } catch {
    return { ok: false, error: "You can't review registrations here." };
  }
  return { ok: true, personId: session.personId, competition };
}

function triageEvent(action: TriageAction, reason?: string): RegistrationEvent | { error: string } {
  if (action === "reject") {
    if (reason === undefined || !isRejectionReason(reason)) {
      return { error: "Choose a reason to reject." };
    }
    return { type: "reject", reason };
  }
  return { type: action };
}

export async function triageRegistrationAction(
  slug: string,
  registrationId: string,
  action: TriageAction,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const event = triageEvent(action, reason);
  if ("error" in event) {
    return { ok: false, error: event.error };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    transition(
      db,
      gate.competition.orgId,
      gate.competition.id,
      registrationId,
      gate.personId,
      event,
    ),
  );
  if (!result.ok) {
    return { ok: false, error: "That action isn't available for this registration." };
  }
  return { ok: true };
}

/** Bulk triage — same review gate, same core event, applied atomically (identical to N singles). */
export async function bulkTriageAction(
  slug: string,
  registrationIds: string[],
  action: TriageAction,
  reason?: string,
): Promise<{ ok: boolean; applied?: number; skipped?: number; error?: string }> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const event = triageEvent(action, reason);
  if ("error" in event) {
    return { ok: false, error: event.error };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    transitionBatch(
      db,
      gate.competition.orgId,
      gate.competition.id,
      registrationIds,
      gate.personId,
      event,
    ),
  );
  return { ok: true, applied: result.applied.length, skipped: result.skipped.length };
}

// --- Player-facing registration (any authenticated person) -------------------

export interface RegistrationLanding {
  competitionName: string;
  open: boolean;
  // PX-5: the number is the player's human-quotable reference on the status view.
  mine: { status: string; role: string; number: string } | null;
}

export async function registrationLanding(slug: string): Promise<RegistrationLanding | null> {
  const session = await requireSession();
  // Public landing lookup (documented no-membership read) — system pool.
  const competition = await competitionForRegistration(systemDb, slug);
  if (competition === null) {
    return null;
  }
  // Own-registration read rides the person arm of the registrations policy.
  const mine = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    myRegistration(db, competition.id, session.personId),
  );
  return {
    competitionName: competition.name,
    open: competition.status === "registration_open",
    mine,
  };
}

export async function submitRegistrationAction(
  slug: string,
  _previous: { error?: string; done?: boolean },
  formData: FormData,
): Promise<{ error?: string; done?: boolean }> {
  const session = await requireSession();
  const competition = await competitionForRegistration(systemDb, slug);
  if (competition === null) {
    return { error: "This competition is not available." };
  }
  const role = formString(formData, "role");
  const profile = {
    dateOfBirth: formString(formData, "dateOfBirth"),
    battingStyle: formString(formData, "battingStyle"),
    bowlingStyle: formString(formData, "bowlingStyle"),
  };
  const source = formString(formData, "source");
  const result = await withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: competition.orgId },
    (db) =>
      submitRegistration(
        db,
        competition.id,
        competition.orgId,
        session.personId,
        role,
        undefined,
        profile,
        source,
      ),
  );
  if (!result.ok) {
    return {
      error:
        result.reason === "not_open"
          ? "Registration for this competition is not open."
          : result.reason === "duplicate"
            ? "You've already registered for this competition — check your status."
            : "Choose a valid playing role.",
    };
  }
  return { done: true };
}

// --- Registration operations dashboard (M-IP3-2) -----------------------------

export interface DashboardParams {
  search?: string;
  status?: string;
  teamId?: string;
  sort?: string;
  page?: string;
}

export interface RegistrationDashboard {
  competition: CompetitionSummary;
  stats: RegistrationStats;
  page: RegistrationPage;
  teams: TeamSummary[];
  viewer: { canReview: boolean };
}

const VALID_STATUS = new Set<RegistrationStatus>([
  "submitted",
  "approved",
  "rejected",
  "waitlisted",
  "withdrawn",
]);
const VALID_SORT = new Set<RegistrationSort>(["recent", "oldest", "name", "number", "status"]);
const PAGE_SIZE = 25;

export async function registrationDashboard(
  slug: string,
  params: DashboardParams,
): Promise<RegistrationDashboard | null> {
  const session = await requireSession();
  const competition = await resolveCompetitionScoped(session.personId, slug);
  if (competition === null) {
    return null;
  }
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  const pageNum = Number.parseInt(params.page ?? "1", 10);
  const query = {
    ...(params.search !== undefined && params.search !== "" ? { search: params.search } : {}),
    ...(params.status !== undefined && VALID_STATUS.has(params.status as RegistrationStatus)
      ? { status: params.status as RegistrationStatus }
      : {}),
    ...(params.teamId !== undefined && params.teamId !== "" ? { teamId: params.teamId } : {}),
    sort: (VALID_SORT.has(params.sort as RegistrationSort)
      ? params.sort
      : "recent") as RegistrationSort,
    page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
    pageSize: PAGE_SIZE,
  };
  return inCompetitionOrg(session.personId, competition, async (db) => {
    const [canReview, stats, page, teams] = await Promise.all([
      canCompetition(db, session.personId, scope, "registration.review"),
      registrationStats(db, competition.id),
      queryRegistrations(db, competition.id, query),
      teamsOf(db, competition.id),
    ]);
    return { competition, stats, page, teams, viewer: { canReview } };
  });
}

export async function registrationTimelineAction(
  slug: string,
  registrationId: string,
): Promise<TimelineEntry[]> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return [];
  }
  return inCompetitionOrg(gate.personId, gate.competition, (db) => timelineOf(db, registrationId));
}

export async function addNoteAction(
  slug: string,
  registrationId: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    addNote(db, gate.competition.orgId, registrationId, gate.personId, note),
  );
  return result.ok ? { ok: true } : { ok: false, error: "Write a note first." };
}

export async function assignTeamAction(
  slug: string,
  registrationId: string,
  teamId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const competition = await resolveCompetitionScoped(session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    await inCompetitionOrg(session.personId, competition, (db) =>
      requireCompetitionCapability(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "team.manage",
      ),
    );
  } catch {
    return { ok: false, error: "You can't assign teams here." };
  }
  await inCompetitionOrg(session.personId, competition, (db) =>
    assignTeam(
      db,
      competition.orgId,
      competition.id,
      registrationId,
      teamId === "" ? null : teamId,
      session.personId,
    ),
  );
  return { ok: true };
}

/**
 * Set icon / captain / team marks on a registration (organizer, `team.manage`).
 * Icon players are retained to their team and excluded from the auction pool.
 */
export async function markRegistrationAction(
  slug: string,
  registrationId: string,
  marks: { isIcon?: boolean; isCaptain?: boolean; teamId?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const competition = await resolveCompetitionScoped(session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    await inCompetitionOrg(session.personId, competition, (db) =>
      requireCompetitionCapability(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "team.manage",
      ),
    );
  } catch {
    return { ok: false, error: "You can't manage players here." };
  }
  await inCompetitionOrg(session.personId, competition, (db) =>
    setRegistrationMarks(
      db,
      competition.orgId,
      competition.id,
      registrationId,
      marks,
      session.personId,
    ),
  );
  return { ok: true };
}

/** Set (or clear) a team's coach (organizer, `team.manage`). */
export async function setTeamCoachAction(
  slug: string,
  teamId: string,
  coachName: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const competition = await resolveCompetitionScoped(session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    await inCompetitionOrg(session.personId, competition, (db) =>
      requireCompetitionCapability(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "team.manage",
      ),
    );
  } catch {
    return { ok: false, error: "You can't manage teams here." };
  }
  await inCompetitionOrg(session.personId, competition, (db) =>
    setTeamCoach(db, competition.orgId, competition.id, teamId, coachName, session.personId),
  );
  return { ok: true };
}

// --- CSV import (validate → preview → commit) + export -----------------------

export interface ImportPreview {
  validCount: number;
  errors: CsvRowError[];
}

/** Validate only — no writes. The organizer previews errors before committing. */
export async function importPreviewAction(slug: string, csv: string): Promise<ImportPreview> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { validCount: 0, errors: [{ line: 1, message: gate.error }] };
  }
  const result = parseRegistrationCsv(csv);
  return { validCount: result.rows.length, errors: result.errors };
}

/** Re-validate and commit atomically. Refuses any file with errors (no partial corruption). */
export async function importCommitAction(
  slug: string,
  csv: string,
): Promise<{ ok: boolean; imported?: number; duplicates?: number; error?: string }> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const parsed = parseRegistrationCsv(csv);
  if (parsed.errors.length > 0) {
    return {
      ok: false,
      error: `Fix ${String(parsed.errors.length)} row error(s) before importing.`,
    };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    commitRegistrationImport(
      db,
      gate.competition.id,
      gate.competition.orgId,
      gate.personId,
      parsed.rows,
    ),
  );
  return { ok: true, imported: result.imported, duplicates: result.duplicates };
}

/** Export authorization = registration.review; deterministic, competition-scoped CSV. */
export async function exportRegistrationsAction(
  slug: string,
): Promise<{ ok: true; csv: string; filename: string } | { ok: false; error: string }> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const csv = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    exportRegistrationsCsv(db, gate.competition.id),
  );
  return { ok: true, csv, filename: `${gate.competition.slug}-registrations.csv` };
}
