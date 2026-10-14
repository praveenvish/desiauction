import type { Db } from "@desiauction/db";
import { sql } from "drizzle-orm";

/** Credit accepted effective deliveries, once per current trusted completed fixture. */
export async function eligibleSeasonScorers(db: Db, competitionId: string) {
  const rows = await db.execute<
    { personId: string; completedVerifiedMatches: number } & Record<string, unknown>
  >(sql`
    SELECT e.actor_person_id AS "personId", count(DISTINCT f.fixture_id)::int AS "completedVerifiedMatches"
    FROM ball_facts f
    JOIN matches m ON m.fixture_id=f.fixture_id AND m.org_id=f.org_id AND m.competition_id=f.competition_id
    JOIN match_events e ON e.fixture_id=f.fixture_id AND e.org_id=f.org_id AND e.competition_id=f.competition_id
      AND e.seq=f.seq AND e.attempt=m.attempt AND e.type='ball'
    JOIN fixtures fx ON fx.id=f.fixture_id AND fx.org_id=f.org_id AND fx.competition_id=f.competition_id
    JOIN fixture_results fr ON fr.fixture_id=f.fixture_id AND fr.org_id=f.org_id AND fr.competition_id=f.competition_id
    WHERE f.competition_id=${competitionId} AND m.trust_level IN ('verified','confirmed')
      AND fx.status='completed' AND fr.source='scored' AND m.finished_at IS NOT NULL
      AND m.phase IN ('finished','final','no_result','abandoned','walkover')
      AND f.innings_no <= 2
    GROUP BY e.actor_person_id ORDER BY "completedVerifiedMatches" DESC, e.actor_person_id
  `);
  return [...rows];
}
