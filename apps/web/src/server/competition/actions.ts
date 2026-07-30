"use server";

import {
  NAME_MAX_LENGTH,
  DEFAULT_AUCTION_CONFIG,
  isRejectionReason,
  parseRegistrationCsv,
  slugifyName,
  validateNewPlayer,
  type CsvRowError,
  type PhotoTarget,
  type PlayerField,
  type RegistrationEvent,
  type RegistrationStatus,
} from "@desiauction/core";
import { withTenantDb, type Db } from "@desiauction/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auctionOf } from "@desiauction/auction";

import { currentSession } from "../auth/actions";
import { dbHandle, systemDb } from "../db";
import { ForbiddenError } from "../orgs/authz";
import { canSettlement } from "../settlement/authz";
import { orgsFor } from "../orgs/orgs";
import { canCompetition, requireCompetitionCapability } from "./authz";
import {
  advanceCompetition,
  cloneCompetition,
  competitionForRegistration,
  competitionsForPerson,
  createCompetition,
  createTeam,
  publishBlockers,
  resolveCompetition,
  setCompetitionVisibility,
  setTeamCoach,
  updateTeamDetails,
  tournamentsOf,
  teamsOf,
  updateCompetitionDetails,
  type CompetitionSummary,
  type PublishBlocker,
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
import { notifyDecision } from "./registration-notify";
import { seasonOverview, type SeasonOverview } from "./season-overview";
import { teamsWorkspace, type TeamsWorkspace } from "./team-workspace";
export type { TeamCard, TeamRosterRow } from "./team-workspace";
import {
  addPlayerByPhone,
  exportRegistrationsCsv,
  myRegistration,
  orphanIcons,
  photoTargetsOf,
  publicRegistrationFacts,
  queryRegistrations,
  recordRegistrationExport,
  registrationStats,
  registrationsOf,
  submitRegistration,
  timelineOf,
  type OrphanIcon,
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

/**
 * Deduped per request. This is the console's most-called read — the shell
 * (app/layout.tsx), /home's page body and /home's dashboard all need the same
 * org+season list, so ONE render was issuing it three times: three membership
 * reads and three cross-org unions for one screen.
 *
 * The cached function is internal because this module is `"use server"`: every
 * export must itself be an async function, and `cache()` returns a plain one.
 * The exported wrapper stays async and the memoisation happens behind it.
 */
const competitionsViewOnce = cache(async (): Promise<CompetitionsView> => {
  const session = await requireSession();
  const [orgs, competitions] = await Promise.all([
    withTenantDb(dbHandle, { personId: session.personId }, (db) => orgsFor(db, session.personId)),
    // Cross-org union scoped by the membership join — system pool by design.
    competitionsForPerson(systemDb, session.personId),
  ]);
  return { orgs: orgs.map((o) => ({ id: o.id, name: o.name })), competitions };
});

export async function competitionsView(): Promise<CompetitionsView> {
  return competitionsViewOnce();
}

/**
 * Which control a rejection belongs under.
 *
 * The form bound its single `error` string to the Season name field whatever
 * the error was, so "The end date falls before the start date." was printed
 * under a text input two fields above the dates that caused it — and the
 * authorisation refusal, which belongs to no field at all, landed there too.
 * Naming the field is the server's job: only the server knows which rule fired.
 */
export type CompetitionFormField = "name" | "orgId" | "endsOn" | "form";

export interface CreateCompetitionState {
  error?: string;
  /** Absent only when `error` is. "form" means: not any one control's fault. */
  field?: CompetitionFormField;
}

export async function createCompetitionAction(
  _previous: CreateCompetitionState,
  formData: FormData,
): Promise<CreateCompetitionState> {
  const session = await requireSession();
  const orgId = formString(formData, "orgId");
  const name = formString(formData, "name");
  const location = formString(formData, "location");
  const startsOn = formString(formData, "startsOn");
  const endsOn = formString(formData, "endsOn");
  const tournamentId = formString(formData, "tournamentId");
  // Membership + capability: only an owner/staff of THIS org may create in it.
  const memberships = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    orgsFor(db, session.personId),
  );
  if (!memberships.some((o) => o.id === orgId)) {
    return { error: "Choose one of your organizations.", field: "orgId" };
  }
  // DA-08: a reversed range was accepted, then printed publicly as
  // "1 Oct – 1 Aug 2026" and emitted in JSON-LD as an invalid SportsEvent —
  // and the season overview never showed the dates, so nobody could see it.
  if (startsOn !== "" && endsOn !== "" && endsOn < startsOn) {
    return { error: "The end date falls before the start date.", field: "endsOn" };
  }
  // The tournament arrives from a hidden field, so it is caller input like any
  // other: prove it belongs to the SAME org before letting a season claim it,
  // or a forged id would file an edition under someone else's tournament.
  if (tournamentId !== "") {
    const owned = await withTenantDb(dbHandle, { personId: session.personId, orgId }, (db) =>
      tournamentsOf(db, orgId),
    );
    if (!owned.some((tournament) => tournament.id === tournamentId)) {
      return { error: "That tournament isn't in this organization.", field: "form" };
    }
  }
  let slug: string;
  let valid = "";
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
          ...(tournamentId !== "" ? { tournamentId } : {}),
        });
      },
    );
    slug = competition.slug;
    valid = competition.name;
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return {
        error: "You can't create seasons in this organization. Ask an owner to add one.",
        field: "form",
      };
    }
    return { error: "Give the season a name of at least 3 characters.", field: "name" };
  }
  // A season was created and the person was simply teleported onto a page they
  // had never seen, with nothing naming what had just happened. The signal
  // rides a short-lived cookie rather than a query parameter: the destination
  // URL is the season's real address, and several tests (and people) capture it
  // to build sub-paths from — a `?created=1` still hanging off it would corrupt
  // every one of those. The client reads it once and deletes it.
  // Next's cookie store percent-encodes the value on the way out; the
  // client decodes once on the way in.
  (await cookies()).set("da_created_season", valid, {
    maxAge: 30,
    path: "/",
    sameSite: "lax",
  });
  redirect(`/seasons/${slug}`);
}

export interface CompetitionView {
  competition: CompetitionSummary;
  teams: TeamSummary[];
  /**
   * The applicant list — names, phone numbers, ages, photo URLs. DA-30: ABSENT
   * unless the viewer holds `registration.review`. Its only consumer, the
   * Readiness Center, never read a row of it; it counted them.
   */
  registrations?: RegistrationRow[];
  viewer: { canManage: boolean; canReview: boolean };
}

export interface SeasonOverviewView extends SeasonOverview {
  viewer: { canManage: boolean; canReview: boolean; canSeeMoney: boolean };
  /** What still stands between this season and a public page (DA-12). */
  publishBlockers: PublishBlocker[];
}

export async function competitionView(slug: string): Promise<CompetitionView | null> {
  const session = await requireSession();
  const competition = await resolveCompetitionScoped(session.personId, slug);
  if (competition === null) {
    return null;
  }
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  return inCompetitionOrg(session.personId, competition, async (db) => {
    const [teams, canManage, canReview] = await Promise.all([
      teamsOf(db, competition.id),
      canCompetition(db, session.personId, scope, "competition.manage"),
      canCompetition(db, session.personId, scope, "registration.review"),
    ]);
    // Decided before the read, and the read obeys it — the rows are never
    // fetched, let alone serialized, for someone who may not review them.
    const registrations = canReview ? await registrationsOf(db, competition.id) : null;
    return {
      competition,
      teams,
      ...(registrations !== null ? { registrations } : {}),
      viewer: { canManage, canReview },
    };
  });
}

/**
 * The Season Workspace overview: the same gate as `competitionView`, but it
 * returns the derived tiles and summary cards instead of the raw lists. Kept
 * separate so the dashboard's aggregation never slows the tabs that don't need
 * it.
 */
export async function seasonOverviewView(slug: string): Promise<SeasonOverviewView | null> {
  const session = await requireSession();
  const competition = await resolveCompetitionScoped(session.personId, slug);
  if (competition === null) {
    return null;
  }
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  return inCompetitionOrg(session.personId, competition, async (db) => {
    const [canManage, canReview, canSettle] = await Promise.all([
      canCompetition(db, session.personId, scope, "competition.manage"),
      canCompetition(db, session.personId, scope, "registration.review"),
      canSettlement(db, session.personId, competition.orgId, "settlement.view"),
    ]);
    // DA-13: money sight is decided BEFORE the read, and the read obeys it.
    // Running the season is money authority over the season's own auction
    // (`competition.manage`); the books are `settlement.view`. Neither one is
    // implied by mere membership, which is what the old payload assumed.
    const canSeeMoney = canManage || canSettle;
    const overview = await seasonOverview(db, competition, { money: canSeeMoney });
    return {
      ...overview,
      viewer: { canManage, canReview, canSeeMoney },
      publishBlockers: publishBlockers(competition),
    };
  });
}

export interface TeamsWorkspaceView extends TeamsWorkspace {
  viewer: {
    canManage: boolean;
    /**
     * `team.manage` — the capability `createTeamAction` actually enforces.
     * DA-33: the add-team affordances asked for `competition.manage`, so
     * `org:staff`, which holds `team.manage` and nothing else, was shown a
     * read-only screen for a job it is authorized to do.
     */
    canManageTeams: boolean;
    /** `auction.conduct` — may mint an owner invitation from this tab. */
    canConduct: boolean;
    canSeeMoney: boolean;
    canSeeRoster: boolean;
  };
}

/**
 * The Teams tab: franchise cards and, for a manager, rosters with buy prices.
 *
 * DA-30: membership is the gate on the SEASON, never on its money or its
 * players. `acceptOwnerJoin` enrols every accepted team owner as a viewer-level
 * member, so "everyone with membership" includes the rival bidders — this view
 * used to serve each of them every other team's remaining purse, every squad,
 * every hammer price and every player's raw E.164 phone, and then hide the
 * `+ Add team` button. Sight is decided HERE, before the read, and the read
 * obeys it; the keys never reach the wire.
 */
export async function teamsWorkspaceView(slug: string): Promise<TeamsWorkspaceView | null> {
  const session = await requireSession();
  const competition = await resolveCompetitionScoped(session.personId, slug);
  if (competition === null) {
    return null;
  }
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  return inCompetitionOrg(session.personId, competition, async (db) => {
    const [canManage, canManageTeams, canReview, canConduct, canSettle] = await Promise.all([
      canCompetition(db, session.personId, scope, "competition.manage"),
      canCompetition(db, session.personId, scope, "team.manage"),
      canCompetition(db, session.personId, scope, "registration.review"),
      canCompetition(db, session.personId, scope, "auction.conduct"),
      canSettlement(db, session.personId, competition.orgId, "settlement.view"),
    ]);
    // The same two answers the season overview gives, so one season cannot
    // report its money two ways: running it, or keeping its books.
    const canSeeMoney = canManage || canSettle;
    // Squad names and phone numbers are registration data wherever they are
    // rendered; /registrations is gated on `registration.review`, so is this.
    const canSeeRoster = canManage || canReview;
    const workspace = await teamsWorkspace(db, competition, {
      money: canSeeMoney,
      roster: canSeeRoster,
    });
    return {
      ...workspace,
      viewer: { canManage, canManageTeams, canConduct, canSeeMoney, canSeeRoster },
    };
  });
}

export async function advanceCompetitionAction(
  slug: string,
  to: CompetitionSummary["status"],
): Promise<{ ok: boolean; error?: string; needsDetails?: boolean }> {
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
    // DA-11: `guard_failed` names three fields the product had no way to set.
    // The flag lets the screen answer with the repair instead of the complaint.
    return result.reason === "guard_failed"
      ? {
          ok: false,
          error: "Set a name, dates and location before opening registration.",
          needsDetails: true,
        }
      : { ok: false, error: "That step isn't available yet." };
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
// existing competition.manage capability. The directory and /c/[slug] read this
// column; nothing else changes.
//
// DA-12: publishing is now gated and audited. It was neither: a season in
// `setup`, with no registrations, published in one click a public page telling
// the world registration was closed — and left no audit trail of having done
// it. Unpublishing is never blocked; taking a page DOWN is always allowed.
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
  if (visibility === "public") {
    const blockers = publishBlockers(competition);
    if (blockers.length > 0) {
      return { ok: false, error: blockers[0]?.message ?? "This season isn't ready to publish." };
    }
  }
  await inCompetitionOrg(session.personId, competition, (db) =>
    setCompetitionVisibility(db, competition, session.personId, visibility),
  );
  return { ok: true };
}

export type DetailsField = "name" | "startsOn" | "endsOn" | "location" | "form";

/**
 * DA-11: give a season's name, dates and location a way to change.
 *
 * Capability-gated exactly like the lifecycle advance (`competition.manage`),
 * because it edits the same row that gate protects — and because a season whose
 * dates cannot be set is a season whose lifecycle cannot advance.
 */
export async function updateCompetitionDetailsAction(
  slug: string,
  input: { name: string; location: string; startsOn: string; endsOn: string },
): Promise<{ ok: boolean; error?: string; field?: DetailsField }> {
  const session = await requireSession();
  const competition = await resolveCompetitionScoped(session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available.", field: "form" };
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
    return { ok: false, error: "You can't manage this season.", field: "form" };
  }
  const result = await inCompetitionOrg(session.personId, competition, (db) =>
    updateCompetitionDetails(db, competition, session.personId, {
      name: input.name,
      location: input.location.trim() === "" ? null : input.location.trim(),
      startsOn: input.startsOn === "" ? null : input.startsOn,
      endsOn: input.endsOn === "" ? null : input.endsOn,
    }),
  );
  if (!result.ok) {
    return result.reason === "invalid_name"
      ? { ok: false, error: "Give the season a name of at least 3 characters.", field: "name" }
      : { ok: false, error: "The end date falls before the start date.", field: "endsOn" };
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
  // DA-07: the team set is what the auction issued paddles against and what
  // settlement sealed. A fifth team appearing after the hammer fell left the
  // season permanently inconsistent — five teams against a four-team auction
  // and a four-team reconciled case — and with no delete, unfixable.
  const auction = await auctionOf(systemDb, competition.id);
  if (auction !== null && auction.status !== "scheduled") {
    return {
      ok: false,
      error: "The auction has started — the teams are locked for this season.",
    };
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
          : `Team names run from 3 to ${String(NAME_MAX_LENGTH)} characters.`,
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
): Promise<{ ok: boolean; error?: string; notified?: number; notifyFailed?: number }> {
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
  const notice = await notifyAffected(gate, [registrationId], event);
  return { ok: true, ...notice };
}

/**
 * DA-35: tell the people it happened to. Best effort — the transition has
 * already committed, so a provider outage costs a text message, never a
 * decision. The counts come back so the organizer's toast can say plainly
 * whether anyone went untold instead of implying everyone was reached.
 */
async function notifyAffected(
  gate: { personId: string; competition: CompetitionSummary },
  registrationIds: readonly string[],
  event: RegistrationEvent,
): Promise<{ notified?: number; notifyFailed?: number }> {
  if (registrationIds.length === 0 || event.type === "submit") {
    return {};
  }
  try {
    const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
      notifyDecision(db, {
        orgId: gate.competition.orgId,
        competitionSlug: gate.competition.slug,
        competitionName: gate.competition.name,
        registrationIds,
        event: event.type,
        ...(event.type === "reject" ? { reason: event.reason } : {}),
        actorId: gate.personId,
      }),
    );
    return { notified: result.sent, notifyFailed: result.failed };
  } catch {
    return { notifyFailed: registrationIds.length };
  }
}

/** Bulk triage — same review gate, same core event, applied atomically (identical to N singles). */
export async function bulkTriageAction(
  slug: string,
  registrationIds: string[],
  action: TriageAction,
  reason?: string,
): Promise<{
  ok: boolean;
  applied?: number;
  skipped?: number;
  notified?: number;
  notifyFailed?: number;
  error?: string;
}> {
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
  const notice = await notifyAffected(gate, result.applied, event);
  return { ok: true, applied: result.applied.length, skipped: result.skipped.length, ...notice };
}

// --- Player-facing registration (any authenticated person) -------------------

export interface RegistrationLanding {
  competitionName: string;
  open: boolean;
  // PX-5: the number is the player's human-quotable reference on the status view.
  mine: {
    id: string;
    status: string;
    role: string;
    number: string;
    rejectionReason: string | null;
  } | null;
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

export interface RegistrationPreview {
  competitionName: string;
  open: boolean;
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
}

/**
 * DA-35: the signed-out view of a registration link. Anonymous, so it carries
 * NOTHING about who else registered — the season's own public facts only, the
 * same ones the public season page already shows. Returns null for a private
 * season, which keeps the login redirect as the behaviour for those.
 */
export async function registrationPreview(slug: string): Promise<RegistrationPreview | null> {
  const facts = await publicRegistrationFacts(systemDb, slug);
  if (facts === null) {
    return null;
  }
  return {
    competitionName: facts.name,
    open: facts.status === "registration_open",
    location: facts.location,
    startsOn: facts.startsOn,
    endsOn: facts.endsOn,
  };
}

/**
 * DA-35: a player withdraws their OWN registration. `withdraw` was a declared
 * TriageAction with no caller anywhere, `withdrawn` sat in the organizer's
 * status filter unreachable, and a player who pulled out was filed as REJECTED
 * with reason "withdrew" — told "this wasn't approved this time" for a decision
 * they made themselves. Under DPDP the inability to withdraw is not a UX gap.
 *
 * Authorization is ownership, not capability: the registration must belong to
 * the caller. The state machine decides whether the transition is legal.
 */
export async function withdrawMyRegistrationAction(
  slug: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const competition = await competitionForRegistration(systemDb, slug);
  if (competition === null) {
    return { ok: false, error: "This season is not available." };
  }
  const mine = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    myRegistration(db, competition.id, session.personId),
  );
  if (mine === null) {
    return { ok: false, error: "You don't have a registration for this season." };
  }
  const result = await withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: competition.orgId },
    (db) =>
      transition(db, competition.orgId, competition.id, mine.id, session.personId, {
        type: "withdraw",
      }),
  );
  if (!result.ok) {
    return {
      ok: false,
      error: "This registration can no longer be withdrawn — ask the organizer.",
    };
  }
  return { ok: true };
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
  /**
   * Counts only — no applicant is identified by them. DA-35: still ABSENT for a
   * refused viewer. They are cheap, but a refused screen renders nothing from
   * them, so computing and shipping them was work done to leak a little.
   */
  stats?: RegistrationStats;
  /**
   * The applicant rows themselves. DA-30: ABSENT without `registration.review`.
   * The screen has always REFUSED a non-reviewer in words — "You don't have
   * permission to review registrations for this season" — while shipping every
   * applicant's name, phone, age and photo URL in the payload behind it.
   */
  page?: RegistrationPage;
  /** Approved icons with no team, named. Review-gated: these are applicants. */
  orphanIcons?: OrphanIcon[];
  teams?: TeamSummary[];
  /** Drives the closed-intake notice on the share block (DA-35). */
  registrationOpen: boolean;
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
    const canReview = await canCompetition(db, session.personId, scope, "registration.review");
    // The refusal renders one sentence. Everything below the gate is computed
    // ONLY for someone allowed to see it — the cheapest possible partition.
    if (!canReview) {
      return {
        competition,
        registrationOpen: competition.status === "registration_open",
        viewer: { canReview },
      };
    }
    const [stats, page, teams, orphans] = await Promise.all([
      registrationStats(db, competition.id),
      queryRegistrations(db, competition.id, query),
      teamsOf(db, competition.id),
      orphanIcons(db, competition.id),
    ]);
    return {
      competition,
      stats,
      page,
      teams,
      orphanIcons: orphans,
      registrationOpen: competition.status === "registration_open",
      viewer: { canReview },
    };
  });
}

/** How many rows one "select all matching" may name. Bulk triage is atomic, so
 * this is a bound on the CLIENT's ability to hold and show what it selected. */
const SELECT_ALL_CAP = 1000;

export interface SelectableRow {
  id: string;
  number: string;
  name: string | null;
  status: RegistrationStatus;
}

/**
 * DA-35: "Select all on page" selected 25 of 400 and then survived paging and
 * filter changes invisibly — the organizer could reject 25 people none of whom
 * were on screen. Honest bulk needs its opposite: select every row the CURRENT
 * FILTER matches, named, so the count and the people agree.
 */
export async function selectAllMatchingAction(
  slug: string,
  params: DashboardParams,
): Promise<{ ok: true; rows: SelectableRow[]; capped: boolean } | { ok: false; error: string }> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  return inCompetitionOrg(gate.personId, gate.competition, async (db) => {
    const collected: SelectableRow[] = [];
    let page = 1;
    for (;;) {
      const result = await queryRegistrations(db, gate.competition.id, {
        ...(params.search !== undefined && params.search !== "" ? { search: params.search } : {}),
        ...(params.status !== undefined && VALID_STATUS.has(params.status as RegistrationStatus)
          ? { status: params.status as RegistrationStatus }
          : {}),
        ...(params.teamId !== undefined && params.teamId !== "" ? { teamId: params.teamId } : {}),
        sort: "number",
        page,
        pageSize: 100,
      });
      collected.push(
        ...result.rows.map((row) => ({
          id: row.id,
          number: row.number,
          name: row.name,
          status: row.status,
        })),
      );
      if (collected.length >= SELECT_ALL_CAP || page * result.pageSize >= result.total) {
        return {
          ok: true as const,
          rows: collected.slice(0, SELECT_ALL_CAP),
          capped: collected.length > SELECT_ALL_CAP,
        };
      }
      page += 1;
    }
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
  const result = await inCompetitionOrg(session.personId, competition, (db) =>
    setRegistrationMarks(
      db,
      competition.orgId,
      competition.id,
      registrationId,
      marks,
      session.personId,
    ),
  );
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "icon_and_captain"
          ? "A player can't be both an Icon and a Captain. An Icon is pre-signed to their team and never goes to the auction; a Captain leads a squad that plays. Clear one mark before setting the other."
          : "That registration is not in this season.",
    };
  }
  return { ok: true };
}

/** Set (or clear) a team's coach (organizer, `team.manage`). */
/**
 * DA-35: rename a team / correct its short name or colour. Same capability as
 * creating one (`team.manage`), and the same lock: once the auction has left
 * `scheduled` the franchise identity the board and the settlement case were
 * built on is frozen with it.
 */
export async function updateTeamAction(
  slug: string,
  teamId: string,
  input: { name: string; shortName: string; primaryColor: string },
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
  const auction = await auctionOf(systemDb, competition.id);
  if (auction !== null && auction.status !== "scheduled") {
    return {
      ok: false,
      error: "The auction has started — the teams are locked for this season.",
    };
  }
  const result = await inCompetitionOrg(session.personId, competition, (db) =>
    updateTeamDetails(db, competition.orgId, competition.id, teamId, input, session.personId),
  );
  if (!result.ok) {
    const message: Record<string, string> = {
      invalid_name: "Give the team a name of at least 3 characters.",
      duplicate_name: "Another team in this season already has that name.",
      unknown_team: "That team is not in this season.",
    };
    return { ok: false, error: message[result.reason] ?? "That team couldn't be updated." };
  }
  return { ok: true };
}

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

// --- Organizer adds one player (manual form; same act as one CSV row) --------

export interface AddPlayerInput {
  name: string;
  phone: string;
  role: string;
  basePriceBand: string;
  dateOfBirth: string;
  battingStyle: string;
  bowlingStyle: string;
}

export type AddPlayerActionResult =
  | { ok: true; registrationId: string; number: string; personExisted: boolean }
  | { ok: false; error: string; fieldErrors?: Partial<Record<PlayerField, string>> };

/**
 * Same gate as the CSV import (registration.review), same validation truth
 * (validateNewPlayer — a row a file would reject cannot arrive via the form),
 * same person-stub semantics (addPlayerByPhone mirrors commitRegistrationImport
 * one row at a time). The registration lands in `submitted`; approval stays a
 * separate human act.
 */
export async function addPlayerAction(
  slug: string,
  input: AddPlayerInput,
): Promise<AddPlayerActionResult> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const check = validateNewPlayer(
    { name: input.name, phone: input.phone, role: input.role, basePriceBand: input.basePriceBand },
    await bandsFor(gate.competition.id),
  );
  if (!check.ok) {
    const fieldErrors: Partial<Record<PlayerField, string>> = {};
    for (const fieldError of check.errors) {
      fieldErrors[fieldError.field] = fieldError.message;
    }
    return { ok: false, error: "Fix the highlighted fields.", fieldErrors };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    addPlayerByPhone(db, gate.competition.id, gate.competition.orgId, gate.personId, {
      ...check.value,
      profile: {
        ...(input.dateOfBirth !== "" ? { dateOfBirth: input.dateOfBirth } : {}),
        ...(input.battingStyle !== "" ? { battingStyle: input.battingStyle } : {}),
        ...(input.bowlingStyle !== "" ? { bowlingStyle: input.bowlingStyle } : {}),
      },
    }),
  );
  if (!result.ok) {
    return {
      ok: false,
      error: "This phone number is already registered in this competition.",
      fieldErrors: { phone: "already registered here" },
    };
  }
  return {
    ok: true,
    registrationId: result.registrationId,
    number: result.number,
    personExisted: result.personExisted,
  };
}

/** The bands the Add-player form may offer — same source of truth as the CSV path. */
export async function competitionBandsAction(slug: string): Promise<readonly string[]> {
  const gate = await reviewGate(slug);
  return gate.ok ? bandsFor(gate.competition.id) : [];
}

// --- Bulk photo import: the match targets (files are matched client-side) ----

/** Review-gated list of who a photo filename may resolve to (whole competition). */
export async function photoTargetsAction(slug: string): Promise<PhotoTarget[]> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return [];
  }
  return inCompetitionOrg(gate.personId, gate.competition, (db) =>
    photoTargetsOf(db, gate.competition.id),
  );
}

// --- CSV import (validate → preview → commit) + export -----------------------

export interface ImportPreview {
  validCount: number;
  errors: CsvRowError[];
}

/**
 * The base-price bands this competition actually accepts (DA-14). Before the
 * auction exists the config is not yet locked, so the defaults are the honest
 * answer; afterwards the auction's own bands are.
 */
async function bandsFor(competitionId: string): Promise<readonly string[]> {
  const auction = await auctionOf(systemDb, competitionId);
  return Object.keys(auction?.config.basePriceBands ?? DEFAULT_AUCTION_CONFIG.basePriceBands);
}

/** Validate only — no writes. The organizer previews errors before committing. */
export async function importPreviewAction(slug: string, csv: string): Promise<ImportPreview> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { validCount: 0, errors: [{ line: 1, message: gate.error }] };
  }
  const result = parseRegistrationCsv(csv, await bandsFor(gate.competition.id));
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
  const parsed = parseRegistrationCsv(csv, await bandsFor(gate.competition.id));
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
  /**
   * DA-34: optional squad filter. The Teams tab offered "Export" on a single
   * team and merely NAVIGATED to /registrations with a filter in the URL — a
   * per-team export did not exist anywhere in the product.
   */
  teamId?: string,
): Promise<{ ok: true; csv: string; filename: string } | { ok: false; error: string }> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const { csv, filename } = await inCompetitionOrg(gate.personId, gate.competition, async (db) => {
    const team =
      teamId === undefined
        ? undefined
        : (await teamsOf(db, gate.competition.id)).find((entry) => entry.id === teamId);
    if (teamId !== undefined && team === undefined) {
      return { csv: null, filename: null };
    }
    const body = await exportRegistrationsCsv(db, gate.competition.id, teamId);
    const suffix = team === undefined ? "registrations" : `${slugifyName(team.name)}-squad`;
    const name = `${gate.competition.slug}-${suffix}.csv`;
    // DA-35: the export read personal data and returned it with no record that
    // it had happened. The evidence is written before the file reaches the
    // caller, in the same tenant boundary that authorized the read — a failure
    // here fails the export rather than releasing an unrecorded copy.
    await recordRegistrationExport(db, gate.competition.orgId, gate.competition.id, gate.personId, {
      // The header line is not a person; the row count is what left.
      rowCount: Math.max(0, body.trim() === "" ? 0 : body.trim().split("\n").length - 1),
      ...(teamId !== undefined ? { teamId } : {}),
      filename: name,
    });
    return { csv: body, filename: name };
  });
  if (csv === null) {
    return { ok: false, error: "That team is not in this season." };
  }
  return { ok: true, csv, filename };
}
