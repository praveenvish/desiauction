import { roleOptions, type FeeStatus, type MoneyUnit } from "@desiauction/core";
import { people, registrations, teams, type Db } from "@desiauction/db";
import { and, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";

import { preSignedSql } from "../competition/pre-signed";
import {
  consentedPhotoUrl,
  shownName,
  shownPhotoConsentAt,
  shownPhotoKey,
} from "../competition/shown-name";
import { containsPattern } from "../../lib/like-pattern";

/**
 * /players — EVERY PLAYER ACROSS THE SEASONS A PERSON REVIEWS.
 *
 * The same rows the season's registrations desk reads, across seasons, and
 * only for seasons where the viewer holds `registration.review` (the caller
 * decides that — see `playersIndexView`). Deliberately narrower than the desk's
 * row: no phone, no DOB, no kit, no fee amount — an index needs a face, a name,
 * where they play and what state they are in; the sheet one click away has the
 * rest behind the same gate.
 *
 * Runs inside ONE org's boundary (`inOrg`), so the list of season ids cannot
 * widen what comes back: another club's rows are simply not visible.
 */

export const PLAYER_STATUSES = [
  "submitted",
  "approved",
  "waitlisted",
  "rejected",
  "withdrawn",
] as const;
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

/** The two squad routes a stat card can filter by. */
export const PLAYER_MARKS = ["sold", "unsold", "presigned"] as const;
export type PlayerMark = (typeof PLAYER_MARKS)[number];

export const PLAYERS_PAGE_SIZE = 25;
/** A merged page is fetched from every org; bound how deep that may go. */
export const PLAYERS_MAX_PAGE = 40;

export interface PlayersQuery {
  search?: string;
  status?: PlayerStatus;
  teamId?: string;
  mark?: PlayerMark;
  page: number;
}

export interface PlayerSeasonRef {
  id: string;
  slug: string;
  name: string;
  sport: string;
}

export interface PlayerIndexRow {
  registrationId: string;
  number: string;
  name: string | null;
  photoUrl: string | null;
  seasonSlug: string;
  seasonName: string;
  role: string | null;
  status: PlayerStatus;
  teamName: string | null;
  teamColor: string | null;
  feeStatus: FeeStatus;
  /** How they reached their team: the room, or a mark set before it. */
  squadRoute: "auction" | "icon" | "captain" | "retained" | null;
  /**
   * The season's auction has been run. A player with no team is UNSOLD after
   * it and simply not placed yet before it — the two need different words.
   */
  auctionDone: boolean;
  /** What the room paid, on the season's own scale (paise or points×100); null unless sold. */
  soldPrice: number | null;
  /** The season's money unit, so a price reads "50,000 pts" or "₹5,000". */
  auctionUnit: MoneyUnit;
  /** Epoch ms — sorts and merges across orgs without a Date crossing the wire. */
  createdAt: number;
}

export interface PlayersStats {
  total: number;
  approved: number;
  sold: number;
  preSigned: number;
  /** Approved, the season's auction over, and no team. */
  unsold: number;
  /** Registrations still waiting for a decision. */
  toReview: number;
  /** Sum of sold prices — meaningful only within one season's unit. */
  spent: number;
}

const NO_STATS: PlayersStats = {
  total: 0,
  approved: 0,
  sold: 0,
  preSigned: 0,
  unsold: 0,
  toReview: 0,
  spent: 0,
};

export interface PlayersSlice {
  rows: PlayerIndexRow[];
  total: number;
  stats: PlayersStats;
}

/**
 * A sold lot on a live (non-abandoned) auction — the room put them in a squad.
 *
 * Hand-written with explicit aliases, NOT interpolated columns: drizzle renders
 * `${table.col}` inside a single-table select's fields UNQUALIFIED, which binds
 * a correlated subquery to the wrong table (the PX-9 `financeDeclared` bug —
 * `lots.registration_id = lots.id`). Plain text cannot be rewritten that way.
 */
/** Same hand-written discipline as `soldSql` below: the season's auction is over. */
const auctionDoneSql = sql<boolean>`exists (select 1 from auctions done_auction where done_auction.competition_id = "registrations"."competition_id" and done_auction.status in ('completed', 'reconciled') and done_auction.kind = 'real')`;

const soldSql = sql<boolean>`exists (select 1 from lots sold_lot inner join auctions sold_auction on sold_auction.id = sold_lot.auction_id where sold_lot.registration_id = "registrations"."id" and sold_lot.status = 'sold' and sold_auction.status <> 'abandoned' and sold_auction.kind = 'real')`;

/** The sold lot's price — the same lot `soldSql` finds, so the two cannot disagree. */
const soldPriceSql = sql<
  number | null
>`(select price_lot.sold_price::float8 from lots price_lot inner join auctions price_auction on price_auction.id = price_lot.auction_id where price_lot.registration_id = "registrations"."id" and price_lot.status = 'sold' and price_auction.status <> 'abandoned' and price_auction.kind = 'real' limit 1)`;

const auctionUnitSql = sql<MoneyUnit>`(select unit_season.auction_unit from competitions unit_season where unit_season.id = "registrations"."competition_id")`;

/** Approved, the room has run, and no team: the desk's "Unsold". */
const unsoldSql = sql<boolean>`("registrations"."status" = 'approved' and "registrations"."team_id" is null and ${auctionDoneSql})`;

function filtersOf(seasonIds: readonly string[], query: Omit<PlayersQuery, "page">): SQL[] {
  const filters: SQL[] = [
    inArray(registrations.competitionId, [...seasonIds]),
    // "draft" is a machine-only state that is never persisted as a registration.
    ne(registrations.status, "draft"),
  ];
  if (query.status !== undefined) {
    filters.push(eq(registrations.status, query.status));
  }
  if (query.teamId !== undefined && query.teamId !== "") {
    filters.push(eq(registrations.teamId, query.teamId));
  }
  if (query.mark === "sold") {
    filters.push(soldSql);
  } else if (query.mark === "unsold") {
    filters.push(unsoldSql);
  } else if (query.mark === "presigned") {
    filters.push(and(preSignedSql, sql`${registrations.teamId} is not null`) as SQL);
  }
  const term = query.search?.trim();
  if (term !== undefined && term !== "") {
    // `%` and `_` typed into a search box are letters, not wildcards.
    const like = containsPattern(term);
    const clause = or(ilike(shownName, like), ilike(registrations.registrationNumber, like));
    if (clause !== undefined) {
      filters.push(clause);
    }
  }
  return filters;
}

/**
 * One org's slice: the first `limit` rows of the filtered list (newest first),
 * the filtered total, and the scope's stat figures (which ignore the filters, so
 * the cards describe the seasons in view rather than the current search).
 */
export async function playersIn(
  db: Db,
  seasons: readonly PlayerSeasonRef[],
  query: PlayersQuery & { limit: number },
  readUrl: (key: string) => string,
): Promise<PlayersSlice> {
  if (seasons.length === 0) {
    return { rows: [], total: 0, stats: NO_STATS };
  }
  const seasonIds = seasons.map((season) => season.id);
  const where = and(...filtersOf(seasonIds, query));
  const [countRows, raw, statRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(registrations)
      .innerJoin(people, eq(people.id, registrations.personId))
      .where(where),
    db
      .select({
        registrationId: registrations.id,
        number: registrations.registrationNumber,
        competitionId: registrations.competitionId,
        name: shownName,
        photoKey: shownPhotoKey,
        photoConsentAt: shownPhotoConsentAt,
        role: registrations.role,
        status: registrations.status,
        teamName: teams.name,
        teamColor: teams.primaryColor,
        feeStatus: registrations.feeStatus,
        isIcon: registrations.isIcon,
        isCaptain: registrations.isCaptain,
        isRetained: registrations.isRetained,
        sold: soldSql,
        auctionDone: auctionDoneSql,
        soldPrice: soldPriceSql,
        auctionUnit: auctionUnitSql,
        createdAt: registrations.createdAt,
      })
      .from(registrations)
      .innerJoin(people, eq(people.id, registrations.personId))
      .leftJoin(teams, eq(teams.id, registrations.teamId))
      .where(where)
      // THE ORDER A ROOM READS (2026-09-28): the dearest buys first, then the
      // pre-signed (a team, no price), then everyone else — by name. Newest
      // registration first answered nothing an organizer asks of this list.
      // `mergePlayerSlices` sorts the merged page by the same rule.
      .orderBy(
        sql`${soldPriceSql} desc nulls last`,
        sql`(${registrations.teamId} is null)`,
        sql`lower(${shownName})`,
        registrations.id,
      )
      .limit(Math.max(query.limit, 1)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        approved: sql<number>`count(*) filter (where ${registrations.status} = 'approved')::int`,
        sold: sql<number>`count(*) filter (where ${soldSql})::int`,
        preSigned: sql<number>`count(*) filter (where ${preSignedSql} and ${registrations.teamId} is not null)::int`,
        unsold: sql<number>`count(*) filter (where ${unsoldSql})::int`,
        toReview: sql<number>`count(*) filter (where ${registrations.status} = 'submitted')::int`,
        spent: sql<number>`coalesce(sum(${soldPriceSql}), 0)::float8`,
      })
      .from(registrations)
      .where(
        and(inArray(registrations.competitionId, seasonIds), ne(registrations.status, "draft")),
      ),
  ]);
  const seasonById = new Map(seasons.map((season) => [season.id, season]));
  const labellers = new Map<string, Map<string, string>>();
  const roleName = (sport: string, role: string | null): string | null => {
    if (role === null || role === "") return null;
    let byKey = labellers.get(sport);
    if (byKey === undefined) {
      byKey = new Map(roleOptions(sport).map((option) => [option.key, option.label]));
      labellers.set(sport, byKey);
    }
    return byKey.get(role) ?? role.replace(/_/g, " ");
  };
  const rows: PlayerIndexRow[] = raw.flatMap((row) => {
    const season = seasonById.get(row.competitionId);
    if (season === undefined || row.status === "draft") return [];
    const squadRoute: PlayerIndexRow["squadRoute"] =
      row.teamName === null
        ? null
        : row.sold
          ? "auction"
          : row.isIcon
            ? "icon"
            : row.isRetained
              ? "retained"
              : row.isCaptain
                ? "captain"
                : null;
    return [
      {
        registrationId: row.registrationId,
        number: row.number,
        name: row.name,
        // An organizer desk: consent decides (not age) — the desk's own rule.
        photoUrl: consentedPhotoUrl(
          { photoKey: row.photoKey, photoConsentAt: row.photoConsentAt },
          readUrl,
        ),
        seasonSlug: season.slug,
        seasonName: season.name,
        role: roleName(season.sport, row.role),
        status: row.status,
        teamName: row.teamName,
        teamColor: row.teamColor,
        feeStatus: row.feeStatus,
        squadRoute,
        auctionDone: row.auctionDone,
        soldPrice: row.soldPrice,
        auctionUnit: row.auctionUnit,
        createdAt: row.createdAt.getTime(),
      },
    ];
  });
  const stat = statRows[0];
  return {
    rows,
    total: countRows[0]?.count ?? 0,
    stats:
      stat === undefined
        ? NO_STATS
        : {
            total: stat.total,
            approved: stat.approved,
            sold: stat.sold,
            preSigned: stat.preSigned,
            unsold: stat.unsold,
            toReview: stat.toReview,
            spent: stat.spent,
          },
  };
}

/**
 * The list's order, for merging slices from several orgs: the dearest buys
 * first, then anyone with a team, then by name — the same rule as the query.
 */
export function playerOrder(a: PlayerIndexRow, b: PlayerIndexRow): number {
  return (
    (b.soldPrice ?? -1) - (a.soldPrice ?? -1) ||
    Number(a.teamName === null) - Number(b.teamName === null) ||
    (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }) ||
    (a.registrationId < b.registrationId ? -1 : a.registrationId > b.registrationId ? 1 : 0)
  );
}

/** Merge per-org slices into one page, in `playerOrder`. */
export function mergePlayerSlices(
  slices: readonly PlayersSlice[],
  page: number,
  pageSize: number,
): PlayersSlice {
  const all = slices.flatMap((slice) => slice.rows).sort(playerOrder);
  const start = (page - 1) * pageSize;
  return {
    rows: all.slice(start, start + pageSize),
    total: slices.reduce((sum, slice) => sum + slice.total, 0),
    stats: slices.reduce(
      (sum, slice) => ({
        total: sum.total + slice.stats.total,
        approved: sum.approved + slice.stats.approved,
        sold: sum.sold + slice.stats.sold,
        preSigned: sum.preSigned + slice.stats.preSigned,
        unsold: sum.unsold + slice.stats.unsold,
        toReview: sum.toReview + slice.stats.toReview,
        spent: sum.spent + slice.stats.spent,
      }),
      NO_STATS,
    ),
  };
}
