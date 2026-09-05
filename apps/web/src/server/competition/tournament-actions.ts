"use server";

import {
  fixtures,
  registrations,
  settlementCases,
  teams,
  tournaments,
  withTenantDb,
} from "@desiauction/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { DEFAULT_SPORT_KEY } from "@desiauction/core";
import { redirect } from "next/navigation";
import { cache } from "react";

import { currentSession } from "../auth/actions";
import { dbHandle, systemDb } from "../db";
import { ForbiddenError } from "../orgs/authz";
import { orgsFor } from "../orgs/orgs";
import { competitionsView } from "./actions";
import { canCompetition, requireCompetitionCapability } from "./authz";
import {
  byEditionDate,
  competitionsForPerson,
  competitionsOfTournament,
  createTournament,
  isoToday,
  isRunningNow,
  type CompetitionSummary,
} from "./competitions";

/**
 * The tournament surface.
 *
 * `createTournament` has existed in the persistence layer since IP-3 — audit
 * logged, regression tested — with NO caller anywhere in the app. The
 * `competitions.tournament_id` column, its index, the org catalogue's grouping
 * and the `/org/{slug}/t/{tournament}` route were all built against a hierarchy
 * the product gave no way to populate: every season created through the UI was
 * a one-off. This module is the missing surface.
 *
 * A tournament is deliberately allowed to hold NO seasons. It is the recurring
 * competition ("BPL"); its seasons are the editions that actually run ("BPL 1",
 * "BPL 2"), and a brand exists before its first edition does.
 */

async function requireSession() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/tournaments");
  }
  return session;
}

/** FormData values are string | File; the same narrowing actions.ts uses. */
function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * The three figures an organizer scans a season by: how big is it, how much of
 * it is scheduled, and how much of it is waiting on me.
 */
export interface SeasonCounts {
  teams: number;
  matches: number;
  /** Registrations awaiting an organizer decision — the only actionable one. */
  pending: number;
}

const NO_COUNTS: SeasonCounts = { teams: 0, matches: 0, pending: 0 };

/**
 * One settlement-case read for the whole page, on the same system pool the
 * season union already uses. Status metadata only — no amounts — so listing it
 * beside a season the reader can already see leaks nothing the season page's
 * own lifecycle rail would not say.
 */
async function settlementStatusFor(
  competitionIds: string[],
): Promise<Map<string, "settling" | "settled">> {
  if (competitionIds.length === 0) {
    return new Map();
  }
  const rows = await systemDb
    .select({ competitionId: settlementCases.competitionId, status: settlementCases.status })
    .from(settlementCases)
    .where(inArray(settlementCases.competitionId, competitionIds));
  const by = new Map<string, "settling" | "settled">();
  for (const row of rows) {
    if (row.status === "voided") {
      continue;
    }
    const terminal = row.status === "settled" || row.status === "closed";
    if (terminal || !by.has(row.competitionId)) {
      by.set(row.competitionId, terminal ? "settled" : "settling");
    }
  }
  return by;
}

export type SeasonRow = CompetitionSummary & {
  orgName: string;
  counts: SeasonCounts;
  /** Today falls inside this edition's dates — the edition being run now. */
  running: boolean;
  /**
   * The settlement case's own status, folded to the reader's vocabulary:
   * "settled" covers settled AND closed books, a voided case never happened,
   * anything else is "settling". Without it a season whose money was done
   * badged "Registration closed" forever — the only settled signal on the
   * whole page was the seed data's name.
   */
  settlement: "settling" | "settled" | null;
};

/**
 * Which of a person's orgs they may actually create in, resolved ONCE per view.
 *
 * Membership is not permission (C-8), and this surface had been treating the
 * two as the same thing: every create affordance was rendered to anyone who
 * belonged to an org, and the server refused staff and viewers only after they
 * had filled the form in. `org:staff` holds `registration.review` but NOT
 * `competition.create`, so the two questions genuinely have different answers
 * and both have to be asked.
 */
/**
 * Deduped per request, and that is now load-bearing rather than an optimisation.
 *
 * This is one capability read PER ORG, so it is the most expensive thing on the
 * tournaments screen after the season union. Two callers want it in the same
 * render — `tournamentsView` below, and the `@action` slot that renders the
 * page's primary button during SSR — and without the cache the second caller
 * would double the query count on the very screen that already pays the most.
 *
 * Membership comes from `competitionsView`, which is itself deduped, so this
 * adds no read of its own beyond the capability checks.
 */
const capabilitiesOnce = cache(
  async (): Promise<{
    orgs: { id: string; name: string }[];
    creatable: { id: string; name: string }[];
    reviewable: Set<string>;
  }> => {
    const session = await requireSession();
    const { orgs } = await competitionsView();
    const answers = await Promise.all(
      orgs.map(async (org) =>
        withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, async (db) => ({
          org,
          create: await canCompetition(
            db,
            session.personId,
            { orgId: org.id },
            "competition.create",
          ),
          review: await canCompetition(
            db,
            session.personId,
            { orgId: org.id },
            "registration.review",
          ),
        })),
      ),
    );
    return {
      orgs,
      creatable: answers.filter((answer) => answer.create).map((answer) => answer.org),
      reviewable: new Set(answers.filter((answer) => answer.review).map((answer) => answer.org.id)),
    };
  },
);

/**
 * The orgs this person may actually open a season or tournament in.
 *
 * Membership is not permission: `org:staff` holds `registration.review` and not
 * `competition.create`, so belonging to a club and being able to start a season
 * in it are different facts. Exported because the `@action` slot needs exactly
 * this one answer and nothing else on the tournaments view.
 */
export async function creatableOrgs(): Promise<{ id: string; name: string }[]> {
  return (await capabilitiesOnce()).creatable;
}

export interface TournamentRow {
  id: string;
  name: string;
  slug: string;
  orgId: string;
  orgName: string;
  /** Epoch ms, not a Date: the browser sorts by it, and a number cannot drift
      across the server boundary or between render passes. */
  createdAt: number;
  seasons: SeasonRow[];
}

export interface TournamentsView {
  orgs: { id: string; name: string }[];
  /**
   * The subset of `orgs` this person may create a competition in. Every create
   * affordance on the page is gated on THIS, never on membership — and the
   * create forms are handed this list, so the org picker cannot offer an org
   * the action will refuse.
   */
  creatableOrgs: { id: string; name: string }[];
  tournaments: TournamentRow[];
  /** Seasons belonging to no tournament — first-class, never orphaned. */
  standalone: SeasonRow[];
  /** Roll-up across everything above, for the summary band. */
  totals: {
    tournaments: number;
    seasons: number;
    /** Of `seasons`, how many belong to no tournament — the band says so. */
    standalone: number;
    /**
     * The two season-centric figures the "All seasons" view's band reads. They
     * live here rather than being recounted in the browser because the band is
     * a roll-up of the WHOLE dataset — it is deliberately not filtered with the
     * toolbar, and the results line says so out loud.
     */
    open: number;
    inFlight: number;
    teams: number;
    /** Pending registrations THIS person can actually decide. */
    pending: number;
  };
  /** False when the person holds `registration.review` in no org at all. */
  canReviewAnywhere: boolean;
}

/**
 * Teams, fixtures and pending registrations per competition, in three grouped
 * counts rather than a per-season query each (the catalogue's pattern).
 *
 * The empty-id guard is not defensive noise: `inArray` with no values compiles
 * to `in ()`, which Postgres rejects outright.
 */
async function countsFor(competitionIds: string[]): Promise<Map<string, SeasonCounts>> {
  const counts = new Map<string, SeasonCounts>();
  if (competitionIds.length === 0) {
    return counts;
  }
  const tally = sql<number>`count(*)::int`;
  const [teamRows, fixtureRows, pendingRows] = await Promise.all([
    systemDb
      .select({ competitionId: teams.competitionId, count: tally })
      .from(teams)
      .where(inArray(teams.competitionId, competitionIds))
      .groupBy(teams.competitionId),
    systemDb
      .select({ competitionId: fixtures.competitionId, count: tally })
      .from(fixtures)
      .where(inArray(fixtures.competitionId, competitionIds))
      .groupBy(fixtures.competitionId),
    systemDb
      .select({ competitionId: registrations.competitionId, count: tally })
      .from(registrations)
      .where(
        and(
          inArray(registrations.competitionId, competitionIds),
          // "Submitted" is the only status that is waiting on a human.
          eq(registrations.status, "submitted"),
        ),
      )
      .groupBy(registrations.competitionId),
  ]);
  const read = (id: string): SeasonCounts => {
    const existing = counts.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const fresh = { ...NO_COUNTS };
    counts.set(id, fresh);
    return fresh;
  };
  for (const row of teamRows) {
    read(row.competitionId).teams = row.count;
  }
  for (const row of fixtureRows) {
    read(row.competitionId).matches = row.count;
  }
  for (const row of pendingRows) {
    read(row.competitionId).pending = row.count;
  }
  return counts;
}

/**
 * Every tournament across the orgs this person belongs to, each with its
 * seasons folded in, plus the one-off seasons that belong to none.
 */
export async function tournamentsView(): Promise<TournamentsView> {
  const session = await requireSession();
  const [orgs, seasons] = await Promise.all([
    withTenantDb(dbHandle, { personId: session.personId }, (db) => orgsFor(db, session.personId)),
    // Cross-org union scoped by the membership join — the same system-pool
    // pattern competitionsView uses.
    competitionsForPerson(systemDb, session.personId),
  ]);
  const orgIds = orgs.map((org) => org.id);
  const orgNames = new Map(orgs.map((org) => [org.id, org.name]));
  const rows =
    orgIds.length === 0
      ? []
      : await systemDb
          .select({
            id: tournaments.id,
            name: tournaments.name,
            slug: tournaments.slug,
            orgId: tournaments.orgId,
            createdAt: tournaments.createdAt,
          })
          .from(tournaments)
          .where(inArray(tournaments.orgId, orgIds))
          .orderBy(tournaments.name);
  const counts = await countsFor(seasons.map((season) => season.id));
  const settlementBy = await settlementStatusFor(seasons.map((season) => season.id));
  const today = isoToday();
  const enriched: SeasonRow[] = byEditionDate(seasons).map((season) => ({
    ...season,
    counts: counts.get(season.id) ?? NO_COUNTS,
    running: isRunningNow(season, today),
    settlement: settlementBy.get(season.id) ?? null,
  }));
  const plainOrgs = orgs.map((org) => ({ id: org.id, name: org.name }));
  const { creatable, reviewable } = await capabilitiesOnce();
  const standalone = enriched.filter((season) => season.tournamentId === null);
  return {
    orgs: plainOrgs,
    creatableOrgs: creatable,
    tournaments: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.getTime(),
      orgName: orgNames.get(row.orgId) ?? "",
      seasons: enriched.filter((season) => season.tournamentId === row.id),
    })),
    standalone,
    totals: {
      tournaments: rows.length,
      seasons: enriched.length,
      standalone: standalone.length,
      open: enriched.filter((season) => season.status === "registration_open").length,
      inFlight: enriched.filter(
        (season) => season.status === "setup" || season.status === "registration_open",
      ).length,
      // Summed over every season the person can see, one-offs included — the
      // band describes the page, and the page shows both groups.
      teams: enriched.reduce((sum, season) => sum + season.counts.teams, 0),
      // Pending is the only figure here that is a TO-DO rather than a fact, so
      // it is scoped to what this person may decide. A viewer was being shown
      // "2 awaiting your decision" in warning orange for registrations they
      // hold no capability to touch.
      pending: enriched.reduce(
        (sum, season) => sum + (reviewable.has(season.orgId) ? season.counts.pending : 0),
        0,
      ),
    },
    canReviewAnywhere: reviewable.size > 0,
  };
}

export interface TournamentHeader {
  tournament: { id: string; name: string; slug: string; orgId: string; orgName: string };
  viewer: { canCreateSeason: boolean };
}

/**
 * The GATE and the page title, and nothing else.
 *
 * Split out from the season list so the page can answer "does this person get
 * a 404?" before it commits a status code, and stream the (unbounded) list of
 * editions behind a Suspense boundary afterwards. A `loading.tsx` — or a
 * Suspense boundary wrapped around this call — would commit a 200 first and
 * turn the 404 into an inline error with the payload already sent.
 */
const tournamentHeaderOnce = cache(async (slug: string): Promise<TournamentHeader | null> => {
  const session = await requireSession();
  const [[row], orgs] = await Promise.all([
    systemDb
      .select({
        id: tournaments.id,
        name: tournaments.name,
        slug: tournaments.slug,
        orgId: tournaments.orgId,
      })
      .from(tournaments)
      .where(eq(tournaments.slug, slug))
      .limit(1),
    withTenantDb(dbHandle, { personId: session.personId }, (db) => orgsFor(db, session.personId)),
  ]);
  const org = orgs.find((candidate) => candidate.id === row?.orgId);
  if (row === undefined || org === undefined) {
    return null;
  }
  const canCreateSeason = await withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: row.orgId },
    (db) => canCompetition(db, session.personId, { orgId: row.orgId }, "competition.create"),
  );
  return { tournament: { ...row, orgName: org.name }, viewer: { canCreateSeason } };
});

/** Deduped per request — the page body and `generateMetadata` both ask. */
export async function tournamentHeader(slug: string): Promise<TournamentHeader | null> {
  return tournamentHeaderOnce(slug);
}

/**
 * The editions, newest first. Scoped to the ONE tournament in SQL: this used to
 * read every season in every org the person belongs to and filter in JS, so a
 * person in thirty clubs paid for all thirty to render one page.
 *
 * Membership is normally proved by `tournamentHeader` before the page reaches
 * here, but because this is an invokable "use server" export it re-proves it
 * itself: a non-member (or anyone POSTing the action id with an arbitrary
 * tournament ULID) gets an empty list, never another tenant's private seasons.
 */
export async function tournamentSeasons(
  tournamentId: string,
): Promise<(CompetitionSummary & { orgName: string; running: boolean })[]> {
  const session = await currentSession();
  if (session === null) {
    return [];
  }
  const [tournament] = await systemDb
    .select({ orgId: tournaments.orgId })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  if (tournament === undefined) {
    return [];
  }
  const orgs = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    orgsFor(db, session.personId),
  );
  if (!orgs.some((org) => org.id === tournament.orgId)) {
    return [];
  }
  const seasons = await competitionsOfTournament(systemDb, tournamentId);
  const today = isoToday();
  return byEditionDate(seasons).map((season) => ({
    ...season,
    running: isRunningNow(season, today),
  }));
}

/**
 * Returns the destination rather than redirecting — the same reason
 * `createOrgAction` does. This form is rendered by the `@action` parallel slot
 * on BOTH `/home` and `/tournaments`, and a server-action redirect away from a
 * route whose action slot is matched is abandoned by the router: the write
 * lands, the navigation never does, and the submit button stays disabled on a
 * form that already succeeded. See `createOrgAction` for the measurements.
 */
export async function createTournamentAction(
  _previous: { error?: string; created?: string },
  formData: FormData,
): Promise<{ error?: string; created?: string }> {
  const session = await requireSession();
  const orgId = formString(formData, "orgId");
  const name = formString(formData, "name");
  /*
   * A tournament's sport is the default every edition inherits. Empty falls
   * back to the platform default rather than refusing: this form predates the
   * dimension and a tournament with no seasons yet commits to nothing — the
   * season form asks again, and that answer is the one that reaches a fixture.
   */
  const sport = formString(formData, "sport") || DEFAULT_SPORT_KEY;
  // Membership + capability: only an owner/staff of THIS org may create in it.
  const memberships = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    orgsFor(db, session.personId),
  );
  if (!memberships.some((org) => org.id === orgId)) {
    return { error: "Choose one of your organizations." };
  }
  let slug: string;
  try {
    const tournament = await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId },
      async (db) => {
        // A tournament is a competition container: it rides the same capability
        // as creating the seasons inside it rather than inventing a new one.
        await requireCompetitionCapability(db, session.personId, { orgId }, "competition.create");
        return createTournament(db, orgId, session.personId, name, sport);
      },
    );
    slug = tournament.slug;
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You can't create tournaments in this organization." };
    }
    return { error: "Give the tournament a name of at least 3 characters." };
  }
  return { created: slug };
}
