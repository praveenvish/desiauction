"use server";

import {
  parseFixtureCsv,
  parseScoreField,
  sportPackFor,
  type FixtureStatus,
  type ResultOutcome,
} from "@desiauction/core";
import { organizations, withTenantDb, type Db } from "@desiauction/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { dbHandle, systemDb } from "../db";
import { can } from "../orgs/authz";
import { resolveTenant } from "../orgs/orgs";
import { canCompetition, requireCompetitionCapability } from "./authz";
import {
  isResultOutcome,
  recordFixtureResult,
  resultsOf,
  standingsOf,
  type StandingsView,
} from "./results";
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
  discardDrafts,
  editFixture,
  generateFixtures,
  previewGeneration,
  publishAllScheduled,
  publishFixture,
  rescheduleFixture,
  scheduleAllDrafts,
  scheduleFixture,
  startFixture,
  type FixtureMutationResult,
  type FixturePatch,
  type GenerateInput,
  type GeneratePreview,
  type LabelledConflict,
  type ManualFixtureInput,
} from "./fixture-aggregate";
import { commitFixtureImport, importDryRun } from "./fixture-import";
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
  PUBLIC_FIXTURE_STATUSES,
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

/**
 * A refusal has to name what it refused. "A team is booked twice at once" sends
 * an organizer hunting through 240 fixtures; the conflict already knows which
 * two, so say which two.
 */
function conflictMessages(conflicts: LabelledConflict[]): string {
  const first = conflicts[0];
  const head = first === undefined ? "Scheduling conflict." : first.summary;
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

/**
 * DA-13's shape, seventh occurrence. `canManage` decided which BUTTONS rendered
 * while the read model shipped the same payload to everyone, so a member with
 * zero grants received all 240 DRAFT fixtures, the whole pager and 120 conflict
 * items — an organizer's unfinished schedule and its problems, served to
 * someone who cannot act on any of it — plus `activeGroundsOf(orgId)`, every
 * ground the ORGANIZATION owns rather than the ones this season uses.
 *
 * The capability is resolved BEFORE the read and the keys are simply absent
 * without it (the `seasonOverviewView({ money })` shape): a key that is never
 * populated cannot leak through a component that forgets to check.
 */
export interface FixtureDashboard {
  /** The season's score components, as plain data for the client form. */
  scoreFields: readonly { key: string; label: string; help?: string }[];
  competition: CompetitionSummary;
  /** Where to create venues and grounds — the activation path, as a link. */
  orgSlug: string;
  stats: FixtureStats;
  page: FixturePage;
  teams: TeamSummary[];
  /** Absent without fixture.manage — the org's ground inventory is not public. */
  grounds?: GroundOption[];
  /** Absent without fixture.manage — an unfinished schedule's problems. */
  conflicts?: LabelledConflict[];
  /**
   * Recorded results for the fixtures on this page, keyed by fixture.
   *
   * Carried so a row can show its score, and so the panel can name the matches
   * that were played and never scored — the state a season quietly accumulates
   * and nothing else surfaces.
   */
  results: Record<
    string,
    {
      outcome: ResultOutcome;
      score: { home?: Record<string, number>; away?: Record<string, number> } | null;
    }
  >;
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
    // The gate runs FIRST; every read below is shaped by its answer.
    const canManage = await canCompetition(db, session.personId, scope, "fixture.manage");
    const visible = canManage ? undefined : PUBLIC_FIXTURE_STATUSES;
    const [orgSlug, stats, page, teamList, groundList, conflicts, resultMap] = await Promise.all([
      orgSlugOf(db, competition.orgId),
      fixtureStats(db, competition.id, visible),
      queryFixtures(db, competition.id, {
        ...(visible !== undefined ? { visible } : {}),
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
      canManage ? activeGroundsOf(db, competition.orgId) : Promise.resolve(undefined),
      canManage ? competitionConflicts(db, competition) : Promise.resolve(undefined),
      resultsOf(db, competition.id),
    ]);
    return {
      competition,
      orgSlug,
      stats,
      page,
      teams: teamList,
      ...(groundList !== undefined ? { grounds: groundList } : {}),
      ...(conflicts !== undefined ? { conflicts } : {}),
      scoreFields: sportPackFor(competition.sport).result.scoreFields.map((field) => ({
        key: field.key,
        label: field.entry?.label ?? field.label,
        ...(field.entry?.help !== undefined ? { help: field.entry.help } : {}),
      })),
      results: Object.fromEntries(
        [...resultMap.entries()].map(([fixtureId, row]) => [
          fixtureId,
          // The scoreline in the season's own shape — the card renders it
          // through the pack rather than assuming runs.
          { outcome: row.outcome, score: row.score },
        ]),
      ),
      viewer: { canManage },
    };
  });
}

async function orgSlugOf(db: Db, orgId: string): Promise<string> {
  const [row] = await db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return row?.slug ?? "";
}

// --- Aggregate operations (thin, gated pass-throughs) --------------------------------

const GENERATE_ERROR: Record<string, string> = {
  fixtures_exist: "Fixtures already exist — discard the drafts or cancel them before regenerating.",
  too_few_teams: "Add at least 2 teams first.",
  duplicate_team: "Team list has a duplicate.",
  no_grounds: "Pick at least one ground.",
  unknown_ground: "Pick grounds that belong to this organization.",
  invalid_start_date: "Pick a valid start date.",
  invalid_kickoff_times: "Kickoff times must be HH:MM.",
  invalid_duration: "Duration must be 1–1440 minutes.",
};

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
    return { ok: false, error: GENERATE_ERROR[result.reason] ?? "Could not generate." };
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

/**
 * Bulk results say what happened. These actions returned `{ ok: true }`
 * unconditionally and the client toasted a fixed green "Schedule published" on
 * `ok` alone — so pressing Publish with ZERO fixtures reported success, and 240
 * fixtures with 240 skips reported the same success. The counts were always in
 * the result; they just never reached the sentence.
 */
export interface BulkFixtureResult {
  ok: boolean;
  applied?: number;
  skipped?: number;
  error?: string;
}

export async function scheduleAllAction(slug: string): Promise<BulkFixtureResult> {
  const gate = await fixtureGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    scheduleAllDrafts(db, gate.competition, gate.personId),
  );
  return { ok: true, ...result };
}

export async function publishAllAction(slug: string): Promise<BulkFixtureResult> {
  const gate = await fixtureGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    publishAllScheduled(db, gate.competition, gate.personId),
  );
  return { ok: true, ...result };
}

/** Cancel every draft — the undo for a generation the organizer didn't want. */
export async function discardDraftsAction(slug: string): Promise<BulkFixtureResult> {
  const gate = await fixtureGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    discardDrafts(db, gate.competition, gate.personId),
  );
  return { ok: true, ...result };
}

/** What Generate would write, before it writes it. No mutation. */
export async function previewGenerationAction(
  slug: string,
  input: GenerateInput,
): Promise<{ ok: true; preview: GeneratePreview } | { ok: false; error: string }> {
  const gate = await fixtureGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    previewGeneration(db, gate.competition, input),
  );
  return result.ok
    ? { ok: true, preview: result.preview }
    : { ok: false, error: GENERATE_ERROR[result.reason] ?? "Could not plan a schedule." };
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
    // Same gate as the dashboard: the calendar is the same schedule, laid out
    // differently, so a grantless member sees the same published subset here.
    const canManage = await canCompetition(
      db,
      session.personId,
      { orgId: competition.orgId, competitionId: competition.id },
      "fixture.manage",
    );
    const visible = canManage ? undefined : PUBLIC_FIXTURE_STATUSES;
    const [days, timeline, upcoming] = await Promise.all([
      view === "week"
        ? weekView(db, competition.id, date, visible)
        : view === "day"
          ? calendarRange(db, competition.id, date, date, visible)
          : Promise.resolve([]),
      view === "timeline" ? competitionTimeline(db, competition.id, visible) : Promise.resolve([]),
      upcomingFixtures(db, competition.id, nowWallClock(), visible),
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
    const canManage = await canCompetition(
      db,
      session.personId,
      { orgId: competition.orgId, competitionId: competition.id },
      "fixture.manage",
    );
    const groundGroups = await matchDay(
      db,
      competition.id,
      date,
      canManage ? undefined : PUBLIC_FIXTURE_STATUSES,
    );
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
  const dbErrors =
    parsed.errors.length > 0
      ? []
      : await inCompetitionOrg(gate.personId, gate.competition, (db) =>
          importDryRun(db, gate.competition, parsed.rows),
        );
  const errors = [...parsed.errors, ...dbErrors];
  return { validCount: errors.length === 0 ? parsed.rows.length : 0, errors };
}

/** Re-validate and commit atomically. Refuses any file with errors. */
export async function fixtureImportCommitAction(
  slug: string,
  csv: string,
): Promise<{
  ok: boolean;
  imported?: number;
  error?: string;
  errors?: { line: number; message: string }[];
}> {
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
    const first = result.errors[0];
    return {
      ok: false,
      error:
        first === undefined
          ? "Nothing was imported."
          : `Line ${String(first.line)}: ${first.message}${result.errors.length > 1 ? ` (+${String(result.errors.length - 1)} more)` : ""}`,
      errors: result.errors,
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

// --- Results and standings ------------------------------------------------------------
//
// A fixture could be scheduled, published, started and marked `completed` while
// the product recorded nothing about how it went. Everything below exists so a
// season has an answer to "who won" and "who is top".

export interface StandingsPageView {
  readonly competition: CompetitionSummary;
  readonly standings: StandingsView;
  readonly viewer: { canManage: boolean };
}

/**
 * The table. Public to anyone who can see the competition — a league table that
 * only officers can read is not a league table.
 */
export async function standingsView(slug: string): Promise<StandingsPageView | null> {
  const session = await requireSession();
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return null;
  }
  return inCompetitionOrg(session.personId, competition, async (db) => {
    const [canManage, standings] = await Promise.all([
      canCompetition(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "fixture.manage",
      ),
      standingsOf(db, competition.id),
    ]);
    return { competition, standings, viewer: { canManage } };
  });
}

/**
 * Record or amend a result.
 *
 * THE SCORE ARRIVES AS THE SCORER TYPED IT, keyed by the season's own score
 * components — `{ home: { runs, wickets, balls }, away: … }` in cricket,
 * `{ home: { goals } }` in football — and is parsed HERE, at the edge, by the
 * pack. That is deliberate: cricket's `balls` is written "18.3" and stored as
 * 111, and the function that knows so cannot cross into a client component.
 * `ballsOf` still refuses `.6` rather than folding it to the next over —
 * somebody typing 4.6 has made a mistake, and reading it as 5.0 buries that in
 * a number nobody re-checks.
 */
export async function recordResultAction(
  slug: string,
  fixtureId: string,
  input: {
    outcome: string;
    /** Raw text per score component, exactly as the scorer typed it. */
    home?: Record<string, string>;
    away?: Record<string, string>;
    method?: string;
    note?: string;
  },
): Promise<{ ok: boolean; error?: string | undefined; amended?: boolean | undefined }> {
  const session = await requireSession();
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  const outcome = input.outcome;
  if (!isResultOutcome(outcome)) {
    return { ok: false, error: "Pick how the match ended." };
  }
  const pack = sportPackFor(competition.sport);
  /*
   * A component the scorer left blank is null and fine; one they filled in that
   * the pack cannot read is a mistake worth naming. The two are told apart by
   * comparing against what was GIVEN, not by a flag set inside the loop.
   */
  const given = (side?: Record<string, string>, key?: string): boolean =>
    (side?.[key ?? ""] ?? "").trim() !== "";
  const side = (raw?: Record<string, string>): Record<string, number | null> => {
    const out: Record<string, number | null> = {};
    for (const field of pack.result.scoreFields) {
      out[field.key] = given(raw, field.key)
        ? parseScoreField(pack, field.key, raw?.[field.key] ?? "")
        : null;
    }
    return out;
  };
  const fields = { homeScore: side(input.home), awayScore: side(input.away) };
  const unreadable = pack.result.scoreFields.some(
    (field) =>
      (given(input.home, field.key) && fields.homeScore[field.key] === null) ||
      (given(input.away, field.key) && fields.awayScore[field.key] === null),
  );
  if (unreadable) {
    // Named specifically, because "invalid input" on a multi-field form sends a
    // scorer hunting. In cricket, overs are the field people get wrong.
    return {
      ok: false,
      error: "Check the numbers — overs are written like 18.3, and .6 is not an over.",
    };
  }

  return inCompetitionOrg(session.personId, competition, async (db) => {
    try {
      await requireCompetitionCapability(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "fixture.manage",
      );
    } catch {
      return { ok: false, error: "You can't record results for this competition." };
    }
    const result = await recordFixtureResult(db, {
      orgId: competition.orgId,
      fixtureId,
      actorId: session.personId,
      result: {
        outcome,
        ...fields,
        method: input.method?.trim() === "" ? null : (input.method ?? null),
        note: input.note?.trim() === "" ? null : (input.note ?? null),
      },
    });
    if (!result.ok) {
      const message: Record<typeof result.reason, string> = {
        unknown_fixture: "That fixture is not in this competition.",
        not_played:
          "That match has not been played. Publish it, start it and complete it before recording a result.",
        impossible_score: "That score cannot be right — check runs and wickets.",
        winner_without_score:
          "A result with a winner needs both scores. Use 'no result' if the match did not finish.",
      };
      return { ok: false, error: message[result.reason] };
    }
    revalidatePath(`/seasons/${slug}/fixtures`);
    revalidatePath(`/seasons/${slug}/standings`);
    return { ok: true, amended: result.amended };
  });
}
