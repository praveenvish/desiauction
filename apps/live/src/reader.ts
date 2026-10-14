import { sportPack } from "@desiauction/core";
import { and, eq } from "drizzle-orm";
import {
  fixtures,
  matches,
  competitions,
  liveHistoryEntry,
  liveHistoryStamps,
  matchLiveState,
  scoringPublicAccess,
  type Db,
  type ScoringPublicProof,
} from "@desiauction/db";
import {
  engineFor,
  parseSeasonScoringRules,
  delayedHistoryIndex,
  publicLiveProjection,
  type PublicScoringState as PublicLiveState,
} from "@desiauction/core/scoring";
export async function readLive(
  db: Db,
  fixtureId: string,
  proof: ScoringPublicProof,
  nowMs = Date.now(),
) {
  // F05: the snapshot and the ring's timestamps only; the released entry is
  // fetched on its own, so a tick never moves thirty full snapshots.
  const [row] = await db
    .select({
      state: matchLiveState.state,
      stamps: liveHistoryStamps,
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
  const stored = row.state as PublicLiveState;
  const delay = parseSeasonScoringRules(row.rules).publicDelaySeconds;
  const stamps = Array.isArray(row.stamps) ? row.stamps : [];
  const index = delayedHistoryIndex(stamps, row.trust, delay, nowMs);
  let entry: { state: PublicLiveState } | undefined;
  if (index === "current") entry = { state: stored };
  else if (index !== undefined) {
    // Access is rechecked in this statement too: a revocation between the two
    // reads discloses nothing.
    const [released] = await db
      .select({ entry: liveHistoryEntry(index) })
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
    if (!released) return { allowed: false, live: null };
    const value = released.entry as { state?: unknown } | null;
    entry =
      value && typeof value.state === "object" && value.state !== null
        ? { state: value.state as PublicLiveState }
        : undefined;
  }
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
