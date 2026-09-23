"use server";

import {
  NAME_MAX_LENGTH,
  DEFAULT_AUCTION_CONFIG,
  applyMapping,
  detectMapping,
  evaluateRegistration,
  isEntryCategory,
  isMinor,
  rejectionEvent,
  parseRegistrationRecords,
  planImport,
  sampleRow,
  signatureOf,
  slugifyName,
  tokenizeCsv,
  validateNewPlayer,
  IMPORT_FIELDS,
  isFeeStatus,
  type FeeStatus,
  type ColumnMapping,
  type CsvRowError,
  type DateOrder,
  type DetectedMapping,
  type ImportPolicy,
  type PhotoTarget,
  type PlayerField,
  type RegistrationEvent,
  type RegistrationStatus,
  parseRoleIn,
  sportPackFor,
  splitAttributeWrite,
  unplacedValues,
  type UnplacedValue,
  type ValueMaps,
  type Capability,
} from "@desiauction/core";
import {
  people,
  playerProfiles,
  registrations,
  teams as teamsTable,
  withTenantDb,
  type Db,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { cache } from "react";

import { auctionOf } from "@desiauction/auction";
import { recordConsent } from "../messaging/consent";
import { logger } from "../logger";

import { currentSession } from "../auth/actions";
import {
  playerProfileFor,
  sportProfileFor,
  upsertPlayerProfile,
  upsertSportProfile,
} from "../player/profile";
import { personSeasonsInOrg } from "../player/career";
import { dbHandle } from "../db";
import { ForbiddenError } from "../orgs/authz";
import { canSettlement } from "../settlement/authz";
import { orgsFor } from "../orgs/orgs";
import { canCompetition, requireCompetitionCapability } from "./authz";
import {
  advanceCompetition,
  cloneCompetition,
  createCompetition,
  createTeam,
  holdBlocker,
  publishBlockers,
  setCompetitionVisibility,
  setTeamCoach,
  updateTeamDetails,
  tournamentsOf,
  teamsOf,
  updateCompetitionDetails,
  type CompetitionSummary,
  type PublishBlocker,
  type SeasonListing,
  type TeamSummary,
} from "./competitions";
import {
  memberCompetitions,
  publicCompetitionBySlug,
  publicRegistrationFactsBySlug,
  resolveMemberCompetition,
} from "./resolve";
import { isSportEnabled } from "./sports";
import {
  addNote,
  assignTeam,
  setRegistrationMarks,
  transition,
  transitionBatch,
  updateRegistrationDetails,
} from "./registration-aggregate";
import {
  planRegistrationEdit,
  type EditableField,
  type RegistrationEditInput,
} from "./registration-edit";
import { playerDeskContext, type PlayerDeskContext } from "./player-desk";
import { setWhatsappOptIn } from "../messaging/whatsapp";
import type { ExportRows } from "../../lib/export-columns";
import { captainLockRefusal } from "./captain-lock";
import { captainRefusalMessage, marksFreezeWithRoster, squadMarksIn } from "./roster-lock";
import {
  CaptainImportRefused,
  commitRegistrationImport,
  existingForImport,
} from "./registration-import";
import {
  forgetImportMapping,
  saveImportMapping,
  savedMappingFor,
  type SavedMapping,
} from "./import-mappings";
import { notifyDecision } from "./registration-notify";
import { seasonOverview, type SeasonOverview } from "./season-overview";
import { teamsWorkspace, workspaceSightFor, type TeamsWorkspace } from "./team-workspace";
import {
  addPlayerByPhone,
  exportRegistrationsCsv,
  myRegistration,
  kitSummary,
  orphanPreSigned,
  photoTargetsOf,
  queryRegistrations,
  recordRegistrationExport,
  registrationRowById,
  registrationStats,
  registrationsOf,
  submitRegistration,
  timelineOf,
  type KitSummary,
  type OrphanPreSigned,
  type RegistrationPage,
  type RegistrationQuery,
  type RegistrationRow,
  type RegistrationSort,
  type RegistrationStats,
  type TimelineEntry,
} from "./registrations";
import { seasonHoldOf, type SeasonHold } from "../moderation/season-hold";
import { orgsOfPerson } from "../request-cache";

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

/** Membership-gated slug → competition — the pre-tenant read lives in `resolve.ts`. */
async function resolveCompetitionScoped(
  personId: string,
  slug: string,
): Promise<CompetitionSummary | null> {
  return resolveMemberCompetition(personId, slug);
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
  competitions: SeasonListing[];
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
    orgsOfPerson(session.personId),
    // Cross-org union scoped by the membership join (see `resolve.ts`).
    memberCompetitions(session.personId),
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
export type CompetitionFormField = "name" | "orgId" | "endsOn" | "sport" | "form";

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
  const sport = formString(formData, "sport");
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
  /*
   * The sport arrives from a select, which is a SUGGESTION — a form post is
   * whatever the poster sent. The foreign key already refuses a sport with no
   * pack behind it; this refuses one whose pack shipped but is switched off,
   * which the database cannot know. Empty is allowed and takes the column
   * default (cricket) while that default is still true.
   */
  if (sport === "" || !(await isSportEnabled(sport))) {
    return { error: "Pick a sport this platform currently runs.", field: "sport" };
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
          sport,
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
  /** Whether DesiAuction has taken the public page down (0072). Managers only. */
  platformHold: SeasonHold | null;
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
    const [overview, hold] = await Promise.all([
      seasonOverview(db, competition, { money: canSeeMoney }),
      // The reason is addressed to the people who run the season, not to every
      // member — gate the data, not the button.
      canManage ? seasonHoldOf(db, competition.id) : Promise.resolve(null),
    ]);
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
      publishBlockers:
        hold === null
          ? publishBlockers(competition)
          : [holdBlocker(hold.reason), ...publishBlockers(competition)],
      platformHold: hold,
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
  return teamsWorkspaceViewOnce(slug);
}

/**
 * Once per request: the Teams page and its `@action` slot (the "+ Add team"
 * button, which needs the lock and the colours already taken) render in the
 * same request and ask the same question.
 */
const teamsWorkspaceViewOnce = cache(async (slug: string): Promise<TeamsWorkspaceView | null> => {
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
    // RN-1 §7: the rule is a pure function so the whole matrix can be asserted
    // without a browser — see `workspaceSightFor` and its test.
    const { money: canSeeMoney, roster: canSeeRoster } = workspaceSightFor({
      canManage,
      canSettle,
      canReview,
      canConduct,
    });
    const workspace = await teamsWorkspace(db, competition, {
      money: canSeeMoney,
      roster: canSeeRoster,
    });
    return {
      ...workspace,
      viewer: { canManage, canManageTeams, canConduct, canSeeMoney, canSeeRoster },
    };
  });
});

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
    // A platform hold first: 0072's CHECK would refuse the write anyway, but as
    // a constraint violation inside the tenant transaction — this says why.
    const hold = await inCompetitionOrg(session.personId, competition, (db) =>
      seasonHoldOf(db, competition.id),
    );
    if (hold !== null) {
      return { ok: false, error: holdBlocker(hold.reason).message };
    }
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
  const auction = await inCompetitionOrg(session.personId, competition, (db) =>
    auctionOf(db, competition.id),
  );
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

/**
 * WHAT "OTHER" MEANT, which until now was recorded nowhere.
 *
 * The rule itself is `rejectionEvent` in core, beside the event type that has
 * declared `note?: string` all along — this module is `"use server"`, so a
 * helper here could never be unit-tested. See that function for why `other`
 * demands a note and the other four do not.
 *
 * INVARIANT 6 is not enforced here but where the projections are built: the
 * player's own read model (`myRegistration`) does not select the column, and
 * `registration-ops.regression.test.ts` holds it absent.
 */
function triageEvent(
  action: TriageAction,
  reason?: string,
  note?: string,
): RegistrationEvent | { error: string } {
  if (action !== "reject") {
    return { type: action };
  }
  const built = rejectionEvent(reason ?? "", note);
  return built.ok ? built.event : { error: built.error };
}

export async function triageRegistrationAction(
  slug: string,
  registrationId: string,
  action: TriageAction,
  reason?: string,
  /** Organizer-only. Never reaches the player — invariant 6. */
  note?: string,
): Promise<{ ok: boolean; error?: string; notifying?: number }> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const event = triageEvent(action, reason, note);
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
  return { ok: true, notifying: notifyLater(gate, [registrationId], event) };
}

/**
 * THE DECISION RETURNS BEFORE THE TEXT MESSAGES GO.
 *
 * The SMS loop used to run inside the request: one provider round trip, one
 * consent read and one audit write per person, serially, before the organizer's
 * button stopped spinning. Approving thirty players took as long as thirty
 * texts, and a slow provider made the whole desk feel hung — the "sometimes
 * saving takes forever" report. The transition has committed by this line, so
 * delivery was never part of the decision; it now runs after the response.
 *
 * Honesty is kept where it can be read: every outcome (sent, failed,
 * suppressed) is still written to the registration's timeline by
 * `notifyDecision`, and the count returned here is how many people we are
 * about to text, never a claim that they were reached.
 */
function notifyLater(
  gate: { personId: string; competition: CompetitionSummary },
  registrationIds: readonly string[],
  event: RegistrationEvent,
): number {
  if (registrationIds.length === 0 || event.type === "submit") {
    return 0;
  }
  after(async () => {
    const notice = await notifyAffected(gate, registrationIds, event);
    if ((notice.notifyFailed ?? 0) > 0) {
      logger().warn(
        {
          competitionId: gate.competition.id,
          failed: notice.notifyFailed,
          sent: notice.notified,
          event: event.type,
        },
        "registration decision notices partly failed",
      );
    }
  });
  return registrationIds.length;
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
  /** Organizer-only, and one note for the whole batch. Invariant 6. */
  note?: string,
): Promise<{
  ok: boolean;
  applied?: number;
  skipped?: number;
  /** How many people will be texted — see `notifyLater`. */
  notifying?: number;
  error?: string;
}> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const event = triageEvent(action, reason, note);
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
  return {
    ok: true,
    applied: result.applied.length,
    skipped: result.skipped.length,
    notifying: notifyLater(gate, result.applied, event),
  };
}

// --- Player-facing registration (any authenticated person) -------------------

export interface RegistrationLanding {
  competitionName: string;
  /** The season's sport, so the form prefills from the right profile (Phase 3). */
  sport: string;
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
    role: string | null;
    number: string;
    rejectionReason: string | null;
  } | null;
}

export async function registrationLanding(slug: string): Promise<RegistrationLanding | null> {
  const session = await requireSession();
  // Public landing lookup (documented no-membership read) — system pool.
  const competition = await publicCompetitionBySlug(slug);
  if (competition === null) {
    return null;
  }
  // Own-registration read rides the person arm of the registrations policy.
  const mine = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    myRegistration(db, competition.id, session.personId),
  );
  return {
    competitionName: competition.name,
    sport: competition.sport,
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
  const facts = await publicRegistrationFactsBySlug(slug);
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
async function auctionLocksRoster(
  personId: string,
  competition: { id: string; orgId: string },
): Promise<boolean> {
  // Inside the season's own boundary. For the one caller who is a PLAYER rather
  // than a member (withdrawing themselves) that is still correct: the server
  // resolved the season from the public link and opens its org's boundary to
  // read one fact about it, exactly as `submitRegistration` does to write.
  const auction = await inCompetitionOrg(personId, competition, (db) =>
    auctionOf(db, competition.id),
  );
  return auction !== null && auction.status !== "scheduled";
}

const ROSTER_LOCKED = "The auction has started — squads are set by the auction now, not by hand.";

export async function withdrawMyRegistrationAction(
  slug: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const competition = await publicCompetitionBySlug(slug);
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
  if (await auctionLocksRoster(session.personId, competition)) {
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
  const competition = await publicCompetitionBySlug(slug);
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
  /*
   * THE SEASON'S SPORT DECIDES WHAT ELSE IS ASKED (SP-1 Phase 3).
   *
   * This read two fixed fields — `battingStyle` and `bowlingStyle` — so a
   * football registration's answers had no field to arrive in, and
   * `registrations.attributes` (the column the pack contract names as the home
   * of every sport after cricket) had no writer anywhere in the product.
   *
   * The form now posts one `attr.<key>` per attribute the pack declares. Read
   * back the same way: by asking the PACK what it declared, never by trusting
   * the keys that turned up in the request.
   */
  const packForSeason = sportPackFor(competition.sport);
  const attributeAnswers: Record<string, string> = {};
  for (const attribute of packForSeason.attributes) {
    const value = formString(formData, `attr.${attribute.key}`);
    if (value !== "") {
      attributeAnswers[attribute.key] = value;
    }
  }
  const profile = {
    dateOfBirth: formString(formData, "dateOfBirth"),
    attributes: attributeAnswers,
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
    // The season's own sport decides what a role is. Judged against cricket,
    // this refused every football, kabaddi and volleyball player at the door.
    sport: competition.sport,
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
  const consentText = formString(formData, "publicationConsentText");
  const guardianWording = formString(formData, "guardianConsentText");
  // Phase 3: WhatsApp instead of SMS. Only a tick records anything — leaving
  // it unticked is not a withdrawal of a yes given on /account.
  const whatsappOptIn = formString(formData, "whatsappOptIn") === "true";
  /*
   * THE REGISTRATION AND WHAT THE PERSON AGREED TO COMMIT TOGETHER, OR NOT AT ALL.
   *
   * The consent rows used to be written AFTER this transaction, through the
   * system pool, inside a catch that swallowed every failure. Under the
   * production role recipe `desiauction_system` holds no INSERT on
   * `consent_records` (ops/db/create-app-role.sql), so that write failed on
   * every registration and the catch hid it: players — minors among them —
   * were entered, approved and auctioned with no publication consent, no SMS
   * consent and no guardian consent on record, while every local suite, which
   * connects as the database owner, stayed green.
   *
   * Written here instead, in the same tenant transaction as the row they are
   * about, on the app role that can write them. A consent record for a
   * registration that failed cannot exist (it rolls back with it), and a
   * registration without its consent record cannot exist either — which for a
   * child's guardian consent (DPDP §9) is the only acceptable pairing.
   */
  let result: Awaited<ReturnType<typeof submitRegistration>>;
  try {
    result = await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId: competition.orgId },
      async (db) => {
        const entered = await submitRegistration(
          db,
          competition.id,
          competition.orgId,
          session.personId,
          role,
          undefined,
          profile,
          source,
        );
        if (entered.ok) {
          await recordRegistrationConsents(db, {
            personId: session.personId,
            slug,
            publicationWording: consentText === "" ? null : consentText,
            guardian: minor ? { name: guardianName, wording: guardianWording || null } : null,
          });
          if (whatsappOptIn) {
            await setWhatsappOptIn(db, {
              personId: session.personId,
              granted: true,
              source: "registration",
              competition: slug,
            });
          }
        }
        return entered;
      },
    );
  } catch (error) {
    logger().error(
      { err: error, competitionId: competition.id, personId: session.personId },
      "registration.submit_failed",
    );
    return { error: "We couldn't save your registration just now. Please try again." };
  }
  if (!result.ok) {
    return {
      error:
        result.reason === "not_open"
          ? "Registration for this competition is not open."
          : result.reason === "duplicate"
            ? "You've already registered for this competition — check your status."
            : result.reason === "no_phone"
              ? // The register page says this before the form is ever shown; this
                // is the same rule held at the server, for the request that
                // skipped the page.
                "Add a mobile number to your account before registering as a player — organizers text you about your registration and on auction day."
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
   * Written in the SAME transaction as the registration — see the note at the
   * write above for why "after, and never fatal" was the wrong rule: under the
   * production roles it meant "never".
   */
  /*
   * PI-1 write-back: "remember these answers" ticked means the season's
   * choices become the person-level defaults, so the NEXT form starts filled
   * in. A convenience after the fact — like consent evidence, it must never
   * fail the registration that already committed.
   */
  if (formString(formData, "rememberProfile") === "true") {
    try {
      /*
       * Two writes, because the answer splits in two (Phase 3): the date of
       * birth is true of the PERSON whatever they play, while the role and the
       * styles are true of them in THIS SEASON'S SPORT. Remembering a football
       * role onto their cricket profile is exactly the bug this phase removes.
       */
      const current = await playerProfileFor(session.personId);
      await upsertPlayerProfile(session.personId, {
        ...current,
        dateOfBirth: profile.dateOfBirth === "" ? current.dateOfBirth : profile.dateOfBirth,
      });
      const pack = packForSeason;
      const held = await sportProfileFor(session.personId, pack.key);
      // Every answer the pack recognises, not the two cricket happens to have.
      // `splitAttributeWrite` is the same validator the registration row uses,
      // so a value good enough to store is good enough to remember.
      const write = splitAttributeWrite(pack, profile.attributes);
      const attributes = { ...held.attributes, ...write.json };
      for (const attribute of pack.attributes) {
        if (attribute.storage.kind !== "column") {
          continue;
        }
        const value = write.columns[attribute.storage.column];
        if (value !== undefined) {
          attributes[attribute.key] = value;
        }
      }
      await upsertSportProfile(session.personId, {
        sport: pack.key,
        defaultRole: parseRoleIn(pack, role) ?? held.defaultRole,
        attributes,
      });
    } catch {
      // The profile is a convenience; the registration is the fact.
    }
  }
  return { done: true };
}

/**
 * The consent rows a self-registration creates, on the transaction it rides.
 *
 * Three agreements, each its own row, because each answers a different
 * question later: what they agreed would be PUBLISHED (with the sentence they
 * read, not a version number), that they gave a number to be TEXTED about this
 * registration, and — for a player under 18 — which guardian consented, in
 * what words (PRR P0-2, DPDP §9 verifiable-consent evidence).
 */
async function recordRegistrationConsents(
  db: Db,
  input: {
    personId: string;
    slug: string;
    publicationWording: string | null;
    guardian: { name: string; wording: string | null } | null;
  },
): Promise<void> {
  await recordConsent(db, {
    personId: input.personId,
    purpose: "publication",
    granted: true,
    source: "registration",
    evidence: { competition: input.slug, wording: input.publicationWording },
  });
  await recordConsent(db, {
    personId: input.personId,
    purpose: "sms.transactional",
    granted: true,
    source: "registration",
    evidence: {
      competition: input.slug,
      basis: "gave a mobile number to be told the outcome of this registration",
    },
  });
  if (input.guardian !== null) {
    await recordConsent(db, {
      personId: input.personId,
      purpose: "guardian.consent",
      granted: true,
      source: "registration",
      evidence: {
        competition: input.slug,
        guardianName: input.guardian.name,
        wording: input.guardian.wording,
      },
    });
  }
}

// --- Registration operations dashboard (M-IP3-2) -----------------------------

export interface DashboardParams {
  search?: string;
  status?: string;
  /** A fee state — the desk's own filter. */
  fee?: string;
  teamId?: string;
  /** A playing role — the pack's key. */
  role?: string;
  sort?: string;
  page?: string;
}

/**
 * The dashboard's filter from its URL parameters — ONE parser for the page, its
 * "select all matching" and its "export this view", so the three cannot answer
 * "who matches?" three ways. (Select-all used to drop the fee filter, so with
 * "Not paid" on screen it selected the paid players too.)
 */
function dashboardFilter(
  params: DashboardParams,
): Omit<RegistrationQuery, "page" | "pageSize" | "sort" | "registrationId"> {
  return {
    ...(params.search !== undefined && params.search !== "" ? { search: params.search } : {}),
    ...(params.status !== undefined && VALID_STATUS.has(params.status as RegistrationStatus)
      ? { status: params.status as RegistrationStatus }
      : {}),
    // Validated against the enum rather than passed through: the value reaches
    // a `where` clause, and an unknown one should narrow to nothing rather than
    // quietly widening to everything.
    ...(isFeeStatus(params.fee ?? "") ? { fee: params.fee as FeeStatus } : {}),
    ...(params.teamId !== undefined && params.teamId !== "" ? { teamId: params.teamId } : {}),
    // Compared for equality in SQL, so an unknown role narrows to nobody.
    ...(params.role !== undefined && params.role !== "" ? { role: params.role } : {}),
  };
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
  orphanPreSigned?: OrphanPreSigned[];
  /** What to order, once somebody has recorded sizes. Review-gated. */
  kit?: KitSummary;
  teams?: TeamSummary[];
  /** Drives the closed-intake notice on the share block (DA-35). */
  registrationOpen: boolean;
  /**
   * `canManage` — `competition.manage`, which `advanceCompetitionAction`
   * enforces: the desk offers "Reopen registration" only to whoever may.
   * Present only past the review gate.
   */
  viewer: { canReview: boolean; canManage?: boolean };
  /**
   * PI-1: rows whose person's own declared gender is directly contrary to the
   * season's entry category — the ORGANIZER-channel advisory from the one
   * eligibility evaluator (invariant 5: it flags, the human decides). Only
   * declared opposites appear; an unanswered profile flags nothing, because a
   * women's-season import of new phone numbers would otherwise flag every row.
   * Review-gated like the rows it annotates. Keyed by registration id.
   */
  categoryFlags?: Record<string, "category_mismatch">;
  /** What the player sheet needs about the season — review-gated. */
  desk?: PlayerDeskContext;
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
    ...dashboardFilter(params),
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
    const [stats, page, teams, orphans, kit, desk, canManage] = await Promise.all([
      registrationStats(db, competition.id),
      queryRegistrations(db, competition.id, query),
      teamsOf(db, competition.id),
      orphanPreSigned(db, competition.id),
      kitSummary(db, competition.id),
      playerDeskContext(db, session.personId, competition),
      canCompetition(db, session.personId, scope, "competition.manage"),
    ]);
    // PI-1: the organizer-channel category advisory, computed by THE evaluator
    // (never by a second SQL copy of its rules) over just this page's people.
    const categoryFlags: Record<string, "category_mismatch"> = {};
    // Rows the organizer typed a name for are skipped: their profile gender
    // belongs to an account the club only knows by a phone number (0075).
    const evaluable = page.rows.filter((row) => !row.typedName);
    if (competition.entryCategory !== "open" && evaluable.length > 0) {
      const genders = await db
        .select({ personId: playerProfiles.personId, gender: playerProfiles.gender })
        .from(playerProfiles)
        .where(
          inArray(
            playerProfiles.personId,
            evaluable.map((row) => row.personId),
          ),
        );
      const genderOf = new Map(genders.map((entry) => [entry.personId, entry.gender]));
      for (const row of evaluable) {
        const verdict = evaluateRegistration({
          competitionStatus: competition.status,
          entryCategory: competition.entryCategory,
          sport: competition.sport,
          role: row.role ?? "",
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
      orphanPreSigned: orphans,
      kit,
      registrationOpen: competition.status === "registration_open",
      viewer: { canReview, canManage },
      categoryFlags,
      desk,
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
        ...dashboardFilter(params),
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

/**
 * ONE TRANSACTION PER SAVE.
 *
 * A mark used to cost three tenant transactions before it wrote anything — the
 * capability read, then the auction-lock read, then the write — each its own
 * BEGIN / set_config / COMMIT. The checks and the write now share one boundary,
 * which is also the more correct shape: the lock cannot change between being
 * read and being relied on.
 */
async function inSeasonAs<T>(
  slug: string,
  capability: Capability,
  fn: (ctx: { db: Db; personId: string; competition: CompetitionSummary }) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; reason: "not_found" | "forbidden" }> {
  const session = await requireSession();
  const competition = await resolveCompetitionScoped(session.personId, slug);
  if (competition === null) {
    return { ok: false, reason: "not_found" };
  }
  try {
    const value = await inCompetitionOrg(session.personId, competition, async (db) => {
      await requireCompetitionCapability(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        capability,
      );
      return fn({ db, personId: session.personId, competition });
    });
    return { ok: true, value };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, reason: "forbidden" };
    }
    throw error;
  }
}

/** `auctionLocksRoster`, read inside a boundary the caller already holds. */
async function rosterLockedIn(db: Db, competitionId: string): Promise<boolean> {
  const auction = await auctionOf(db, competitionId);
  return auction !== null && auction.status !== "scheduled";
}

export async function assignTeamAction(
  slug: string,
  registrationId: string,
  teamId: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await inSeasonAs(slug, "team.manage", async ({ db, personId, competition }) => {
    if (await rosterLockedIn(db, competition.id)) {
      return "locked" as const;
    }
    await assignTeam(
      db,
      competition.orgId,
      competition.id,
      registrationId,
      teamId === "" ? null : teamId,
      personId,
    );
    return "done" as const;
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.reason === "forbidden" ? "You can't assign teams here." : "Not available.",
    };
  }
  return result.value === "locked" ? { ok: false, error: ROSTER_LOCKED } : { ok: true };
}

/**
 * Set icon / retained / captain / team marks on a registration (organizer,
 * `team.manage`). All three marks pre-sign a player to their team and take them
 * out of the auction pool — an Icon because the organizer named them marquee,
 * a Captain because the team picked its leader before the night, a retained
 * player because they were kept from a prior season.
 */
export async function markRegistrationAction(
  slug: string,
  registrationId: string,
  marks: { isIcon?: boolean; isRetained?: boolean; isCaptain?: boolean; teamId?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const result = await inSeasonAs(slug, "team.manage", async ({ db, personId, competition }) => {
    const auction = await auctionOf(db, competition.id);
    if (auction !== null && auction.status !== "scheduled") {
      // Only the marks that move the pool freeze with it — see `marksFreezeWithRoster`.
      if (marksFreezeWithRoster(marks)) {
        return { ok: false as const, reason: "locked" as const };
      }
      // The armband is judged per player — see `captainChangeRefusal`.
      if (marks.isCaptain !== undefined) {
        const refusal = await captainLockRefusal(db, auction.id, registrationId, marks.isCaptain);
        if (refusal !== null) {
          return { ok: false as const, reason: "captain" as const, refusal };
        }
      }
    }
    return setRegistrationMarks(
      db,
      competition.orgId,
      competition.id,
      registrationId,
      marks,
      personId,
    );
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.reason === "forbidden" ? "You can't manage players here." : "Not available.",
    };
  }
  if (!result.value.ok) {
    return {
      ok: false,
      error:
        result.value.reason === "locked"
          ? ROSTER_LOCKED
          : result.value.reason === "captain"
            ? captainRefusalMessage(result.value.refusal)
            : "That registration is not in this season.",
    };
  }
  return { ok: true };
}

/**
 * ONE PLAYER, for a sheet opened somewhere the row is not already on the page —
 * a team's roster. Review-gated like the dashboard that normally carries it.
 */
export async function registrationDetailAction(
  slug: string,
  registrationId: string,
): Promise<
  { ok: true; row: RegistrationRow; desk: PlayerDeskContext } | { ok: false; error: string }
> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const found = await inCompetitionOrg(gate.personId, gate.competition, async (db) => {
    const [row, desk] = await Promise.all([
      registrationRowById(db, gate.competition.id, registrationId),
      playerDeskContext(db, gate.personId, gate.competition),
    ]);
    return row === null ? null : { row, desk };
  });
  return found === null
    ? { ok: false, error: "That player is not in this season." }
    : { ok: true, ...found };
}

export interface SquadCandidate {
  /** The registration id — also the seed of the player's initials mark. */
  id: string;
  number: string;
  name: string | null;
  /** Consent-gated (DPDP §5) by `queryRegistrations`; null → initials mark. */
  photoUrl: string | null;
  role: string | null;
  teamId: string | null;
  teamName: string | null;
  isIcon: boolean;
  isCaptain: boolean;
  isRetained: boolean;
}

/**
 * Every approved player, for the team page's "pick a captain / add an icon"
 * search. Review-gated: these are applicants' names. Bounded like "select all
 * matching" — a season has hundreds, not tens of thousands.
 */
export async function squadCandidatesAction(slug: string): Promise<SquadCandidate[]> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return [];
  }
  return inCompetitionOrg(gate.personId, gate.competition, async (db) => {
    const out: SquadCandidate[] = [];
    for (let page = 1; out.length < SELECT_ALL_CAP; page += 1) {
      const result = await queryRegistrations(db, gate.competition.id, {
        status: "approved",
        sort: "name",
        page,
        pageSize: 100,
      });
      out.push(
        ...result.rows.map((row) => ({
          id: row.id,
          number: row.number,
          name: row.name,
          photoUrl: row.photoUrl,
          role: row.role,
          teamId: row.teamId,
          teamName: row.teamName,
          isIcon: row.isIcon,
          isCaptain: row.isCaptain,
          isRetained: row.isRetained,
        })),
      );
      if (page * result.pageSize >= result.total) {
        break;
      }
    }
    return out;
  });
}

export type RegistrationEditResult =
  | { ok: true; row: RegistrationRow }
  | {
      ok: false;
      error: string;
      fieldErrors?: Partial<Record<EditableField, string>>;
    };

/**
 * Correct a registration in place — the player sheet's autosave.
 *
 * `registration.review`, the same gate as the rows themselves: this is the
 * organizer fixing their own record (a jersey size, a typo in a typed name,
 * who has paid), not a squad decision, which stays `team.manage`. Validation is
 * `planRegistrationEdit`, the CSV parser's rules one field at a time. Returns
 * the row as the dashboard reads it, so the sheet reconciles to the truth.
 */
export async function updateRegistrationDetailsAction(
  slug: string,
  registrationId: string,
  input: RegistrationEditInput,
): Promise<RegistrationEditResult> {
  const result = await inSeasonAs(
    slug,
    "registration.review",
    async ({ db, personId, competition }): Promise<RegistrationEditResult> => {
      const [stored] = await db
        .select({
          enteredName: registrations.enteredName,
          enteredPhotoKey: registrations.enteredPhotoKey,
          attributes: registrations.attributes,
          personPhotoKey: people.photoUrl,
          personPhotoConsentAt: people.photoConsentAt,
          personPhotoConsentVia: people.photoConsentVia,
        })
        .from(registrations)
        .innerJoin(people, eq(people.id, registrations.personId))
        .where(
          and(
            eq(registrations.id, registrationId),
            eq(registrations.competitionId, competition.id),
          ),
        )
        .limit(1);
      if (stored === undefined) {
        return { ok: false, error: "That player is not in this season." };
      }
      const auction = await auctionOf(db, competition.id);
      const plan = planRegistrationEdit(input, {
        pack: sportPackFor(competition.sport),
        bands: Object.keys(auction?.config.basePriceBands ?? DEFAULT_AUCTION_CONFIG.basePriceBands),
        rosterLocked: auction !== null && auction.status !== "scheduled",
        storedAttributes: (stored.attributes ?? {}) as Record<string, unknown>,
        now: new Date(),
      });
      if (!plan.ok) {
        return {
          ok: false,
          error: Object.values(plan.fieldErrors)[0] ?? "Check the highlighted field.",
          fieldErrors: plan.fieldErrors,
        };
      }
      // The first typed name switches this row to the entry's own photo
      // (`shownPhotoKey`), so the photo the club already sees moves with it —
      // renaming a player must not make their picture disappear. An entry that
      // already carries the club's own photo keeps it (organizer uploads always
      // land on the entry — go-live gate P2).
      const carryPhoto =
        plan.set.enteredName !== undefined &&
        stored.enteredName === null &&
        stored.enteredPhotoKey === null
          ? {
              enteredPhotoKey: stored.personPhotoKey,
              enteredPhotoConsentAt: stored.personPhotoConsentAt,
              enteredPhotoConsentVia: stored.personPhotoConsentVia,
            }
          : {};
      const written = await updateRegistrationDetails(
        db,
        competition.orgId,
        competition.id,
        registrationId,
        { ...plan.set, ...carryPhoto },
        plan.changed,
        personId,
      );
      const row = written.ok ? await registrationRowById(db, competition.id, registrationId) : null;
      return row === null
        ? { ok: false, error: "That player is not in this season." }
        : { ok: true, row };
    },
  );
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "forbidden" ? "You can't edit players in this season." : "Not available.",
    };
  }
  return result.value;
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
  const auction = await inCompetitionOrg(session.personId, competition, (db) =>
    auctionOf(db, competition.id),
  );
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
  role: string | null;
  basePriceBand: string;
  dateOfBirth: string;
  battingStyle: string;
  bowlingStyle: string;
}

export type AddPlayerActionResult =
  // No "personExisted": whether a phone already has an account is not the
  // club's to learn (0075 — the same leak the typed name closes).
  | { ok: true; registrationId: string; number: string }
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
    {
      name: input.name,
      phone: input.phone,
      role: input.role ?? "",
      basePriceBand: input.basePriceBand,
    },
    await bandsFor(gate.personId, gate.competition),
    // The add-by-hand dialog offers the season's roles; the validator behind it
    // used to accept only cricket's, so the form and its own gate disagreed.
    sportPackFor(gate.competition.sport),
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
  };
}

/** The bands the Add-player form may offer — same source of truth as the CSV path. */
export async function competitionBandsAction(slug: string): Promise<readonly string[]> {
  const gate = await reviewGate(slug);
  return gate.ok ? bandsFor(gate.personId, gate.competition) : [];
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
   * Values this file uses that the SEASON cannot place, each with the legal
   * answers — the other half of column mapping.
   *
   * Computed here rather than at inspection because it depends on the mapping:
   * a column the organizer has just pointed at `base_price_band` is only then
   * judged as a band. The preview already re-runs on every mapping change, so
   * the list stays honest for free.
   */
  unplaced: UnplacedValue[];
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
async function bandsFor(
  personId: string,
  competition: { id: string; orgId: string },
): Promise<readonly string[]> {
  const auction = await inCompetitionOrg(personId, competition, (db) =>
    auctionOf(db, competition.id),
  );
  return Object.keys(auction?.config.basePriceBands ?? DEFAULT_AUCTION_CONFIG.basePriceBands);
}

/**
 * The season's team names, so the parser can refuse a typo by line.
 *
 * Same shape as `bandsFor` and for the same reason: a column whose legal values
 * are a fact about THIS season cannot be validated by a pure parser that has
 * never seen the season. Without this a misspelt "Andheri Arrow" would import
 * as no team at all — the player silently teamless, the file reported clean.
 */
async function teamNamesFor(
  personId: string,
  competition: { id: string; orgId: string },
): Promise<readonly string[]> {
  const rows = await inCompetitionOrg(personId, competition, (db) =>
    db
      .select({ name: teamsTable.name })
      .from(teamsTable)
      .where(eq(teamsTable.competitionId, competition.id)),
  );
  return rows.map((row) => row.name);
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
    bands: [...(await bandsFor(gate.personId, gate.competition))],
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
/**
 * The file as the parser reads it: our header names, values substituted.
 *
 * Split out of `parseUnderShape` because the preview needs the SAME records to
 * work out which values it could not place — computing them twice, or from a
 * different starting point, is how a screen ends up offering to fix a row the
 * commit was never going to reject.
 *
 * VALUE MAPS APPLY EVEN WITHOUT A COLUMN MAPPING, which they did not. A file
 * whose headers are already ours skips `applyMapping` entirely — correct, and
 * the reason is documented on `parseUnderShape` — but that also skipped the
 * value substitution, so an organizer who mapped "Category 1" to band A on a
 * canonically-headed file watched their answer do nothing. An identity mapping
 * is built for that case ONLY when there is something to substitute, so the
 * untouched path stays untouched.
 */
function canonicalRecords(
  csv: string,
  shape: ImportShape | undefined,
): readonly (readonly string[])[] {
  const records = tokenizeCsv(csv);
  const mapping = shape?.mapping;
  const valueMaps = shape?.valueMaps;
  if (mapping !== undefined && Object.keys(mapping).length > 0) {
    return applyMapping(records, mapping, valueMaps);
  }
  if (valueMaps === undefined || Object.keys(valueMaps).length === 0) {
    return records;
  }
  const header = (records[0] ?? []).map((cell) => cell.trim().toLowerCase());
  const identity: ColumnMapping = {};
  IMPORT_FIELDS.forEach((field) => {
    const at = header.indexOf(field);
    if (at !== -1) {
      identity[field] = at;
    }
  });
  return applyMapping(records, identity, valueMaps);
}

function parseUnderShape(
  csv: string,
  bands: readonly string[],
  teamNames: readonly string[],
  /** The season's sport key — it decides what a role is. */
  sport: string,
  shape: ImportShape | undefined,
): ReturnType<typeof parseRegistrationRecords> {
  const source = canonicalRecords(csv, shape);
  return parseRegistrationRecords(source, bands, {
    now: new Date(),
    knownTeams: teamNames,
    // Without this the file's roles were judged against CRICKET, so a football
    // club's roster imported zero rows — "invalid role" on every line, while
    // the football pack recognised all of them.
    pack: sportPackFor(sport),
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
    return { validCount: 0, errors: [{ line: 1, message: gate.error }], unplaced: [] };
  }
  const tooBig = oversized(csv);
  if (tooBig !== null) {
    return { validCount: 0, errors: [{ line: 1, message: tooBig }], unplaced: [] };
  }
  const bands = await bandsFor(gate.personId, gate.competition);
  const teamNames = await teamNamesFor(gate.personId, gate.competition);
  const result = parseUnderShape(csv, bands, teamNames, gate.competition.sport, shape);
  /*
   * The values this season cannot place, from the SAME records the parser read.
   *
   * Computed before the early return below, because a file whose every row
   * failed is exactly the file this list exists for: 200 rows of "Category 1"
   * against a season configured for A/B/C is 200 errors and one decision.
   */
  const unplaced = unplacedValues(
    canonicalRecords(csv, shape),
    {
      pack: sportPackFor(gate.competition.sport),
      bands,
      teams: teamNames,
    },
    shape?.valueMaps ?? {},
  );
  if (result.rows.length === 0) {
    return { validCount: 0, errors: result.errors, unplaced };
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
    unplaced,
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
  const parsed = parseUnderShape(
    csv,
    await bandsFor(gate.personId, gate.competition),
    await teamNamesFor(gate.personId, gate.competition),
    gate.competition.sport,
    options?.shape,
  );
  if (parsed.errors.length > 0 && options?.skipInvalid !== true) {
    return {
      ok: false,
      error: `Fix ${String(parsed.errors.length)} row error(s) before importing.`,
    };
  }
  if (parsed.rows.length === 0) {
    return { ok: false, error: "No valid rows to import." };
  }
  /*
   * THE ROSTER LOCK, APPLIED TO A FILE.
   *
   * A team, an Icon mark and a retention all decide who is in the pool and
   * whose squad is how full — arithmetic the engine has already priced bids
   * against. The dashboard's toggles have been refused after the auction opens
   * since DA-04; an import carrying the same columns has to be refused for the
   * same reason, or the lock is a property of the button rather than of the
   * auction.
   *
   * ONLY THOSE COLUMNS. A file with no squad columns still imports mid-auction
   * — new registrations land in `submitted` and reach the pool through the same
   * approval gate — and the captain badge is deliberately not frozen, because
   * a drafted player's team is decided ON auction night. It is judged per
   * player instead, by the dashboard's rule, inside the commit
   * (`captainChangeRefusal`); one refusal leaves the whole file unimported.
   */
  if (marksFreezeWithRoster(squadMarksIn(parsed.rows))) {
    if (await auctionLocksRoster(gate.personId, gate.competition)) {
      return {
        ok: false,
        error:
          "The auction has started, so team, Icon and Retained columns can no longer be imported. Remove them from the file to import the rest.",
      };
    }
  }
  let result: Awaited<ReturnType<typeof commitRegistrationImport>>;
  try {
    result = await inCompetitionOrg(gate.personId, gate.competition, async (db) => {
      const auction = await auctionOf(db, gate.competition.id);
      return commitRegistrationImport(
        db,
        gate.competition.id,
        gate.competition.orgId,
        gate.personId,
        parsed.rows,
        options?.shape?.policy ?? options?.policy ?? "fill-blanks",
        auction !== null && auction.status !== "scheduled" ? auction.id : null,
      );
    });
  } catch (error) {
    if (error instanceof CaptainImportRefused) {
      return {
        ok: false,
        error: `${captainRefusalMessage(error.refusal)} Nothing was imported — remove that captain from the file to import the rest.`,
      };
    }
    throw error;
  }
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
   * What to write. DA-34: `teamId` narrows to one squad — the Teams tab offered
   * "Export" on a single team and merely NAVIGATED to a filtered list, so a
   * per-team export did not exist anywhere in the product. `columns` and
   * `rows` are the export dialog's choice; omitted, the file is the one this
   * button always wrote.
   */
  request: {
    teamId?: string;
    columns?: string[];
    rows?: ExportRows;
    view?: DashboardParams;
  } = {},
): Promise<{ ok: true; csv: string; filename: string } | { ok: false; error: string }> {
  const gate = await reviewGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const { teamId } = request;
  const { csv, filename } = await inCompetitionOrg(gate.personId, gate.competition, async (db) => {
    const team =
      teamId === undefined
        ? undefined
        : (await teamsOf(db, gate.competition.id)).find((entry) => entry.id === teamId);
    if (teamId !== undefined && team === undefined) {
      return { csv: null, filename: null };
    }
    const view = request.view ?? {};
    const body = await exportRegistrationsCsv(db, gate.competition.id, {
      ...(teamId !== undefined ? { teamId } : {}),
      ...(request.columns !== undefined ? { columns: request.columns } : {}),
      ...(request.rows !== undefined ? { rows: request.rows } : {}),
      ...(request.rows === "view" ? { view: dashboardFilter(view) } : {}),
    });
    const suffix =
      team !== undefined
        ? `${slugifyName(team.name)}-squad`
        : request.rows === "pool"
          ? "auction-pool"
          : "registrations";
    const name = `${gate.competition.slug}-${suffix}.csv`;
    // DA-35: the export read personal data and returned it with no record that
    // it had happened. The evidence is written before the file reaches the
    // caller, in the same tenant boundary that authorized the read — a failure
    // here fails the export rather than releasing an unrecorded copy.
    await recordRegistrationExport(db, gate.competition.orgId, gate.competition.id, gate.personId, {
      rowCount: body.rowCount,
      ...(teamId !== undefined ? { teamId } : {}),
      filename: name,
    });
    return { csv: body.csv, filename: name };
  });
  if (csv === null) {
    return { ok: false, error: "That team is not in this season." };
  }
  return { ok: true, csv, filename };
}
