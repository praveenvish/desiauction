import { fixtures, teams, type Db } from "@desiauction/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

/**
 * "TT v PP" for each match id — what an activity row about a match is ABOUT
 * (census 16/17: "Result entered" three times with no match named). Team
 * names are a season's public face, not directory data. A lobby, or an id
 * that is not a match, is simply absent from the map.
 */
export async function matchNames(
  db: Db,
  ids: readonly string[],
  orgId?: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids.filter((id) => id !== ""))];
  if (unique.length === 0) return out;
  const home = alias(teams, "match_name_home");
  const away = alias(teams, "match_name_away");
  const rows = await db
    .select({
      id: fixtures.id,
      home: sql<string | null>`coalesce(${home.shortName}, ${home.name})`,
      away: sql<string | null>`coalesce(${away.shortName}, ${away.name})`,
    })
    .from(fixtures)
    .leftJoin(home, eq(home.id, fixtures.homeTeamId))
    .leftJoin(away, eq(away.id, fixtures.awayTeamId))
    .where(
      orgId === undefined
        ? inArray(fixtures.id, unique)
        : and(eq(fixtures.orgId, orgId), inArray(fixtures.id, unique)),
    );
  for (const row of rows) {
    if (row.home !== null && row.away !== null) {
      out.set(row.id, `${row.home} v ${row.away}`);
    }
  }
  return out;
}
