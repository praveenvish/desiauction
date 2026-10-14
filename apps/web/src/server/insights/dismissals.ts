import type { Db } from "@desiauction/db";
import { sql, type SQL } from "drizzle-orm";
import { insightPublicGuard, type InsightScope, type InsightFilter } from "./sample";

export type DismissalDimension = "all" | "ball_type" | "time_of_day" | "pitch" | "ground_type";
const buckets: Record<DismissalDimension, SQL> = {
  all: sql`'all'`,
  ball_type: sql`d.value->'conditions'->'ball'->>'type'`,
  time_of_day: sql`d.value->'conditions'->>'timeOfDay'`,
  pitch: sql`d.value->'conditions'->>'pitch'`,
  ground_type: sql`d.value->'conditions'->>'ground'`,
};
/** Canonical dismissal denominator, aggregated independently from delivery numerators. */
export async function aggregateDismissals(
  db: Db,
  scope: InsightScope,
  dimension: DismissalDimension,
  filter: InsightFilter = {},
  now = new Date(),
) {
  const filters = [
    filter.ballType === undefined
      ? sql``
      : sql`AND d.value->'conditions'->'ball'->>'type' = ${filter.ballType}`,
    filter.timeOfDay === undefined
      ? sql``
      : sql`AND d.value->'conditions'->>'timeOfDay' = ${filter.timeOfDay}`,
    filter.pitch === undefined ? sql`` : sql`AND d.value->'conditions'->>'pitch' = ${filter.pitch}`,
    filter.groundType === undefined
      ? sql``
      : sql`AND d.value->'conditions'->>'ground' = ${filter.groundType}`,
  ];
  const rows = await db.execute<
    { key: string | null; dismissals: number; matches: number; historical: boolean } & Record<
      string,
      unknown
    >
  >(sql`
    WITH eligible AS (
      SELECT l.fixture_id, l.registration_id, l.stats
      FROM match_player_lines l
      JOIN registrations r ON r.id=l.registration_id AND r.org_id=l.org_id AND r.competition_id=l.competition_id
      JOIN fixtures fx ON fx.id=l.fixture_id AND fx.org_id=l.org_id AND fx.competition_id=l.competition_id
      JOIN matches m ON m.fixture_id=l.fixture_id AND m.org_id=l.org_id AND m.competition_id=l.competition_id
      JOIN competitions c ON c.id=l.competition_id AND c.org_id=l.org_id
      JOIN organizations o ON o.id=l.org_id
      JOIN fixture_results fr ON fr.fixture_id=l.fixture_id AND fr.org_id=l.org_id AND fr.competition_id=l.competition_id
      WHERE r.person_id=${scope.personId} AND m.trust_level IN ('verified','confirmed')
        AND fx.status='completed' AND fr.source='scored' AND m.finished_at IS NOT NULL
        AND m.phase IN ('finished','final','no_result','abandoned','walkover')
        AND c.sport IN ('cricket','box_cricket')
        ${insightPublicGuard(scope, now)}
        ${filter.formatKey === undefined ? sql`` : sql`AND l.format_key=${filter.formatKey}`}
        ${filter.excludeFixtureId === undefined ? sql`` : sql`AND l.fixture_id<>${filter.excludeFixtureId}`}
    ), history AS (
      SELECT coalesce(bool_or(stats ? 'batting' AND jsonb_typeof(stats->'batting'->'dismissals') IS DISTINCT FROM 'array'),false) AS historical FROM eligible
    ), grouped AS (
      SELECT ${buckets[dimension]} AS key,
        count(DISTINCT (e.fixture_id,e.registration_id,d.value->>'inningsNo'))::int AS dismissals, count(DISTINCT e.fixture_id)::int AS matches
      FROM eligible e CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.stats->'batting'->'dismissals')='array' THEN e.stats->'batting'->'dismissals' ELSE '[]'::jsonb END) d(value)
      WHERE (d.value->>'inningsNo')::int <= 2 ${sql.join(filters, sql` `)}
      ${dimension === "all" ? sql`` : sql`GROUP BY ${buckets[dimension]}`}
    )
    SELECT grouped.key,coalesce(grouped.dismissals,0)::int AS dismissals, coalesce(grouped.matches,0)::int AS matches, history.historical
    FROM history LEFT JOIN grouped ON true ORDER BY grouped.key NULLS LAST
  `);
  return [...rows];
}
