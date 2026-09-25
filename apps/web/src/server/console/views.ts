import type { MoneyUnit } from "@desiauction/core";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { competitionsView } from "../competition/actions";
import { byEditionDate, teamsOf, type CompetitionSummary } from "../competition/competitions";
import { storage } from "../media";
import { grantsOfPerson } from "../request-cache";
import { rolesOf } from "../roles/roles";
import { acrossOrgs, inOrg } from "../tenant";
import {
  auctionFactsIn,
  auctionLinks,
  type AuctionFacts,
  type AuctionLink,
} from "./auctions-index";
import {
  mergePlayerSlices,
  PLAYER_MARKS,
  PLAYER_STATUSES,
  PLAYERS_MAX_PAGE,
  PLAYERS_PAGE_SIZE,
  playersIn,
  type PlayerMark,
  type PlayersQuery,
  type PlayersSlice,
  type PlayerStatus,
} from "./players-index";
import { seasonReportIn, type SeasonReport } from "./reports";
import { seasonAccess, type SeasonAccess } from "./reach";

/**
 * The three cross-season indexes, as the session sees them.
 *
 * One membership read (`competitionsView`, request-deduped and shared with the
 * shell), one grants read (`grantsOfPerson`, likewise), then every season's
 * access folded in memory (`seasonAccess`). Each index keeps only the seasons
 * its gate admits BEFORE any row is read, and every row read happens inside the
 * owning club's own tenant boundary (`acrossOrgs` / `inOrg`) — so nobody sees
 * another club's data, and a season's money keys exist only for money sight.
 */

type Season = CompetitionSummary & { orgName: string };
type SeasonWithAccess = Season & { access: SeasonAccess };

async function requirePerson(next: string): Promise<string> {
  const session = await currentSession();
  if (session === null) {
    redirect(`/login?next=${next}`);
  }
  return session.personId;
}

async function seasonsWithAccess(personId: string): Promise<SeasonWithAccess[]> {
  const [{ competitions }, grants] = await Promise.all([
    competitionsView(),
    grantsOfPerson(personId),
  ]);
  return byEditionDate(competitions).map((season) => ({
    ...season,
    access: seasonAccess(grants, season),
  }));
}

function groupByOrg<T extends { orgId: string }>(items: readonly T[]): Map<string, T[]> {
  const by = new Map<string, T[]>();
  for (const item of items) {
    const list = by.get(item.orgId) ?? [];
    list.push(item);
    by.set(item.orgId, list);
  }
  return by;
}

/* ---- /players ------------------------------------------------------------ */

export interface PlayersParams {
  q?: string | undefined;
  season?: string | undefined;
  status?: string | undefined;
  team?: string | undefined;
  mark?: string | undefined;
  page?: string | undefined;
}

export interface PlayersIndexView {
  /** Seasons this person reviews — empty means "manages nothing". */
  seasons: { slug: string; name: string; orgName: string }[];
  /** Teams in the seasons in scope, for the team filter. */
  teams: { id: string; name: string; seasonName: string }[];
  filters: { q: string; season: string; status: string; team: string; mark: string };
  page: number;
  pageCount: number;
  result: PlayersSlice;
  /** Whether the viewer plays or owns a team — decides the empty state's doors. */
  plays: boolean;
  ownsTeam: { name: string; seasonSlug: string } | null;
}

export async function playersIndexView(params: PlayersParams): Promise<PlayersIndexView> {
  const personId = await requirePerson("/players");
  const [all, roles] = await Promise.all([seasonsWithAccess(personId), rolesOf(personId)]);
  const reviewable = all.filter((season) => season.access.canReview);
  const scoped =
    params.season !== undefined && params.season !== ""
      ? reviewable.filter((season) => season.slug === params.season)
      : reviewable;
  const status = PLAYER_STATUSES.includes(params.status as PlayerStatus)
    ? (params.status as PlayerStatus)
    : undefined;
  const mark = PLAYER_MARKS.includes(params.mark as PlayerMark)
    ? (params.mark as PlayerMark)
    : undefined;
  const requested = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), PLAYERS_MAX_PAGE) : 1;
  const query: PlayersQuery = {
    ...(params.q !== undefined && params.q.trim() !== "" ? { search: params.q.trim() } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(params.team !== undefined && params.team !== "" ? { teamId: params.team } : {}),
    ...(mark !== undefined ? { mark } : {}),
    page,
  };
  const byOrg = groupByOrg(scoped);
  const orgIds = [...byOrg.keys()];
  const readUrl = (key: string) => storage.readUrl(key);
  const [slices, teamLists] = await Promise.all([
    acrossOrgs(personId, orgIds, (db, orgId) =>
      playersIn(db, byOrg.get(orgId) ?? [], { ...query, limit: page * PLAYERS_PAGE_SIZE }, readUrl),
    ),
    acrossOrgs(personId, orgIds, async (db, orgId) => {
      const seasons = byOrg.get(orgId) ?? [];
      const lists = await Promise.all(
        seasons.map(async (season) =>
          (await teamsOf(db, season.id)).map((team) => ({
            id: team.id,
            name: team.name,
            seasonName: season.name,
          })),
        ),
      );
      return lists.flat();
    }),
  ]);
  const result = mergePlayerSlices(slices, page, PLAYERS_PAGE_SIZE);
  const owned = roles.owns[0];
  return {
    seasons: reviewable.map((season) => ({
      slug: season.slug,
      name: season.name,
      orgName: season.orgName,
    })),
    teams: teamLists.flat(),
    filters: {
      q: params.q ?? "",
      season: scoped.length === reviewable.length ? "" : (params.season ?? ""),
      status: status ?? "",
      team: query.teamId ?? "",
      mark: mark ?? "",
    },
    page,
    pageCount: Math.min(Math.max(1, Math.ceil(result.total / PLAYERS_PAGE_SIZE)), PLAYERS_MAX_PAGE),
    result,
    plays: roles.plays,
    ownsTeam:
      owned === undefined ? null : { name: owned.teamName, seasonSlug: owned.competitionSlug },
  };
}

/* ---- /auctions ----------------------------------------------------------- */

export interface AuctionCardView {
  slug: string;
  seasonName: string;
  orgName: string;
  startsOn: string | null;
  endsOn: string | null;
  location: string | null;
  facts: AuctionFacts;
  /** What `facts.moneyMoved` counts in (0091) — each card its own season's. */
  auctionUnit: MoneyUnit;
  /** What this person is here: "Organizer", "Auctioneer", "Team owner · X", "Member". */
  roleLabel: string;
  links: AuctionLink[];
}

export interface AuctionsIndexView {
  cards: AuctionCardView[];
  totals: {
    upcoming: number;
    live: number;
    completed: number;
    /**
     * Paise over the RUPEE nights this person may see money for; absent if
     * none. Points leagues (0091) never fold in — 1,000 pts is not ₹1,000.
     */
    spend?: number;
    /** How many nights the spend covers. */
    spendNights: number;
    /** The same over points nights, ×100 of a point; absent if none. */
    pointsSpend?: number;
    pointsNights: number;
  };
}

export async function auctionsIndexView(): Promise<AuctionsIndexView> {
  const personId = await requirePerson("/auctions");
  const [all, roles] = await Promise.all([seasonsWithAccess(personId), rolesOf(personId)]);
  const ownedBySlug = new Map(roles.owns.map((team) => [team.competitionSlug, team.teamName]));
  const byOrg = groupByOrg(all);
  const money = new Set(
    all.filter((season) => season.access.seesAuctionMoney).map((season) => season.id),
  );
  const factMaps = await acrossOrgs(personId, [...byOrg.keys()], (db, orgId) =>
    auctionFactsIn(
      db,
      (byOrg.get(orgId) ?? []).map((season) => season.id),
      money,
    ),
  );
  const facts = new Map<string, AuctionFacts>();
  for (const map of factMaps) for (const [id, value] of map) facts.set(id, value);

  const cards: AuctionCardView[] = [];
  for (const season of all) {
    const fact = facts.get(season.id);
    if (fact === undefined) continue;
    const ownsTeam = ownedBySlug.get(season.slug) ?? null;
    const { canManage: manage, canConduct: conduct } = season.access;
    // A season with no auction yet is news to the person who sets one up — and
    // to the auctioneer appointed to run it, whose /home already counts it "in
    // the queue". Dropping it here left /auctions saying "0 Upcoming" and not
    // listing the one night that person was waiting on.
    if (fact.status === "none" && !manage && !conduct) continue;
    const role = { manage, conduct, ownsTeam };
    cards.push({
      slug: season.slug,
      seasonName: season.name,
      orgName: season.orgName,
      startsOn: season.startsOn,
      endsOn: season.endsOn,
      location: season.location,
      facts: fact,
      auctionUnit: season.auctionUnit,
      roleLabel: manage
        ? "Organizer"
        : conduct
          ? "Auctioneer"
          : ownsTeam !== null
            ? `Team owner · ${ownsTeam}`
            : "Member",
      links: auctionLinks(season.slug, fact.status, role),
    });
  }
  // Live first, then what is coming, then what is done.
  const rank = { live: 0, paused: 0, scheduled: 1, none: 2, completed: 3, settled: 3 } as const;
  cards.sort((a, b) => rank[a.facts.status] - rank[b.facts.status]);
  const seen = cards.filter((card) => card.facts.moneyMoved !== undefined);
  // Summed per unit: a points league's spend is not money and never joins a rupee total.
  const withMoney = seen.filter((card) => card.auctionUnit === "inr");
  const withPoints = seen.filter((card) => card.auctionUnit === "points");
  return {
    cards,
    totals: {
      upcoming: cards.filter((card) => card.facts.status === "scheduled").length,
      live: cards.filter((card) => card.facts.status === "live" || card.facts.status === "paused")
        .length,
      completed: cards.filter(
        (card) => card.facts.status === "completed" || card.facts.status === "settled",
      ).length,
      ...(withMoney.length > 0
        ? { spend: withMoney.reduce((sum, card) => sum + (card.facts.moneyMoved ?? 0), 0) }
        : {}),
      spendNights: withMoney.length,
      ...(withPoints.length > 0
        ? { pointsSpend: withPoints.reduce((sum, card) => sum + (card.facts.moneyMoved ?? 0), 0) }
        : {}),
      pointsNights: withPoints.length,
    },
  };
}

/* ---- /reports ------------------------------------------------------------ */

export interface ReportsView {
  seasons: { slug: string; name: string; orgName: string }[];
  season: {
    slug: string;
    name: string;
    orgName: string;
    sport: string;
    status: string;
  } | null;
  /** Whether this viewer holds the season's books — decides every rupee on the page. */
  money: boolean;
  report: SeasonReport | null;
}

/**
 * The report for one season this person reviews — the requested slug if it is
 * one of theirs, else their most recent edition. A slug outside their reach is
 * never read: it simply is not in the list the lookup runs over.
 */
export async function reportsView(slug: string | undefined): Promise<ReportsView> {
  const personId = await requirePerson("/reports");
  const reviewable = (await seasonsWithAccess(personId)).filter(
    (season) => season.access.canReview,
  );
  const chosen =
    (slug !== undefined ? reviewable.find((season) => season.slug === slug) : undefined) ??
    reviewable[0];
  const seasons = reviewable.map((season) => ({
    slug: season.slug,
    name: season.name,
    orgName: season.orgName,
  }));
  if (chosen === undefined) {
    return { seasons, season: null, money: false, report: null };
  }
  const money = chosen.access.seesSeasonMoney;
  const report = await inOrg(personId, chosen.orgId, (db) =>
    seasonReportIn(db, chosen, { money, readUrl: (key) => storage.readUrl(key) }),
  );
  return {
    seasons,
    season: {
      slug: chosen.slug,
      name: chosen.name,
      orgName: chosen.orgName,
      sport: chosen.sport,
      status: chosen.status,
    },
    money,
    report,
  };
}
