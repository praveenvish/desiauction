import { competitions, organizations, people, type Db } from "@desiauction/db";
import { and, desc, eq, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";

import { systemDb } from "../db";
import { platformModerationGate } from "./authz";

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

export interface PublicSeasonRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly orgName: string;
  readonly orgSlug: string;
  readonly sport: string;
  readonly createdAt: Date;
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
  readonly published: readonly PublicSeasonRow[];
  /** How many seasons are public in all — the list shows the newest fifty. */
  readonly publishedTotal: number;
  readonly held: readonly HeldSeasonRow[];
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function moderationDesk(db: Db, query = ""): Promise<ModerationDesk> {
  const term = query.trim();
  const match: SQL | undefined =
    term === ""
      ? undefined
      : or(
          ilike(competitions.name, `%${escapeLike(term)}%`),
          ilike(competitions.slug, `%${escapeLike(term)}%`),
          ilike(organizations.name, `%${escapeLike(term)}%`),
        );
  const isPublic = eq(competitions.visibility, "public");
  const publishedWhere = match === undefined ? isPublic : and(isPublic, match);

  const [published, [total], held] = await Promise.all([
    db
      .select({
        id: competitions.id,
        name: competitions.name,
        slug: competitions.slug,
        orgName: organizations.name,
        orgSlug: organizations.slug,
        sport: competitions.sport,
        createdAt: competitions.createdAt,
      })
      .from(competitions)
      .innerJoin(organizations, eq(organizations.id, competitions.orgId))
      .where(publishedWhere)
      .orderBy(desc(competitions.createdAt), desc(competitions.id))
      .limit(PAGE),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(competitions)
      .innerJoin(organizations, eq(organizations.id, competitions.orgId))
      .where(publishedWhere),
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

  return {
    query: term,
    published,
    publishedTotal: total?.n ?? 0,
    held: held.flatMap((row) =>
      row.heldAt === null || row.reason === null
        ? []
        : [{ ...row, heldAt: row.heldAt, reason: row.reason }],
    ),
  };
}

/** Gated entry point for the page. Null for anyone without `platform:moderation`. */
export async function adminModerationDesk(query: string): Promise<ModerationDesk | null> {
  if ((await platformModerationGate()) === null) {
    return null;
  }
  return moderationDesk(systemDb, query);
}
