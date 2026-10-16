import type { Db } from "@desiauction/db";
import { sql, type SQL } from "drizzle-orm";

export type InsightScope =
  { kind: "self"; personId: string } | { kind: "public"; personId: string; orgId: string };
export interface InsightFilter {
  excludeFixtureId?: string;
  ballType?: string;
  timeOfDay?: string;
  formatKey?: string;
  pitch?: string;
  groundType?: string;
}
export const INSIGHT_MINIMUM_BALLS = 60;
export function sample(balls: number, matches: number) {
  return {
    balls,
    matches,
    small: balls < INSIGHT_MINIMUM_BALLS,
    remaining: Math.max(0, INSIGHT_MINIMUM_BALLS - balls),
  };
}
export type InsightDimension =
  | "shot"
  | "wicket_position"
  | "all"
  | "zone"
  | "bowler_style"
  | "batter_hand"
  | "phase"
  | "ball_type"
  | "time_of_day"
  | "pitch"
  | "ground_type"
  | "wicket_kind";
const dimensionColumns: Record<InsightDimension, SQL> = {
  shot: sql`CASE WHEN f.zone IS NOT NULL AND f.angle IS NOT NULL AND f.runs_bat > 0 THEN f.zone || '|' || f.angle::text || '|' || f.runs_bat::text || '|' || coalesce(f.boundary,0)::text END`,
  wicket_position: sql`CASE WHEN f.wicket_x IS NOT NULL AND f.wicket_y IS NOT NULL THEN f.wicket_x::text || '|' || f.wicket_y::text END`,
  all: sql`'all'`,
  zone: sql`f.zone`,
  bowler_style: sql`f.bowler_style`,
  batter_hand: sql`f.batter_hand`,
  phase: sql`f.phase`,
  ball_type: sql`f.ball_type`,
  time_of_day: sql`f.time_of_day`,
  pitch: sql`f.pitch`,
  ground_type: sql`f.ground_type`,
  wicket_kind: sql`f.wicket_kind`,
};
export interface InsightAggregate {
  key: string | null;
  balls: number;
  matches: number;
  runs: number;
  conceded: number;
  dots: number;
  fours: number;
  sixes: number;
  wickets: number;
  deliveries: number;
}
/** One statement retains current trust, tenant identity, publication, age and delay gates. */
export async function aggregateFacts(
  db: Db,
  scope: InsightScope,
  role: "batting" | "bowling" | "dismissed",
  dimension: InsightDimension,
  filter: InsightFilter = {},
  now = new Date(),
): Promise<InsightAggregate[]> {
  const player =
    role === "batting"
      ? sql`f.batter_id`
      : role === "bowling"
        ? sql`f.bowler_id`
        : sql`f.player_out_id`;
  const group = dimensionColumns[dimension];
  const balls = role === "bowling" ? sql`f.legal` : sql`f.extra_kind IS DISTINCT FROM 'wide'`;
  const filters = [
    filter.excludeFixtureId === undefined
      ? sql``
      : sql`AND f.fixture_id <> ${filter.excludeFixtureId}`,
    filter.ballType === undefined ? sql`` : sql`AND f.ball_type = ${filter.ballType}`,
    filter.timeOfDay === undefined ? sql`` : sql`AND f.time_of_day = ${filter.timeOfDay}`,
    filter.formatKey === undefined ? sql`` : sql`AND f.format_key = ${filter.formatKey}`,
    filter.pitch === undefined ? sql`` : sql`AND f.pitch = ${filter.pitch}`,
    filter.groundType === undefined ? sql`` : sql`AND f.ground_type = ${filter.groundType}`,
  ];
  const rows = await db.execute<InsightAggregate & Record<string, unknown>>(sql`
    SELECT ${group} AS key,
      count(*) FILTER (WHERE ${balls})::int AS balls,
      count(DISTINCT f.fixture_id)::int AS matches,
      coalesce(sum(f.runs_bat),0)::int AS runs,
      coalesce(sum(f.runs_bat + CASE WHEN f.extra_kind IN ('wide','no_ball') THEN f.extras ELSE 0 END),0)::int AS conceded,
      count(*) FILTER (WHERE f.legal AND f.runs_bat = 0 AND f.extras = 0)::int AS dots,
      count(*) FILTER (WHERE f.boundary = 4)::int AS fours,
      count(*) FILTER (WHERE f.boundary = 6)::int AS sixes,
      count(*) FILTER (WHERE f.wicket_kind IN ('bowled','caught','lbw','stumped','hit_wicket','caught_and_bowled'))::int AS wickets,
      count(*)::int AS deliveries
    FROM ball_facts f
    JOIN registrations r ON r.id = ${player} AND r.org_id = f.org_id AND r.competition_id = f.competition_id
    JOIN fixtures fx ON fx.id = f.fixture_id AND fx.org_id = f.org_id AND fx.competition_id = f.competition_id
    JOIN matches m ON m.fixture_id = f.fixture_id AND m.org_id = f.org_id AND m.competition_id = f.competition_id
    JOIN competitions c ON c.id = f.competition_id AND c.org_id = f.org_id
    JOIN organizations o ON o.id = f.org_id
    JOIN fixture_results fr ON fr.fixture_id = f.fixture_id AND fr.org_id = f.org_id AND fr.competition_id = f.competition_id
    WHERE r.person_id = ${scope.personId} AND m.trust_level IN ('verified','confirmed')
      AND fx.status = 'completed' AND fr.source = 'scored' AND m.finished_at IS NOT NULL
      AND m.phase IN ('finished','final','no_result','abandoned','walkover')
      AND c.sport IN ('cricket','box_cricket') AND f.innings_no <= 2
      ${insightPublicGuard(scope, now)} ${sql.join(filters, sql` `)}
    ${dimension === "all" ? sql`` : sql`GROUP BY ${group}`}
    ORDER BY key NULLS LAST
  `);
  return [...rows];
}
export function withSample(row: InsightAggregate) {
  return { ...row, sample: sample(row.balls, row.matches) };
}

/** Shared public gates for independently aggregated canonical dismissal records. */
export function insightPublicGuard(scope: InsightScope, now: Date): SQL {
  return scope.kind === "public"
    ? sql`
    AND c.org_id = ${scope.orgId} AND c.visibility = 'public' AND o.kind = 'club'
    AND r.status = 'approved' AND fx.published_at IS NOT NULL
    AND coalesce(left(fx.kickoff_at,10), to_char(m.started_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD')) IS NOT NULL
    AND (r.date_of_birth IS NULL OR r.date_of_birth::date <=
      (coalesce(left(fx.kickoff_at,10)::date, (m.started_at AT TIME ZONE 'Asia/Kolkata')::date) - interval '18 years')::date)
    AND extract(epoch FROM (${now.toISOString()}::timestamptz - m.updated_at)) >=
      CASE WHEN m.trust_level = 'verified' THEN 0
        WHEN jsonb_typeof(c.scoring_rules->'publicDelaySeconds') = 'number'
          AND (c.scoring_rules->>'publicDelaySeconds')::numeric >= 0
        THEN (c.scoring_rules->>'publicDelaySeconds')::numeric ELSE 60 END
  `
    : sql``;
}
