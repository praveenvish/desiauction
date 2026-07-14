"use server";

import {
  isRejectionReason,
  parseRegistrationCsv,
  type CsvRowError,
  type RegistrationEvent,
  type RegistrationStatus,
} from "@desiauction/core";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { db } from "../db";
import { ForbiddenError } from "../orgs/authz";
import { orgsFor } from "../orgs/orgs";
import { canCompetition, requireCompetitionCapability } from "./authz";
import {
  advanceCompetition,
  competitionForRegistration,
  competitionsForPerson,
  createCompetition,
  createTeam,
  resolveCompetition,
  teamsOf,
  type CompetitionSummary,
  type TeamSummary,
} from "./competitions";
import { addNote, assignTeam, transition, transitionBatch } from "./registration-aggregate";
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

export interface CompetitionsView {
  orgs: { id: string; name: string }[];
  competitions: (CompetitionSummary & { orgName: string })[];
}

export async function competitionsView(): Promise<CompetitionsView> {
  const session = await requireSession();
  const [orgs, competitions] = await Promise.all([
    orgsFor(db, session.personId),
    competitionsForPerson(db, session.personId),
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
  const memberships = await orgsFor(db, session.personId);
  if (!memberships.some((o) => o.id === orgId)) {
    return { error: "Choose one of your organizations." };
  }
  let slug: string;
  try {
    await requireCompetitionCapability(db, session.personId, { orgId }, "competition.create");
    const competition = await createCompetition(db, orgId, session.personId, {
      name,
      location,
      startsOn,
      endsOn,
    });
    slug = competition.slug;
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You can't create competitions in this organization." };
    }
    return { error: "Give the competition a name of at least 3 characters." };
  }
  redirect(`/competitions/${slug}`);
}

export interface CompetitionView {
  competition: CompetitionSummary;
  teams: TeamSummary[];
  registrations: RegistrationRow[];
  viewer: { canManage: boolean; canReview: boolean };
}

export async function competitionView(slug: string): Promise<CompetitionView | null> {
  const session = await requireSession();
  const competition = await resolveCompetition(db, session.personId, slug);
  if (competition === null) {
    return null;
  }
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  const [teams, registrations, canManage, canReview] = await Promise.all([
    teamsOf(db, competition.id),
    registrationsOf(db, competition.id),
    canCompetition(db, session.personId, scope, "competition.manage"),
    canCompetition(db, session.personId, scope, "registration.review"),
  ]);
  return { competition, teams, registrations, viewer: { canManage, canReview } };
}

export async function advanceCompetitionAction(
  slug: string,
  to: CompetitionSummary["status"],
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const competition = await resolveCompetition(db, session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    await requireCompetitionCapability(
      db,
      session.personId,
      { orgId: competition.orgId, competitionId: competition.id },
      "competition.manage",
    );
  } catch {
    return { ok: false, error: "You can't manage this competition." };
  }
  const result = await advanceCompetition(db, competition, session.personId, to);
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

export async function createTeamAction(
  slug: string,
  name: string,
  shortName: string,
  primaryColor: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const competition = await resolveCompetition(db, session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    await requireCompetitionCapability(
      db,
      session.personId,
      { orgId: competition.orgId, competitionId: competition.id },
      "team.manage",
    );
  } catch {
    return { ok: false, error: "You can't manage teams here." };
  }
  const result = await createTeam(
    db,
    competition.orgId,
    competition.id,
    session.personId,
    name,
    shortName,
    primaryColor,
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
  const competition = await resolveCompetition(db, session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    // Approval's human gate (invariant 5): only a registration.review holder.
    await requireCompetitionCapability(
      db,
      session.personId,
      { orgId: competition.orgId, competitionId: competition.id },
      "registration.review",
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
  const result = await transition(
    db,
    gate.competition.orgId,
    gate.competition.id,
    registrationId,
    gate.personId,
    event,
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
  const result = await transitionBatch(
    db,
    gate.competition.orgId,
    gate.competition.id,
    registrationIds,
    gate.personId,
    event,
  );
  return { ok: true, applied: result.applied.length, skipped: result.skipped.length };
}

// --- Player-facing registration (any authenticated person) -------------------

export interface RegistrationLanding {
  competitionName: string;
  open: boolean;
  mine: { status: string; role: string } | null;
}

export async function registrationLanding(slug: string): Promise<RegistrationLanding | null> {
  const session = await requireSession();
  const competition = await competitionForRegistration(db, slug);
  if (competition === null) {
    return null;
  }
  const mine = await myRegistration(db, competition.id, session.personId);
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
  const competition = await competitionForRegistration(db, slug);
  if (competition === null) {
    return { error: "This competition is not available." };
  }
  const role = formString(formData, "role");
  const result = await submitRegistration(
    db,
    competition.id,
    competition.orgId,
    session.personId,
    role,
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
  const competition = await resolveCompetition(db, session.personId, slug);
  if (competition === null) {
    return null;
  }
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  const canReview = await canCompetition(db, session.personId, scope, "registration.review");
  const pageNum = Number.parseInt(params.page ?? "1", 10);
  const query = {
    ...(params.search !== undefined && params.search !== "" ? { search: params.search } : {}),
    ...(params.status !== undefined && VALID_STATUS.has(params.status as RegistrationStatus)
      ? { status: params.status as RegistrationStatus }
      : {}),
    ...(params.teamId !== undefined && params.teamId !== "" ? { teamId: params.teamId } : {}),
    sort: (VALID_SORT.has(params.sort as RegistrationSort) ? params.sort : "recent") as RegistrationSort,
    page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
    pageSize: PAGE_SIZE,
  };
  const [stats, page, teams] = await Promise.all([
    registrationStats(db, competition.id),
    queryRegistrations(db, competition.id, query),
    teamsOf(db, competition.id),
  ]);
  return { competition, stats, page, teams, viewer: { canReview } };
}

export async function registrationTimelineAction(
  slug: string,
  registrationId: string,
): Promise<TimelineEntry[]> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return [];
  }
  return timelineOf(db, registrationId);
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
  const result = await addNote(db, gate.competition.orgId, registrationId, gate.personId, note);
  return result.ok ? { ok: true } : { ok: false, error: "Write a note first." };
}

export async function assignTeamAction(
  slug: string,
  registrationId: string,
  teamId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const competition = await resolveCompetition(db, session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    await requireCompetitionCapability(
      db,
      session.personId,
      { orgId: competition.orgId, competitionId: competition.id },
      "team.manage",
    );
  } catch {
    return { ok: false, error: "You can't assign teams here." };
  }
  await assignTeam(
    db,
    competition.orgId,
    competition.id,
    registrationId,
    teamId === "" ? null : teamId,
    session.personId,
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
    return { ok: false, error: `Fix ${String(parsed.errors.length)} row error(s) before importing.` };
  }
  const result = await commitRegistrationImport(
    db,
    gate.competition.id,
    gate.competition.orgId,
    gate.personId,
    parsed.rows,
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
  const csv = await exportRegistrationsCsv(db, gate.competition.id);
  return { ok: true, csv, filename: `${gate.competition.slug}-registrations.csv` };
}
