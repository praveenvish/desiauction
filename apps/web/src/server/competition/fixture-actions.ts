"use server";

import { parseFixtureCsv, type Conflict, type FixtureStatus } from "@desiauction/core";
import { withTenantDb, type Db } from "@desiauction/db";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { dbHandle, systemDb } from "../db";
import { can } from "../orgs/authz";
import { resolveTenant } from "../orgs/orgs";
import { canCompetition, requireCompetitionCapability } from "./authz";
import {
  resolveCompetition,
  teamsOf,
  type CompetitionSummary,
  type TeamSummary,
} from "./competitions";
import {
  cancelFixture,
  completeFixture,
  competitionConflicts,
  createFixture,
  editFixture,
  generateFixtures,
  publishAllScheduled,
  publishFixture,
  rescheduleFixture,
  scheduleAllDrafts,
  scheduleFixture,
  startFixture,
  type FixtureMutationResult,
  type FixturePatch,
  type GenerateInput,
  type ManualFixtureInput,
} from "./fixture-aggregate";
import { commitFixtureImport, unknownImportNames } from "./fixture-import";
import {
  calendarRange,
  competitionTimeline,
  fixtureStats,
  fixtureTimeline,
  matchDay,
  nowWallClock,
  organizerSchedule,
  queryFixtures,
  upcomingFixtures,
  weekView,
  type CalendarDay,
  type FixturePage,
  type FixtureSnapshot,
  type FixtureSort,
  type FixtureStats,
  type FixtureTimelineEntry,
  type MatchDayGround,
  type OrganizerFixture,
} from "./fixtures";
import { scheduleSnapshot, serializeScheduleCsv } from "./schedule-snapshot";
import {
  activeGroundsOf,
  createGround,
  createVenue,
  setGroundStatus,
  venuesOf,
  type GroundOption,
  type VenueSummary,
} from "./venues";

// Fixtures & venues internal RPC (M-IP3-3). The one gate pattern: session →
// tenant → capability → aggregate. Routes never touch scheduling rules — every
// decision is core's; every mutation is the FixtureAggregate's.
//
// PRP-1 §1 tenant wiring: slug resolution runs on the system pool (the
// membership join is the gate — competitions carries an org-arm-only policy);
// gated work runs inside withTenantDb boundaries. The cross-org organizer
// schedule strip is a membership-joined union and stays on the system pool.

async function requireSession() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login");
  }
  return session;
}

function inCompetitionOrg<T>(
  personId: string,
  competition: { orgId: string },
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  return withTenantDb(dbHandle, { personId, orgId: competition.orgId }, fn);
}

/** Resolve competition + require fixture.manage — every fixture mutation's gate. */
async function fixtureGate(
  slug: string,
): Promise<
  { ok: true; personId: string; competition: CompetitionSummary } | { ok: false; error: string }
> {
  const session = await requireSession();
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    await inCompetitionOrg(session.personId, competition, (db) =>
      requireCompetitionCapability(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "fixture.manage",
      ),
    );
  } catch {
    return { ok: false, error: "You can't manage fixtures here." };
  }
  return { ok: true, personId: session.personId, competition };
}

function conflictMessages(conflicts: Conflict[]): string {
  const first = conflicts[0];
  const head = first === undefined ? "Scheduling conflict." : first.detail;
  return conflicts.length > 1 ? `${head} (+${String(conflicts.length - 1)} more)` : head;
}

function mutationError(result: Exclude<FixtureMutationResult, { ok: true }>): string {
  switch (result.reason) {
    case "conflicts":
      return conflictMessages(result.conflicts);
    case "not_found":
      return "That fixture is not available.";
    case "guard_failed":
      return "Set a kickoff and a ground first.";
    case "invalid_input":
      return "Check the kickoff and duration.";
    case "illegal_transition":
      return "That step isn't available for this fixture.";
  }
}

// --- Venue management (org-scoped) ---------------------------------------------

export interface VenuesView {
  org: { id: string; name: string; slug: string };
  venues: VenueSummary[];
  viewer: { canManage: boolean };
}

export async function venuesView(orgSlug: string): Promise<VenuesView | null> {
  const session = await requireSession();
  const org = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    resolveTenant(db, session.personId, orgSlug),
  );
  if (org === null) {
    return null;
  }
  return withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, async (db) => {
    const [list, canManage] = await Promise.all([
      venuesOf(db, org.id),
      can(db, session.personId, { scopeType: "org", scopeId: org.id }, "venue.manage"),
    ]);
    return { org, venues: list, viewer: { canManage } };
  });
}

async function venueGate(
  orgSlug: string,
): Promise<{ ok: true; personId: string; orgId: string } | { ok: false; error: string }> {
  const session = await requireSession();
  const org = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    resolveTenant(db, session.personId, orgSlug),
  );
  if (org === null) {
    return { ok: false, error: "Not available." };
  }
  const allowed = await withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: org.id },
    (db) => can(db, session.personId, { scopeType: "org", scopeId: org.id }, "venue.manage"),
  );
  if (!allowed) {
    return { ok: false, error: "You can't manage venues here." };
  }
  return { ok: true, personId: session.personId, orgId: org.id };
}

function inOrg<T>(personId: string, orgId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return withTenantDb(dbHandle, { personId, orgId }, fn);
}

export async function createVenueAction(
  orgSlug: string,
  name: string,
  address: string,
  city: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await venueGate(orgSlug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const result = await inOrg(gate.personId, gate.orgId, (db) =>
    createVenue(db, gate.orgId, gate.personId, name, address, city),
  );
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "duplicate_name"
          ? "A venue with that name already exists."
          : "Give the venue a name of at least 3 characters.",
    };
  }
  return { ok: true };
}

export async function createGroundAction(
  orgSlug: string,
  venueId: string,
  input: {
    name: string;
    surface: string;
    capacity?: number;
    floodlights: boolean;
    indoor: boolean;
  },
): Promise<{ ok: boolean; error?: string }> {
  const gate = await venueGate(orgSlug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const result = await inOrg(gate.personId, gate.orgId, (db) =>
    createGround(db, gate.orgId, venueId, gate.personId, input),
  );
  if (!result.ok) {
    const message = {
      invalid_name: "Give the ground a name of at least 3 characters.",
      duplicate_name: "A ground with that name already exists at this venue.",
      invalid_surface: "Choose a valid surface.",
      venue_not_found: "That venue is not available.",
    }[result.reason];
    return { ok: false, error: message };
  }
  return { ok: true };
}

export async function setGroundStatusAction(
  orgSlug: string,
  groundId: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await venueGate(orgSlug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const result = await inOrg(gate.personId, gate.orgId, (db) =>
    setGroundStatus(db, gate.orgId, groundId, gate.personId, status),
  );
  return result.ok ? { ok: true } : { ok: false, error: "Could not update the ground." };
}

// --- Fixtures dashboard (server-driven) -------------------------------------------

export interface FixtureDashboardParams {
  status?: string;
  team?: string;
  ground?: string;
  q?: string;
  sort?: string;
  page?: string;
}

export interface FixtureDashboard {
  competition: CompetitionSummary;
  stats: FixtureStats;
  page: FixturePage;
  teams: TeamSummary[];
  grounds: GroundOption[];
  conflicts: Conflict[];
  viewer: { canManage: boolean };
}

const VALID_STATUS = new Set<FixtureStatus>([
  "draft",
  "scheduled",
  "published",
  "in_progress",
  "completed",
  "cancelled",
]);
const VALID_SORT = new Set<FixtureSort>(["kickoff", "kickoff_desc", "number", "round"]);
const PAGE_SIZE = 25;

export async function fixtureDashboard(
  slug: string,
  params: FixtureDashboardParams,
): Promise<FixtureDashboard | null> {
  const session = await requireSession();
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return null;
  }
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  const pageNum = Number.parseInt(params.page ?? "1", 10);
  return inCompetitionOrg(session.personId, competition, async (db) => {
    const [canManage, stats, page, teamList, groundList, conflicts] = await Promise.all([
      canCompetition(db, session.personId, scope, "fixture.manage"),
      fixtureStats(db, competition.id),
      queryFixtures(db, competition.id, {
        ...(params.status !== undefined && VALID_STATUS.has(params.status as FixtureStatus)
          ? { status: params.status as FixtureStatus }
          : {}),
        ...(params.team !== undefined && params.team !== "" ? { teamId: params.team } : {}),
        ...(params.ground !== undefined && params.ground !== "" ? { groundId: params.ground } : {}),
        ...(params.q !== undefined && params.q !== "" ? { search: params.q } : {}),
        sort: (VALID_SORT.has(params.sort as FixtureSort) ? params.sort : "kickoff") as FixtureSort,
        page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
        pageSize: PAGE_SIZE,
      }),
      teamsOf(db, competition.id),
      activeGroundsOf(db, competition.orgId),
      competitionConflicts(db, competition),
    ]);
    return {
      competition,
      stats,
      page,
      teams: teamList,
      grounds: groundList,
      conflicts,
      viewer: { canManage },
    };
  });
}

// --- Aggregate operations (thin, gated pass-throughs) --------------------------------

export async function generateFixturesAction(
  slug: string,
  input: GenerateInput,
): Promise<{ ok: boolean; created?: number; error?: string }> {
  const gate = await fixtureGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    generateFixtures(db, gate.competition, gate.personId, input),
  );
  if (!result.ok) {
    if (result.reason === "conflicts") {
      return { ok: false, error: conflictMessages(result.conflicts) };
    }
    const message: Record<string, string> = {
      fixtures_exist: "Fixtures already exist — cancel them before regenerating.",
      too_few_teams: "Add at least 2 teams first.",
      duplicate_team: "Team list has a duplicate.",
      no_grounds: "Pick at least one ground.",
      unknown_ground: "Pick grounds that belong to this organization.",
      invalid_start_date: "Pick a valid start date.",
      invalid_kickoff_times: "Kickoff times must be HH:MM.",
      invalid_duration: "Duration must be 1–1440 minutes.",
    };
    return { ok: false, error: message[result.reason] ?? "Could not generate." };
  }
  return { ok: true, created: result.created };
}

export async function createFixtureAction(
  slug: string,
  input: ManualFixtureInput,
): Promise<{ ok: boolean; number?: string; error?: string }> {
  const gate = await fixtureGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    createFixture(db, gate.competition, gate.personId, input),
  );
  if (!result.ok) {
    const message = {
      invalid_input: "Check the teams, kickoff and duration.",
      unknown_team: "Pick two teams from this competition.",
      unknown_ground: "Pick a ground from this organization.",
    }[result.reason];
    return { ok: false, error: message };
  }
  return { ok: true, number: result.number };
}

export type FixtureLifecycleAction = "schedule" | "publish" | "start" | "complete" | "cancel";

export async function fixtureLifecycleAction(
  slug: string,
  fixtureId: string,
  action: FixtureLifecycleAction,
  cancelReason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await fixtureGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const { competition, personId } = gate;
  const result: FixtureMutationResult = await inCompetitionOrg(personId, competition, (db) =>
    ({
      schedule: () => scheduleFixture(db, competition, fixtureId, personId),
      publish: () => publishFixture(db, competition, fixtureId, personId),
      start: () => startFixture(db, competition, fixtureId, personId),
      complete: () => completeFixture(db, competition, fixtureId, personId),
      cancel: () => cancelFixture(db, competition, fixtureId, personId, cancelReason),
    })[action](),
  );
  return result.ok ? { ok: true } : { ok: false, error: mutationError(result) };
}

export async function editFixtureAction(
  slug: string,
  fixtureId: string,
  patch: FixturePatch,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await fixtureGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    editFixture(db, gate.competition, fixtureId, gate.personId, patch),
  );
  return result.ok ? { ok: true } : { ok: false, error: mutationError(result) };
}

export async function rescheduleFixtureAction(
  slug: string,
  fixtureId: string,
  patch: FixturePatch,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await fixtureGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    rescheduleFixture(db, gate.competition, fixtureId, gate.personId, patch),
  );
  return result.ok ? { ok: true } : { ok: false, error: mutationError(result) };
}

export async function scheduleAllAction(
  slug: string,
): Promise<{ ok: boolean; applied?: number; skipped?: number; error?: string }> {
  const gate = await fixtureGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    scheduleAllDrafts(db, gate.competition, gate.personId),
  );
  return { ok: true, ...result };
}

export async function publishAllAction(
  slug: string,
): Promise<{ ok: boolean; applied?: number; skipped?: number; error?: string }> {
  const gate = await fixtureGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    publishAllScheduled(db, gate.competition, gate.personId),
  );
  return { ok: true, ...result };
}

export async function fixtureTimelineAction(
  slug: string,
  fixtureId: string,
): Promise<FixtureTimelineEntry[]> {
  const gate = await fixtureGate(slug);
  if (!gate.ok) {
    return [];
  }
  return inCompetitionOrg(gate.personId, gate.competition, (db) => fixtureTimeline(db, fixtureId));
}

// --- Calendar / timeline / match-day views -------------------------------------------

export interface CalendarView {
  competition: CompetitionSummary;
  view: "day" | "week" | "timeline";
  date: string;
  days: CalendarDay[];
  timeline: FixtureSnapshot[];
  upcoming: FixtureSnapshot[];
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export async function calendarView(
  slug: string,
  params: { view?: string; date?: string },
): Promise<CalendarView | null> {
  const session = await requireSession();
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return null;
  }
  const view = params.view === "week" ? "week" : params.view === "timeline" ? "timeline" : "day";
  const date =
    params.date !== undefined && DATE_SHAPE.test(params.date)
      ? params.date
      : nowWallClock().slice(0, 10);
  return inCompetitionOrg(session.personId, competition, async (db) => {
    const [days, timeline, upcoming] = await Promise.all([
      view === "week"
        ? weekView(db, competition.id, date)
        : view === "day"
          ? calendarRange(db, competition.id, date, date)
          : Promise.resolve([]),
      view === "timeline" ? competitionTimeline(db, competition.id) : Promise.resolve([]),
      upcomingFixtures(db, competition.id, nowWallClock()),
    ]);
    return { competition, view, date, days, timeline, upcoming };
  });
}

export interface MatchDayView {
  competition: CompetitionSummary;
  date: string;
  groundGroups: MatchDayGround[];
  viewer: { canManage: boolean };
}

export async function matchDayView(
  slug: string,
  params: { date?: string },
): Promise<MatchDayView | null> {
  const session = await requireSession();
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return null;
  }
  const date =
    params.date !== undefined && DATE_SHAPE.test(params.date)
      ? params.date
      : nowWallClock().slice(0, 10);
  return inCompetitionOrg(session.personId, competition, async (db) => {
    const [groundGroups, canManage] = await Promise.all([
      matchDay(db, competition.id, date),
      canCompetition(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "fixture.manage",
      ),
    ]);
    return { competition, date, groundGroups, viewer: { canManage } };
  });
}

/** The organizer schedule strip on /competitions (across every org they belong to). */
export async function organizerScheduleView(): Promise<OrganizerFixture[]> {
  const session = await requireSession();
  // Cross-org union scoped by the membership join — system pool by design.
  return organizerSchedule(systemDb, session.personId, nowWallClock());
}

// --- CSV import (validate → preview → commit) + export --------------------------------

export interface FixtureImportPreview {
  validCount: number;
  errors: { line: number; message: string }[];
}

/** Validate only — shape in core, name resolution against the DB. No writes. */
export async function fixtureImportPreviewAction(
  slug: string,
  csv: string,
): Promise<FixtureImportPreview> {
  const gate = await fixtureGate(slug);
  if (!gate.ok) {
    return { validCount: 0, errors: [{ line: 1, message: gate.error }] };
  }
  const parsed = parseFixtureCsv(csv);
  const nameErrors = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    unknownImportNames(db, gate.competition, parsed.rows),
  );
  return {
    validCount: nameErrors.length === 0 ? parsed.rows.length : 0,
    errors: [...parsed.errors, ...nameErrors],
  };
}

/** Re-validate and commit atomically. Refuses any file with errors. */
export async function fixtureImportCommitAction(
  slug: string,
  csv: string,
): Promise<{ ok: boolean; imported?: number; error?: string }> {
  const gate = await fixtureGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const parsed = parseFixtureCsv(csv);
  if (parsed.errors.length > 0) {
    return {
      ok: false,
      error: `Fix ${String(parsed.errors.length)} row error(s) before importing.`,
    };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    commitFixtureImport(db, gate.competition, gate.personId, parsed.rows),
  );
  if (!result.ok) {
    return {
      ok: false,
      error: `Fix ${String(result.errors.length)} row error(s) before importing.`,
    };
  }
  return { ok: true, imported: result.imported };
}

/**
 * Export authorization = fixture.manage. The CSV is a pure serialization of the
 * ScheduleSnapshot — exports never read mutable fixture entities (M-IP3-4).
 */
export async function exportFixturesAction(
  slug: string,
): Promise<{ ok: true; csv: string; filename: string } | { ok: false; error: string }> {
  const gate = await fixtureGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const snapshot = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    scheduleSnapshot(db, gate.competition),
  );
  return {
    ok: true,
    csv: serializeScheduleCsv(snapshot),
    filename: `${gate.competition.slug}-fixtures.csv`,
  };
}
