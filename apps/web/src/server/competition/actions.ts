"use server";

import {
  NAME_MAX_LENGTH,
  DEFAULT_AUCTION_CONFIG,
  applyMapping,
  detectMapping,
  evaluateRegistration,
  isEntryCategory,
  isMinor,
  isRejectionReason,
  parseRegistrationRecords,
  parseRole,
  planImport,
  sampleRow,
  signatureOf,
  slugifyName,
  tokenizeCsv,
  validateNewPlayer,
  type ColumnMapping,
  type CsvRowError,
  type DateOrder,
  type DetectedMapping,
  type ImportPolicy,
  type PhotoTarget,
  type PlayerField,
  type RegistrationEvent,
  type RegistrationStatus,
  type ValueMaps,
} from "@desiauction/core";
import { playerProfiles, registrations, withTenantDb, type Db } from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auctionOf } from "@desiauction/auction";
import { recordConsent } from "../messaging/consent";

import { currentSession } from "../auth/actions";
import { playerProfileFor, upsertPlayerProfile } from "../player/profile";
import { personSeasonsInOrg } from "../player/career";
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
import { marksFreezeWithRoster } from "./roster-lock";
import { commitRegistrationImport, existingForImport } from "./registration-import";
import {
  forgetImportMapping,
  saveImportMapping,
  savedMappingFor,
  type SavedMapping,
} from "./import-mappings";
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
  viewer: {
    canManage: boolean;
    canReview: boolean;
    canSeeMoney: boolean;
    /** `settlement.view` — whether /seasons/[slug]/money will actually open. */
    canSettle: boolean;
  };
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
      // `canSeeMoney` and `canSettle` are NOT the same answer, and the overview
      // needed both. Money SIGHT is running the season or keeping its books;
      // the settlement DESK is the books alone. The ladder's final rung offered
      // "Open settlement" on sight, so the person who had just conducted the
      // whole auction — org owner, `competition.manage`, no settlement grant —
      // was handed the page's primary call to action at the end of the night
      // and taken to "LOST BALL · This page doesn't exist".
      viewer: { canManage, canReview, canSeeMoney, canSettle },
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
  input: {
    name: string;
    location: string;
    startsOn: string;
    endsOn: string;
    /** PI-1: "" leaves the category as it stands (older callers omit it). */
    entryCategory?: string;
  },
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
  const category = input.entryCategory ?? "";
  if (category !== "" && !isEntryCategory(category)) {
    return { ok: false, error: "Pick one of the listed categories.", field: "form" };
  }
  const result = await inCompetitionOrg(session.personId, competition, (db) =>
    updateCompetitionDetails(db, competition, session.personId, {
      name: input.name,
      location: input.location.trim() === "" ? null : input.location.trim(),
      startsOn: input.startsOn === "" ? null : input.startsOn,
      endsOn: input.endsOn === "" ? null : input.endsOn,
      ...(category !== "" && isEntryCategory(category) ? { entryCategory: category } : {}),
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
        // The tier refusal carries its own sentence — the ceiling, the count and
        // what to do — because "that didn't work" on a commercial limit sends
        // the organizer looking for a bug that is not there.
        result.reason === "tier_limit"
          ? result.message
          : result.reason === "duplicate_name"
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
    return {
      ok: false,
      // A pass ceiling is not "that action isn't available for this
      // registration" — the registration is fine, the season is full. It
      // carries its own sentence naming the ceiling and what to do.
      error:
        result.reason === "tier_limit"
          ? result.message
          : "That action isn't available for this registration.",
    };
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
  /** The season is published, so `/c/[slug]` and the player pages exist. The
   *  status card links a player to their OWN public page, and must not offer a
   *  link to a page that does not exist yet. */
  listed: boolean;
  /** The season's public slug, for that link. */
  slug: string;
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
    listed: competition.listed,
    slug,
    mine,
  };
}

export interface RegistrationPreview {
  competitionName: string;
  open: boolean;
  /** PI-1: stated on the preview so nobody signs in to find out. */
  entryCategory: "open" | "men" | "women" | "mixed";
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
    entryCategory: facts.entryCategory,
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
/**
 * THE ROSTER IS THE ENGINE'S ONCE THE AUCTION STARTS (audit 2026-08-18, P2-3).
 *
 * `registrations.team_id` has two writers: this module (an organizer assigning
 * a player by hand) and the auction aggregate (a sale stamping the buyer). Team
 * CREATION was already locked once the auction leaves `scheduled`, but
 * ASSIGNMENT was not — so an organizer could move a player between squads while
 * the engine was selling them, and the engine's recovery pass, which heals
 * auctions/lots/bids/paddles against the event log, never touches team_id and
 * so could not put it back. The result is a roster that disagrees with the
 * ledger, silently, with money already committed against it.
 *
 * The same sentence the team lock uses, for the same reason.
 */
async function auctionLocksRoster(competitionId: string): Promise<boolean> {
  const auction = await auctionOf(systemDb, competitionId);
  return auction !== null && auction.status !== "scheduled";
}

const ROSTER_LOCKED = "The auction has started — squads are set by the auction now, not by hand.";

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
  // A player cannot withdraw themselves out from under a live auction: they may
  // already be a lot, or already sold and paid for.
  if (await auctionLocksRoster(competition.id)) {
    return {
      ok: false,
      error: "The auction has started — ask the organizer to withdraw you.",
    };
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
  /*
   * Consent is checked HERE, not only in the browser.
   *
   * The register flow gates its own Submit button, and a client gate is a
   * courtesy: it stops an honest mistake and nothing else. Approving this
   * registration publishes the person's name, role, age and photo on a page
   * anyone with the link can read, so the agreement to that has to be a fact
   * the server established, not one it was told about.
   */
  if (formString(formData, "publicationConsent") !== "true") {
    return { error: "Please confirm you understand what becomes public before you register." };
  }
  const role = formString(formData, "role");
  const profile = {
    dateOfBirth: formString(formData, "dateOfBirth"),
    battingStyle: formString(formData, "battingStyle"),
    bowlingStyle: formString(formData, "bowlingStyle"),
  };
  const minor = isMinor(profile.dateOfBirth === "" ? null : profile.dateOfBirth, new Date());
  const guardianName = formString(formData, "guardianName").trim();
  /*
   * ONE evaluator decides (PI-1 P3): intake, role, the PRR P0-2 minor gate
   * (DPDP §9 — a registrant under 18 is a child and needs a named guardian's
   * verifiable consent; the public read model additionally suppresses their
   * age and photo everywhere public), and the entry category against the
   * person's own profile. Enforced HERE as well as in the browser — a client
   * gate is a courtesy. The writer below keeps its own not_open/role checks
   * as defense-in-depth; the sentences for those two are unchanged.
   */
  const verdict = evaluateRegistration({
    competitionStatus: competition.status,
    entryCategory: competition.entryCategory,
    role,
    gender: (await playerProfileFor(session.personId)).gender,
    dateOfBirth: profile.dateOfBirth === "" ? null : profile.dateOfBirth,
    guardianConsent: formString(formData, "guardianConsent") === "true",
    guardianName,
    channel: "self",
    now: new Date(),
  });
  if (!verdict.eligible) {
    const reason = verdict.reasons[0];
    return {
      error:
        reason === "intake_closed"
          ? "Registration for this competition is not open."
          : reason === "minor_missing_guardian"
            ? "A parent or guardian must consent for a player under 18 — add their name and tick the consent box."
            : reason === "category_mismatch"
              ? "This season is listed as a gendered category that doesn't match your profile. If that's wrong, update your profile on the Account page — or contact the organizer, who can add you directly."
              : "Choose a valid playing role.",
    };
  }
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
  /*
   * Record what they agreed to, after the registration commits.
   *
   * Two rows, because they are two different agreements and conflating them
   * would make either one unanswerable later:
   *
   *   publication      — the checkbox they ticked, stored with the sentence
   *                      they actually read rather than a version number, so
   *                      the record survives this copy being rewritten.
   *   sms.transactional — they gave a mobile number in order to be told what
   *                      happens to this registration. That is the agreement,
   *                      and it is recorded rather than assumed.
   *
   * After the write, never before: a consent record for a registration that
   * failed is a claim about something that did not happen. And never fatal —
   * the registration has committed, and losing the evidence must not lose the
   * registration. It is logged as a gap instead.
   */
  /*
   * PI-1 write-back: "remember these answers" ticked means the season's
   * choices become the person-level defaults, so the NEXT form starts filled
   * in. A convenience after the fact — like consent evidence, it must never
   * fail the registration that already committed.
   */
  if (formString(formData, "rememberProfile") === "true") {
    try {
      const current = await playerProfileFor(session.personId);
      await upsertPlayerProfile(session.personId, {
        ...current,
        defaultRole: parseRole(role) ?? current.defaultRole,
        dateOfBirth: profile.dateOfBirth === "" ? current.dateOfBirth : profile.dateOfBirth,
        defaultBattingStyle:
          profile.battingStyle === "" ? current.defaultBattingStyle : profile.battingStyle,
        defaultBowlingStyle:
          profile.bowlingStyle === "" ? current.defaultBowlingStyle : profile.bowlingStyle,
      });
    } catch {
      // The profile is a convenience; the registration is the fact.
    }
  }
  try {
    const consentText = formString(formData, "publicationConsentText");
    await recordConsent(systemDb, {
      personId: session.personId,
      purpose: "publication",
      granted: true,
      source: "registration",
      evidence: {
        competition: slug,
        wording: consentText === "" ? null : consentText,
      },
    });
    await recordConsent(systemDb, {
      personId: session.personId,
      purpose: "sms.transactional",
      granted: true,
      source: "registration",
      evidence: {
        competition: slug,
        basis: "gave a mobile number to be told the outcome of this registration",
      },
    });
    // PRR P0-2: the guardian consent record for a minor — timestamped, with the
    // guardian's name and the wording actually shown, so "who consented, to
    // what, when" is answerable later (DPDP §9 verifiable-consent evidence).
    if (minor) {
      await recordConsent(systemDb, {
        personId: session.personId,
        purpose: "guardian.consent",
        granted: true,
        source: "registration",
        evidence: {
          competition: slug,
          guardianName,
          wording: formString(formData, "guardianConsentText") || null,
        },
      });
    }
  } catch {
    // Evidence must never be the thing that fails a registration that has
    // already committed — the same rule the decision notices follow.
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
  /**
   * PI-1: rows whose person's own declared gender is directly contrary to the
   * season's entry category — the ORGANIZER-channel advisory from the one
   * eligibility evaluator (invariant 5: it flags, the human decides). Only
   * declared opposites appear; an unanswered profile flags nothing, because a
   * women's-season import of new phone numbers would otherwise flag every row.
   * Review-gated like the rows it annotates. Keyed by registration id.
   */
  categoryFlags?: Record<string, "category_mismatch">;
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
    // PI-1: the organizer-channel category advisory, computed by THE evaluator
    // (never by a second SQL copy of its rules) over just this page's people.
    const categoryFlags: Record<string, "category_mismatch"> = {};
    if (competition.entryCategory !== "open" && page.rows.length > 0) {
      const genders = await db
        .select({ personId: playerProfiles.personId, gender: playerProfiles.gender })
        .from(playerProfiles)
        .where(
          inArray(
            playerProfiles.personId,
            page.rows.map((row) => row.personId),
          ),
        );
      const genderOf = new Map(genders.map((entry) => [entry.personId, entry.gender]));
      for (const row of page.rows) {
        const verdict = evaluateRegistration({
          competitionStatus: competition.status,
          entryCategory: competition.entryCategory,
          role: row.role,
          gender: genderOf.get(row.personId) ?? null,
          dateOfBirth: null,
          guardianConsent: false,
          guardianName: "",
          channel: "organizer",
          now: new Date(),
        });
        if (verdict.advisories.includes("category_mismatch")) {
          categoryFlags[row.id] = "category_mismatch";
        }
      }
    }
    return {
      competition,
      stats,
      page,
      teams,
      orphanIcons: orphans,
      registrationOpen: competition.status === "registration_open",
      viewer: { canReview },
      categoryFlags,
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
  return inCompetitionOrg(gate.personId, gate.competition, (db) =>
    timelineOf(db, registrationId, gate.competition.id),
  );
}

/**
 * PI-1: "seen before in your club" — the person's other seasons IN THIS ORG,
 * for the triage drawer (duplicate-spotting and welcome-back context). Review-
 * gated like everything else in the drawer; scoped to the org's own records,
 * so an organizer learns nothing about a person's life in other clubs.
 */
export async function personHistoryAction(
  slug: string,
  registrationId: string,
): Promise<{ competitionName: string; startsOn: string | null; status: string }[]> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return [];
  }
  const personId = await inCompetitionOrg(gate.personId, gate.competition, async (db) => {
    const [row] = await db
      .select({ personId: registrations.personId })
      .from(registrations)
      .where(
        and(
          eq(registrations.id, registrationId),
          eq(registrations.competitionId, gate.competition.id),
        ),
      )
      .limit(1);
    return row?.personId ?? null;
  });
  if (personId === null) {
    return [];
  }
  return personSeasonsInOrg(personId, gate.competition.orgId, gate.competition.id);
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
  if (await auctionLocksRoster(competition.id)) {
    return { ok: false, error: ROSTER_LOCKED };
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
  // Only the marks that move the pool freeze with it — see `marksFreezeWithRoster`.
  if (marksFreezeWithRoster(marks) && (await auctionLocksRoster(competition.id))) {
    return { ok: false, error: ROSTER_LOCKED };
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
  /**
   * What committing would actually DO, against what is already stored. Absent
   * only when the file could not be read at all.
   *
   * The second upload of a roster is the normal case, and before this the
   * preview could not tell "197 players" from "197 players you already have" —
   * it reported the same number either way and the commit then silently did
   * nothing with them.
   */
  diff?: {
    counts: { new: number; changed: number; unchanged: number; reinstate: number };
    /** The changed rows, so the organizer sees old → new before committing. */
    changes: {
      line: number;
      name: string;
      fields: { label: string; from: string; to: string }[];
    }[];
  };
}

/*
 * A BOUND ON WHAT ARRIVES.
 *
 * The file rides to the server as a STRING in a server-action payload and is
 * held in memory whole, twice — once as text, once tokenized. Nothing capped
 * it: a pasted spreadsheet with a runaway range was a memory event on a 4 GB
 * container rather than a message anybody could act on. The limits are far
 * above any real season (the largest tournament this product has run is in the
 * low hundreds) and exist only to turn an accident into a sentence.
 */
const MAX_IMPORT_BYTES = 2_000_000;
const MAX_IMPORT_ROWS = 5_000;

/** The refusal message, or null when the file is within bounds. */
function oversized(csv: string): string | null {
  const bytes = new TextEncoder().encode(csv).length;
  if (bytes > MAX_IMPORT_BYTES) {
    return `That file is ${String(Math.round(bytes / 1000))} KB — the limit is ${String(
      MAX_IMPORT_BYTES / 1000,
    )} KB. Split it and import in parts.`;
  }
  // Cheap upper bound: every row occupies at least one line. Counting lines is
  // not counting records (a quoted field may contain newlines), which is fine —
  // it can only over-estimate, and it happens before the expensive tokenize.
  const lines = csv.split("\n").length;
  if (lines > MAX_IMPORT_ROWS) {
    return `That file has about ${String(lines)} rows — the limit is ${String(
      MAX_IMPORT_ROWS,
    )}. Split it and import in parts.`;
  }
  return null;
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

/**
 * What the mapping screen needs to draw itself: the file's own headers, a real
 * sample value under each, and our best guess at where each column goes.
 *
 * Reading a file is not writing one, but it IS reading a roster of civilians'
 * names and phone numbers — so it sits behind the same review gate as the
 * import it precedes.
 */
export interface ImportInspection {
  ok: boolean;
  error?: string;
  headers: string[];
  /** First row carrying data, aligned to `headers`. */
  sample: string[];
  detected?: DetectedMapping;
  /** Fingerprint of this file's layout, for recognising the form again. */
  signature: string;
  /** Bands this competition accepts — the value-mapping targets for a band. */
  bands: string[];
  /**
   * A mapping this club already confirmed for a file of this exact layout —
   * the season's own override if there is one, else the org default. Present
   * means the screen opens on "using your saved mapping" instead of a guess.
   */
  saved?: SavedMapping;
}

export async function importInspectAction(slug: string, csv: string): Promise<ImportInspection> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error, headers: [], sample: [], signature: "", bands: [] };
  }
  const tooBig = oversized(csv);
  if (tooBig !== null) {
    return { ok: false, error: tooBig, headers: [], sample: [], signature: "", bands: [] };
  }
  const records = tokenizeCsv(csv);
  const headers = [...(records[0] ?? [])];
  if (headers.length === 0) {
    return {
      ok: false,
      error: "That file has no header row.",
      headers: [],
      sample: [],
      signature: "",
      bands: [],
    };
  }
  const signature = signatureOf(headers);
  const saved = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    savedMappingFor(db, gate.competition.orgId, gate.competition.id, signature),
  );
  return {
    ok: true,
    headers,
    sample: sampleRow(records),
    detected: detectMapping(headers),
    signature,
    bands: [...(await bandsFor(gate.competition.id))],
    ...(saved !== null ? { saved } : {}),
  };
}

/**
 * Remember a confirmed mapping for next season.
 *
 * `scope` is the organizer's own choice and defaults to the CLUB, because a
 * club reuses one form across seasons — that repetition is the whole point.
 * "season" writes an override for this competition alone.
 */
export async function saveImportMappingAction(
  slug: string,
  input: {
    signature: string;
    label: string | null;
    mapping: ColumnMapping;
    valueMaps: ValueMaps;
    dateOrder: DateOrder;
    scope: "org" | "season";
  },
): Promise<{ ok: boolean; error?: string }> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  if (Object.keys(input.mapping).length === 0 || input.signature === "") {
    return { ok: false, error: "There is no mapping to remember." };
  }
  await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    saveImportMapping(db, gate.competition.orgId, gate.personId, {
      competitionId: input.scope === "season" ? gate.competition.id : null,
      signature: input.signature,
      label: input.label,
      mapping: input.mapping,
      valueMaps: input.valueMaps,
      dateOrder: input.dateOrder,
    }),
  );
  return { ok: true };
}

/** Drop a saved mapping — the way out of one that turned out to be wrong. */
export async function forgetImportMappingAction(
  slug: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    forgetImportMapping(db, gate.competition.orgId, id),
  );
  return { ok: true };
}

/** How the organizer decided this file should be read. */
export interface ImportShape {
  mapping?: ColumnMapping;
  valueMaps?: ValueMaps;
  /** Which number leads an ambiguous numeric date in THIS file. */
  dateOrder?: DateOrder;
  /** How to treat a value the file and the record disagree about. */
  policy?: ImportPolicy;
}

/**
 * Parse under the organizer's mapping, or straight if there is none.
 *
 * NO MAPPING IS NOT A BROKEN MAPPING. A file whose headers are already ours
 * (our own export, round-tripped) needs no translation and must keep working
 * untouched — so an absent mapping means "read it as written", not "guess".
 */
function parseUnderShape(
  csv: string,
  bands: readonly string[],
  shape: ImportShape | undefined,
): ReturnType<typeof parseRegistrationRecords> {
  const records = tokenizeCsv(csv);
  const mapping = shape?.mapping;
  const source =
    mapping === undefined || Object.keys(mapping).length === 0
      ? records
      : applyMapping(records, mapping, shape?.valueMaps);
  return parseRegistrationRecords(source, bands, {
    now: new Date(),
    ...(shape?.dateOrder !== undefined ? { dateOrder: shape.dateOrder } : {}),
  });
}

/** Validate only — no writes. The organizer previews errors before committing. */
export async function importPreviewAction(
  slug: string,
  csv: string,
  shape?: ImportShape,
): Promise<ImportPreview> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { validCount: 0, errors: [{ line: 1, message: gate.error }] };
  }
  const tooBig = oversized(csv);
  if (tooBig !== null) {
    return { validCount: 0, errors: [{ line: 1, message: tooBig }] };
  }
  const result = parseUnderShape(csv, await bandsFor(gate.competition.id), shape);
  if (result.rows.length === 0) {
    return { validCount: 0, errors: result.errors };
  }
  const policy = shape?.policy ?? "fill-blanks";
  const diff = await inCompetitionOrg(gate.personId, gate.competition, async (db) => {
    const stored = await existingForImport(
      db,
      gate.competition.id,
      result.rows.map((row) => row.phone),
    );
    return planImport(result.rows, stored, policy);
  });
  return {
    validCount: result.rows.length,
    errors: result.errors,
    diff: {
      counts: diff.counts,
      // Capped for the screen; the counts above are the whole truth and the
      // note under the table says how many are not listed.
      changes: diff.rows
        .filter((entry) => entry.plan.kind === "changed" || entry.plan.kind === "reinstate")
        .slice(0, 25)
        .map((entry) => ({
          line: entry.line,
          name: entry.name,
          fields:
            entry.plan.kind === "changed" || entry.plan.kind === "reinstate"
              ? entry.plan.changes.map((c) => ({
                  label: c.label,
                  from: c.from ?? "(blank)",
                  to: c.to,
                }))
              : [],
        })),
    },
  };
}

export interface ImportCommitResult {
  ok: boolean;
  imported?: number;
  /** Existing registrations the file CHANGED — the second-file case. */
  updated?: number;
  /** Existing registrations the file agreed with entirely. */
  unchanged?: number;
  reinstated?: number;
  named?: number;
  /** Rows left behind because they had errors (only when `skipInvalid`). */
  skipped?: number;
  error?: string;
}

/**
 * Re-validate and commit atomically.
 *
 * ALL-OR-NOTHING WAS THE WRONG DEFAULT AT THE WRONG MOMENT. Refusing a file
 * with any error protects against partial corruption, which is right — but it
 * was also the only option, and combined with the strict role vocabulary it
 * meant an ordinary 200-player sheet imported NOBODY over three misspelt cells.
 * `skipInvalid` keeps the guarantee where it matters (every row that lands is a
 * row that fully validated, and the commit is still one transaction) while
 * letting the organizer take the 197 and fix the 3. The rows left behind are
 * still listed by line number, so "skip" never means "forget".
 */
export async function importCommitAction(
  slug: string,
  csv: string,
  options?: { skipInvalid?: boolean; shape?: ImportShape; policy?: ImportPolicy },
): Promise<ImportCommitResult> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const tooBig = oversized(csv);
  if (tooBig !== null) {
    return { ok: false, error: tooBig };
  }
  // Re-parsed under the SAME shape the preview used — the commit never trusts a
  // row list the browser sent, only the file plus the mapping it approved.
  const parsed = parseUnderShape(csv, await bandsFor(gate.competition.id), options?.shape);
  if (parsed.errors.length > 0 && options?.skipInvalid !== true) {
    return {
      ok: false,
      error: `Fix ${String(parsed.errors.length)} row error(s) before importing.`,
    };
  }
  if (parsed.rows.length === 0) {
    return { ok: false, error: "No valid rows to import." };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    commitRegistrationImport(
      db,
      gate.competition.id,
      gate.competition.orgId,
      gate.personId,
      parsed.rows,
      options?.shape?.policy ?? options?.policy ?? "fill-blanks",
    ),
  );
  return {
    ok: true,
    imported: result.imported,
    updated: result.updated,
    unchanged: result.unchanged,
    reinstated: result.reinstated,
    named: result.named,
    skipped: parsed.errors.length,
  };
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
