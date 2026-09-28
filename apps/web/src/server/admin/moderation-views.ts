import { competitions, organizations, people, type Db } from "@desiauction/db";
import { and, desc, eq, ilike, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";

import { systemDb } from "../db";
import { platformModerationGate } from "./authz";
import { containsPattern } from "../../lib/like-pattern";

/**
 * THE MODERATION DESK, read (0072).
 *
 * Two lists: every season that is on the open web right now, and every season
 * DesiAuction has taken down. A projection like every other in this folder —
 * the write lives in server/moderation/season-hold.ts and the runtime read-only
 * proof drives this module like the rest.
 *
 * Cross-tenant by definition, so it reads on the system pool, behind
 * `platform:moderation`. It carries no phone and no email: to judge whether a
 * page should come down, the desk needs the page, not the people.
 */

const PAGE = 50;
/** "Public this week" — a season that reached strangers in the last seven days. */
const RECENT_DAYS = 7;

/** The desk's facets: every public season, the newly public, the ones taking entries. */
export type ModerationFilter = "all" | "recent" | "open";
export const MODERATION_FILTERS: readonly ModerationFilter[] = ["all", "recent", "open"];

export interface PublicSeasonRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly orgName: string;
  readonly orgSlug: string;
  readonly sport: string;
  readonly createdAt: Date;
  /** The season's lifecycle status — whether strangers can register right now. */
  readonly status: string;
  /** Registrations that stand (not withdrawn, not drafts) — how far the page reached. */
  readonly registered: number;
  /**
   * When it was last made public, from the audit log's visibility change;
   * null when the log has none (seasons published before it was recorded).
   */
  readonly publicSince: Date | null;
}

export interface HeldSeasonRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly orgName: string;
  readonly orgSlug: string;
  readonly heldAt: Date;
  readonly reason: string;
  readonly heldByName: string | null;
}

export interface ModerationDesk {
  readonly query: string;
  readonly filter: ModerationFilter;
  readonly published: readonly PublicSeasonRow[];
  /** How many seasons match the search and filter — the list shows fifty at a time. */
  readonly publishedTotal: number;
  /** Each facet's count under the current search. */
  readonly counts: Readonly<Record<ModerationFilter, number>>;
  /** Every public season, unsearched — the desk's headline figure. */
  readonly publicAll: number;
  /** Public seasons that went public in the last seven days, unsearched. */
  readonly publicRecent: number;
  /** The id to pass as `?after=` for the next fifty, or null at the end. */
  readonly nextCursor: string | null;
  readonly held: readonly HeldSeasonRow[];
}

/**
 * When the season last went public: the newest visibility change to "public"
 * on the audit log (subject = the season, scope = its org, so the scope index
 * serves it). Hand-written aliases, never `${table.col}` inside raw SQL.
 */
const PUBLIC_SINCE = sql<string | null>`(select max(al.at) from audit_log al
  where al.scope_id = competitions.org_id
    and al.action = 'competition.visibility_changed'
    and al.subject = competitions.id
    and al.meta ->> 'to' = 'public')`;

function facetClause(filter: ModerationFilter): SQL | undefined {
  if (filter === "recent") {
    return sql`coalesce(${PUBLIC_SINCE}, competitions.created_at) > now() - make_interval(days => ${RECENT_DAYS})`;
  }
  if (filter === "open") {
    return eq(competitions.status, "registration_open");
  }
  return undefined;
}

/** Keyset: strictly after this season in (created_at desc, id desc); a stale id is page one. */
async function cursorClause(db: Db, after: string | undefined): Promise<SQL | undefined> {
  if (after === undefined || after === "") return undefined;
  const [row] = await db
    .select({ id: competitions.id, createdAt: competitions.createdAt })
    .from(competitions)
    .where(eq(competitions.id, after))
    .limit(1);
  if (row === undefined) return undefined;
  return or(
    lt(competitions.createdAt, row.createdAt),
    and(eq(competitions.createdAt, row.createdAt), lt(competitions.id, row.id)),
  );
}

export async function moderationDesk(
  db: Db,
  query = "",
  options: { filter?: ModerationFilter; after?: string } = {},
): Promise<ModerationDesk> {
  const term = query.trim();
  const filter = options.filter ?? "all";
  const match: SQL | undefined =
    term === ""
      ? undefined
      : or(
          ilike(competitions.name, containsPattern(term)),
          ilike(competitions.slug, containsPattern(term)),
          ilike(organizations.name, containsPattern(term)),
        );
  const isPublic = eq(competitions.visibility, "public");
  const whereFor = (f: ModerationFilter, searched: boolean): SQL | undefined =>
    and(isPublic, searched ? match : undefined, facetClause(f));
  const cursor = await cursorClause(db, options.after);
  const count = (where: SQL | undefined) =>
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(competitions)
      .innerJoin(organizations, eq(organizations.id, competitions.orgId))
      .where(where)
      .then((rows) => rows[0]?.n ?? 0);

  const [rows, facetCounts, publicAll, publicRecent, held] = await Promise.all([
    db
      .select({
        id: competitions.id,
        name: competitions.name,
        slug: competitions.slug,
        orgName: organizations.name,
        orgSlug: organizations.slug,
        sport: competitions.sport,
        createdAt: competitions.createdAt,
        status: competitions.status,
        registered: sql<number>`(select count(*)::int from registrations r
          where r.competition_id = competitions.id and r.status not in ('withdrawn', 'draft'))`,
        publicSince: PUBLIC_SINCE,
      })
      .from(competitions)
      .innerJoin(organizations, eq(organizations.id, competitions.orgId))
      .where(and(whereFor(filter, true), cursor))
      .orderBy(desc(competitions.createdAt), desc(competitions.id))
      .limit(PAGE + 1),
    Promise.all(MODERATION_FILTERS.map((f) => count(whereFor(f, true)))),
    count(whereFor("all", false)),
    count(whereFor("recent", false)),
    db
      .select({
        id: competitions.id,
        name: competitions.name,
        slug: competitions.slug,
        orgName: organizations.name,
        orgSlug: organizations.slug,
        heldAt: competitions.platformHoldAt,
        reason: competitions.platformHoldReason,
        heldByName: people.name,
      })
      .from(competitions)
      .innerJoin(organizations, eq(organizations.id, competitions.orgId))
      .leftJoin(people, eq(people.id, competitions.platformHoldBy))
      .where(isNotNull(competitions.platformHoldAt))
      .orderBy(desc(competitions.platformHoldAt))
      .limit(PAGE),
  ]);

  const more = rows.length > PAGE;
  const page = more ? rows.slice(0, PAGE) : rows;
  const counts = Object.fromEntries(
    MODERATION_FILTERS.map((f, index) => [f, facetCounts[index] ?? 0]),
  ) as Record<ModerationFilter, number>;
  return {
    query: term,
    filter,
    published: page.map((row) => ({
      ...row,
      publicSince: row.publicSince === null ? null : new Date(row.publicSince),
    })),
    publishedTotal: counts[filter],
    counts,
    publicAll,
    publicRecent,
    nextCursor: more ? (page[page.length - 1]?.id ?? null) : null,
    held: held.flatMap((row) =>
      row.heldAt === null || row.reason === null
        ? []
        : [{ ...row, heldAt: row.heldAt, reason: row.reason }],
    ),
  };
}

/** Gated entry point for the page. Null for anyone without `platform:moderation`. */
export async function adminModerationDesk(
  query: string,
  options: { filter?: ModerationFilter; after?: string } = {},
): Promise<ModerationDesk | null> {
  if ((await platformModerationGate()) === null) {
    return null;
  }
  return moderationDesk(systemDb, query, options);
}
