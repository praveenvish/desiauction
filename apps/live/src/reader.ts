import { sportPack } from "@desiauction/core";
import { and, eq } from "drizzle-orm";
import {
  fixtures,
  matches,
  competitions,
  matchLiveState,
  scoringPublicAccess,
  type Db,
  type ScoringPublicProof,
} from "@desiauction/db";
import {
  engineFor,
  parseSeasonScoringRules,
  publicLiveProjection,
  selectDelayedEntry,
  type PublicScoringState as PublicLiveState,
} from "@desiauction/core/scoring";
export async function readLive(
  db: Db,
  fixtureId: string,
  proof: ScoringPublicProof,
  nowMs = Date.now(),
) {
  const [row] = await db
    .select({
      state: matchLiveState.state,
      trust: matches.trustLevel,
      rules: competitions.scoringRules,
      sport: competitions.sport,
    })
    .from(fixtures)
    .innerJoin(matches, eq(matches.fixtureId, fixtures.id))
    .innerJoin(competitions, eq(competitions.id, fixtures.competitionId))
    .innerJoin(
      matchLiveState,
      and(
        eq(matchLiveState.fixtureId, fixtures.id),
        eq(matchLiveState.orgId, fixtures.orgId),
        eq(matchLiveState.competitionId, fixtures.competitionId),
      ),
    )
    .where(scoringPublicAccess(fixtureId, proof))
    .limit(1);
  if (!row) return { allowed: false, live: null };
  const pack = sportPack(row.sport);
  const engine = pack?.scoring ? engineFor(pack.scoring.family) : null;
  if (!engine) return { allowed: false, live: null };
  const stored = row.state as PublicLiveState & {
    history?: { state: PublicLiveState; updatedAt: string }[];
  };
  const delay = parseSeasonScoringRules(row.rules).publicDelaySeconds;
  const entry = selectDelayedEntry(
    { state: stored },
    Array.isArray(stored.history) ? stored.history : [],
    row.trust,
    delay,
    nowMs,
  );
  const projected = entry ? publicLiveProjection(entry.state, engine.family) : null;
  if (entry && !projected) return { allowed: false, live: null };
  return {
    allowed: true,
    live: projected ? { ...projected, trust: row.trust } : null,
    ...(projected?.family === "raid" || projected?.family === "timed"
      ? { clock: { serverAtMs: nowMs, delayMs: row.trust === "verified" ? 0 : delay * 1000 } }
      : {}),
  };
}
