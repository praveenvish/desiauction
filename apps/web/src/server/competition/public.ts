import { deriveAge } from "@desiauction/core";
import {
  auctions,
  competitions,
  organizations,
  people,
  registrations,
  teams,
} from "@desiauction/db";
import { and, asc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { storage } from "../media";
import { systemDb } from "../db";
import { teamsOf, type TeamSummary } from "./competitions";
import { publishedSchedule, type FixtureSnapshot } from "./fixtures";

// PX-5 public reads (PX-1 02 §I thin-wiring class): anonymous, system-pool
// composites over EXISTING queries. Public exposure is governed by the
// platform's own `competitions.visibility` column, and by NOTHING else.
//
// It used to also be governed by `status = 'registration_open'`, on the theory
// that "the shared link already made those public in practice". It had not.
// Opening registration is an operational act — one click on the Overview, no
// publish dialog, no warning — and it was publishing the competition page, the
// complete approved roster, every player's individual profile, four social
// cards and a one-click CSV of the lot. 19 competitions their organizers had
// marked `private` were serving 80-player rosters to anyone with the link.
//
// Two gates on the very same competition already disagreed with this one and
// were right: `/seasons/[slug]/register` (publicRegistrationFacts) and
// `/seasons/[slug]/auction/spectate` both test visibility alone, and the
// register page states the policy in prose — "a private season's very name is
// not a stranger's to read". The surface carrying other people's personal data
// was the permissive one. Publication is now one decision, made in one place,
// by the organizer, deliberately.
//
// Removing the status clause breaks no working flow: registration for a private
// competition never went through here. A signed-in player still registers by
// direct link (`competitionForRegistration`, no visibility test), and a
// signed-out one still gets the login redirect they got before. What is gone is
// the roster, not the door.
//
// Nothing here reads phones, registrations, or any person data.

export interface PublicFixture {
  number: string;
  homeTeamName: string;
  awayTeamName: string;
  kickoffAt: string | null;
  groundName: string | null;
  venueName: string | null;
}

export interface PublicCompetitionView {
  name: string;
  slug: string;
  status: string;
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
  orgName: string;
  open: boolean;
  /** Always true now that visibility is the only gate — this view does not
   *  exist for an unpublished competition. Kept so callers state the reason
   *  they index a page rather than assuming it. */
  listed: boolean;
  /** Ready-to-render competition crest URL, or null for the monogram fallback. */
  logoUrl: string | null;
  /** PX-6: the live door on the public page (null until an auction exists). */
  auctionStatus: string | null;
  teams: TeamSummary[];
  fixtures: PublicFixture[];
  /** Every published fixture, including any beyond the rendered bound. */
  fixtureTotal: number;
}

function toPublicFixture(row: FixtureSnapshot): PublicFixture {
  return {
    number: row.number,
    homeTeamName: row.homeTeamName,
    awayTeamName: row.awayTeamName,
    kickoffAt: row.kickoffAt,
    groundName: row.groundName,
    venueName: row.venueName,
  };
}

export async function publicCompetitionView(slug: string): Promise<PublicCompetitionView | null> {
  const [row] = await systemDb
    .select({
      id: competitions.id,
      name: competitions.name,
      slug: competitions.slug,
      status: competitions.status,
      visibility: competitions.visibility,
      location: competitions.location,
      startsOn: competitions.startsOn,
      endsOn: competitions.endsOn,
      orgName: organizations.name,
      logoKey: competitions.logoUrl,
    })
    .from(competitions)
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(eq(competitions.slug, slug))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  if (row.visibility !== "public") {
    // Not published — structurally absent, indistinguishable from a slug that
    // was never created. Open registration is not publication.
    return null;
  }
  const open = row.status === "registration_open";
  const [auctionRows, teams, fixtures] = await Promise.all([
    systemDb
      .select({ status: auctions.status })
      .from(auctions)
      .where(eq(auctions.competitionId, row.id))
      .limit(1),
    teamsOf(systemDb, row.id),
    publishedSchedule(systemDb, row.id),
  ]);
  return {
    name: row.name,
    slug: row.slug,
    status: row.status,
    location: row.location,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    orgName: row.orgName,
    open,
    // Not `row.visibility === "public"` — the gate above already refused
    // anything else, and the compiler now says so. The literal is the point:
    // this view cannot exist for an unpublished competition.
    listed: true,
    logoUrl: row.logoKey === null ? null : storage.readUrl(row.logoKey),
    auctionStatus: auctionRows[0]?.status ?? null,
    teams,
    fixtures: fixtures.rows.map(toPublicFixture),
    // Carried so the page can say "showing 500 of 640" rather than presenting a
    // truncated list under a heading that claims to be the whole schedule.
    fixtureTotal: fixtures.total,
  };
}

export interface ShowcasePlayer {
  number: string;
  name: string;
  role: string;
  age: number | null;
  battingStyle: string | null;
  bowlingStyle: string | null;
  /** Consent-gated (null unless photo_consent_at is set — DPDP §5). */
  photoUrl: string | null;
  /**
   * DA-17: "retained" is a third outcome, not a flavour of sold. Pre-signed
   * icons were counted as SOLD before a single lot opened, so a public page
   * announced "4 sold" on a competition whose auction had not started.
   */
  status: "available" | "sold" | "retained";
  teamName: string | null;
}

interface ShowcaseRow {
  number: string;
  name: string | null;
  role: string;
  dateOfBirth: string | null;
  battingStyle: string | null;
  bowlingStyle: string | null;
  photoKey: string | null;
  photoConsentAt: Date | null;
  teamId: string | null;
  teamName: string | null;
  isIcon: boolean;
}

/**
 * Row → public player: consent-gates the photo, derives age, maps squad→status.
 *
 * Status was derived from `team_id` alone, so an APPROVED ICON with no team yet
 * was published as "Available" — on the page, in the <title>, in the meta
 * description and on the share card someone forwards to a WhatsApp group. It is
 * not available: `auctionReady` filters icons out of the pool
 * (`server/auction/auction-ready.ts`, `.filter((row) => !row.isIcon)`), so no
 * team can bid for them in any auction this platform will ever run. The icon
 * flag is checked FIRST because it is the fact that decides biddability; the
 * team assignment only decides which name to print.
 */
function toShowcasePlayer(r: ShowcaseRow, now: Date): ShowcasePlayer {
  return {
    number: r.number,
    name: r.name ?? "Unnamed",
    role: r.role,
    age: deriveAge(r.dateOfBirth, now),
    battingStyle: r.battingStyle,
    bowlingStyle: r.bowlingStyle,
    photoUrl: r.photoConsentAt !== null && r.photoKey !== null ? storage.readUrl(r.photoKey) : null,
    status: r.isIcon ? "retained" : r.teamId === null ? "available" : "sold",
    teamName: r.teamName,
  };
}

/**
 * How many approved players one public page will carry. A player serialises to
 * ~1.83 KB in the RSC payload, so the unbounded query behind this page shipped
 * ~800 KB for a 400-player pool — the maximum a Pro Pass allows — in a single
 * response, on a surface whose whole audience is on a phone on mobile data.
 *
 * 200 is a budget (~370 KB), not a fact about any tournament, which is exactly
 * why it may never be applied silently. A bare LIMIT does not make the page
 * fast, it makes the page WRONG: the grid would announce "200 players", the
 * filter chips would count 200, the CSV would export 200, and a pool of 412
 * would be misreported to every visitor with no way for them to know. The pool
 * size is therefore fetched alongside the rows and travels with them.
 */
const SHOWCASE_PAGE_LIMIT = 200;

/**
 * The approved pool as one public page can honestly present it: the rows it
 * loaded, the size of the pool they came from, and whether those are the same
 * number. `truncated` is not a nicety — every count, filter and export on the
 * page is computed over `players`, so it is the only thing that stops those
 * numbers being read as statements about the tournament.
 */
export interface ShowcasePool {
  /** Loaded players, registration-number order — at most SHOWCASE_PAGE_LIMIT. */
  players: ShowcasePlayer[];
  /** Approved players in the pool, whether or not they are in `players`. */
  total: number;
  /** `total > players.length` — this page is a prefix of the pool, not the pool. */
  truncated: boolean;
}

/**
 * Public pre-auction showcase (parity §3.3): the APPROVED player pool for a
 * public/open competition. Anonymous, system-pool. Never exposes phones (C-23)
 * or non-approved registrations; photos are consent-gated. `status` reflects
 * persisted squad assignment (assigned = sold); live snapshot status is a P2
 * enhancement.
 */
export async function publicShowcase(slug: string): Promise<ShowcasePool | null> {
  const [comp] = await systemDb
    .select({
      id: competitions.id,
      visibility: competitions.visibility,
    })
    .from(competitions)
    .where(eq(competitions.slug, slug))
    .limit(1);
  if (comp === undefined) {
    return null;
  }
  if (comp.visibility !== "public") {
    return null;
  }
  const now = new Date();
  const rows = await systemDb
    .select({
      number: registrations.registrationNumber,
      name: people.name,
      role: registrations.role,
      dateOfBirth: registrations.dateOfBirth,
      battingStyle: registrations.battingStyle,
      bowlingStyle: registrations.bowlingStyle,
      photoKey: people.photoUrl,
      photoConsentAt: people.photoConsentAt,
      teamId: registrations.teamId,
      teamName: teams.name,
      isIcon: registrations.isIcon,
      // The pool size, carried on every row. `count(*) over ()` is evaluated
      // before LIMIT, so it counts the whole approved set — one query rather
      // than a second round trip, and there is no window in which the rows and
      // the count could describe different states of the table.
      poolSize: sql<number>`count(*) over ()::int`,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    .where(and(eq(registrations.competitionId, comp.id), eq(registrations.status, "approved")))
    .orderBy(asc(registrations.registrationNumber), asc(registrations.id))
    .limit(SHOWCASE_PAGE_LIMIT);
  // No rows means an empty pool, not a missing count: `count(*) over ()` has no
  // row to ride on when the set is empty.
  const total = rows[0]?.poolSize ?? 0;
  return {
    players: rows.map((r) => toShowcasePlayer(r, now)),
    total,
    truncated: total > rows.length,
  };
}

export interface PublicPlayer extends ShowcasePlayer {
  competitionName: string;
  competitionSlug: string;
  /** Registration is open on this competition. A stranger who lands on a
   *  friend's card had no way to join the same tournament — this is what lets
   *  the page offer one, and only when the door is actually open. */
  competitionOpen: boolean;
}

/**
 * A single approved player for the public profile + share card
 * (`/c/[slug]/p/[number]`, parity §Phase 2). Same visibility + consent gates as
 * the showcase; returns null when the competition isn't public or `number` is
 * not an approved player. Carries the competition identity for the card + back
 * link.
 */
export async function publicPlayer(slug: string, number: string): Promise<PublicPlayer | null> {
  const [comp] = await systemDb
    .select({
      id: competitions.id,
      name: competitions.name,
      slug: competitions.slug,
      status: competitions.status,
      visibility: competitions.visibility,
    })
    .from(competitions)
    .where(eq(competitions.slug, slug))
    .limit(1);
  if (comp === undefined) {
    return null;
  }
  if (comp.visibility !== "public") {
    return null;
  }
  const [row] = await systemDb
    .select({
      number: registrations.registrationNumber,
      name: people.name,
      role: registrations.role,
      dateOfBirth: registrations.dateOfBirth,
      battingStyle: registrations.battingStyle,
      bowlingStyle: registrations.bowlingStyle,
      photoKey: people.photoUrl,
      photoConsentAt: people.photoConsentAt,
      teamId: registrations.teamId,
      teamName: teams.name,
      isIcon: registrations.isIcon,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    .where(
      and(
        eq(registrations.competitionId, comp.id),
        eq(registrations.status, "approved"),
        eq(registrations.registrationNumber, number),
      ),
    )
    .limit(1);
  if (row === undefined) {
    return null;
  }
  return {
    ...toShowcasePlayer(row, new Date()),
    competitionName: comp.name,
    competitionSlug: comp.slug,
    competitionOpen: comp.status === "registration_open",
  };
}

export interface DirectoryEntry {
  name: string;
  slug: string;
  orgName: string;
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
  open: boolean;
  logoUrl: string | null;
  /** The auction's lifecycle status, or null when no auction exists yet. */
  auctionStatus: string | null;
  /**
   * Watchable by anyone, right now. The directory could not say this at all
   * before: it never selected auction status, so the single highest-conversion,
   * lowest-commitment action on the platform — watching a live auction with no
   * account — was invisible one click above the page that offers it.
   */
  live: boolean;
}

/** URL-backed facets. Anything else in `?filter=` / `?sort=` falls back to the
 *  default rather than erroring — a hand-typed or stale link still renders. */
export type DirectoryFilter = "all" | "open" | "live";
export type DirectorySort = "opportunity" | "soon" | "name";

export function parseDirectoryFilter(raw: string | undefined): DirectoryFilter {
  return raw === "open" || raw === "live" ? raw : "all";
}

export function parseDirectorySort(raw: string | undefined): DirectorySort {
  return raw === "soon" || raw === "name" ? raw : "opportunity";
}

/** Facet counts over the SEARCH alone, so the chips can say what switching to
 *  them would actually yield (and never advertise an empty filter). */
export interface DirectoryCounts {
  all: number;
  open: number;
  live: number;
}

export interface DirectoryPage {
  entries: DirectoryEntry[];
  page: number;
  totalPages: number;
  /** Rows matching the search AND the active filter. */
  total: number;
  counts: DirectoryCounts;
  /** Every published competition, search and facet ignored. The empty states
   *  have to offer a way back to the whole directory and say how big it is —
   *  a count taken inside a search that matched nothing would read "all 0". */
  catalogue: number;
  filter: DirectoryFilter;
  sort: DirectorySort;
}

const DIRECTORY_PAGE_SIZE = 12;

/**
 * The competition's auction status as a correlated scalar rather than a LEFT
 * JOIN. Nothing in the schema stops a competition owning more than one auction
 * row, and one duplicated competition row silently corrupts LIMIT/OFFSET
 * paging — page 2 would repeat page 1's tail. This keeps the directory at
 * strictly one row per competition, whatever the auction table holds.
 */
const latestAuctionStatus = sql<string | null>`(
    select ${auctions.status}
    from ${auctions}
    where ${auctions.competitionId} = ${competitions.id}
    order by ${auctions.createdAt} desc
    limit 1
  )`;

/** The same test the public competition page uses for its spectate door
 *  (`/c/[slug]`): a paused auction is mid-lot, not over, and still watchable. */
const isLive = sql<boolean>`${latestAuctionStatus} in ('live', 'paused')`;

/** Competitions whose organizers PUBLISHED them (visibility='public'). */
export async function publicCompetitionsDirectory(params: {
  q?: string;
  page?: number;
  filter?: DirectoryFilter;
  sort?: DirectorySort;
}): Promise<DirectoryPage> {
  const filter = params.filter ?? "all";
  const sort = params.sort ?? "opportunity";
  const published = eq(competitions.visibility, "public");
  const term = params.q?.trim();
  const search =
    term === undefined || term === ""
      ? undefined
      : or(
          ilike(competitions.name, `%${term}%`),
          ilike(competitions.location, `%${term}%`),
          ilike(organizations.name, `%${term}%`),
        );
  // The search predicate WITHOUT the facet: the chip counts have to describe
  // the facets a visitor could switch TO, not the one already applied.
  const searchWhere = search === undefined ? published : and(published, search);
  const facet =
    filter === "open"
      ? eq(competitions.status, "registration_open")
      : filter === "live"
        ? isLive
        : undefined;
  const where = facet === undefined ? searchWhere : and(searchWhere, facet);
  // One pass over the published set yields the catalogue size and all three
  // chip counts. FILTER (WHERE …) is parenthesised before the ::int cast —
  // unparenthesised, the cast binds inside the filter clause, not to the
  // aggregate.
  const matches = search ?? sql`true`;
  const [countRow] = await systemDb
    .select({
      catalogue: sql<number>`count(*)::int`,
      all: sql<number>`(count(*) filter (where ${matches}))::int`,
      open: sql<number>`(count(*) filter (where ${matches} and ${competitions.status} = 'registration_open'))::int`,
      live: sql<number>`(count(*) filter (where ${matches} and ${isLive}))::int`,
    })
    .from(competitions)
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(published);
  const counts: DirectoryCounts = {
    all: countRow?.all ?? 0,
    open: countRow?.open ?? 0,
    live: countRow?.live ?? 0,
  };
  const total = counts[filter];
  const page = Math.max(params.page ?? 1, 1);
  // Competition dates are bare, IST-implied dates (doc 05). A UTC "today" would
  // still call an Indian tournament upcoming for the first 5½ hours of its
  // opening day.
  const istToday = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await systemDb
    .select({
      name: competitions.name,
      slug: competitions.slug,
      status: competitions.status,
      location: competitions.location,
      startsOn: competitions.startsOn,
      endsOn: competitions.endsOn,
      orgName: organizations.name,
      logoKey: competitions.logoUrl,
      auctionStatus: latestAuctionStatus,
    })
    .from(competitions)
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(where)
    .orderBy(...directoryOrder(sort, istToday))
    .limit(DIRECTORY_PAGE_SIZE)
    .offset((page - 1) * DIRECTORY_PAGE_SIZE);
  return {
    entries: rows.map((row) => ({
      name: row.name,
      slug: row.slug,
      orgName: row.orgName,
      location: row.location,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      open: row.status === "registration_open",
      logoUrl: row.logoKey === null ? null : storage.readUrl(row.logoKey),
      auctionStatus: row.auctionStatus,
      live: row.auctionStatus === "live" || row.auctionStatus === "paused",
    })),
    page,
    totalPages: Math.max(1, Math.ceil(total / DIRECTORY_PAGE_SIZE)),
    total,
    counts,
    catalogue: countRow?.catalogue ?? 0,
    filter,
    sort,
  };
}

/**
 * The default used to be `startsOn ASC` — which leads with the EARLIEST
 * starting, i.e. the oldest and most likely finished, tournaments, and then
 * Postgres's ASC NULLS LAST buries every date-not-yet-announced competition
 * below them. A visitor's first screen was the least actionable half of the
 * directory. "opportunity" buckets by what a guest can do about a row — watch
 * it, join it, wait for it, read about it — and only orders by date inside a
 * bucket. The other two sorts are opt-in and do exactly what their labels say.
 */
function directoryOrder(sort: DirectorySort, istToday: string): SQL[] {
  const byDate = sql`${competitions.startsOn} asc nulls last`;
  const byId = sql`${competitions.id} asc`;
  if (sort === "soon") {
    return [byDate, byId];
  }
  if (sort === "name") {
    return [sql`${competitions.name} asc`, byId];
  }
  return [
    sql`case
          when ${isLive} then 0
          when ${competitions.status} = 'registration_open' then 1
          when ${competitions.startsOn} is null or ${competitions.startsOn} >= ${istToday} then 2
          else 3
        end asc`,
    byDate,
    byId,
  ];
}

export interface MyRegistration {
  competitionName: string;
  competitionSlug: string;
  orgName: string;
  status: string;
  role: string;
  number: string;
  open: boolean;
}

/** The person's registrations across every competition — the player lens.
 * Person-scoped cross-org listing on the system pool (PRP-1 documented class). */
export async function myRegistrations(personId: string): Promise<MyRegistration[]> {
  const rows = await systemDb
    .select({
      competitionName: competitions.name,
      competitionSlug: competitions.slug,
      orgName: organizations.name,
      status: registrations.status,
      role: registrations.role,
      number: registrations.registrationNumber,
      competitionStatus: competitions.status,
    })
    .from(registrations)
    .innerJoin(competitions, eq(competitions.id, registrations.competitionId))
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(eq(registrations.personId, personId))
    .orderBy(asc(competitions.startsOn), asc(registrations.id));
  return rows.map((row) => ({
    competitionName: row.competitionName,
    competitionSlug: row.competitionSlug,
    orgName: row.orgName,
    status: row.status,
    role: row.role,
    number: row.number,
    open: row.competitionStatus === "registration_open",
  }));
}

/** PX-6 fix: the sitemap carries EVERY published competition, not one page. */
export async function publicCompetitionSlugs(limit = 5000): Promise<string[]> {
  const rows = await systemDb
    .select({ slug: competitions.slug })
    .from(competitions)
    .where(eq(competitions.visibility, "public"))
    .orderBy(asc(competitions.id))
    .limit(limit);
  return rows.map((row) => row.slug);
}
