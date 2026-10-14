import { sportPack } from "@desiauction/core";
import { sql } from "drizzle-orm";
import { type Db, type ScoringPublicProof } from "@desiauction/db";
import {
  engineFor,
  parseSeasonScoringRules,
  delayedHistoryIndex,
  publicLiveProjection,
  type PublicScoringState as PublicLiveState,
  type TrustLevel,
} from "@desiauction/core/scoring";
export async function readLive(
  db: Db,
  fixtureId: string,
  proof: ScoringPublicProof,
  nowMs = Date.now(),
) {
  // F07: desiauction_live reads no table; both functions apply P-1 themselves
  // (0127). F05: the first returns the ring's timestamps, the second only the
  // entry the delay releases. One REPEATABLE READ snapshot for both, so a write
  // that rotates the ring between them cannot shift the index onto a newer,
  // unreleased entry.
  const slug = proof.s ?? null,
    token = proof.t ?? null;
  const read = await db.transaction(
    async (tx) => {
      const rows = await tx.execute<{
        state: unknown;
        stamps: unknown;
        trust: TrustLevel;
        rules: unknown;
        sport: string;
      }>(
        sql`select state, stamps, trust, rules, sport from live_snapshot(${fixtureId}, ${slug}, ${token})`,
      );
      const row = rows[0];
      if (!row) return null;
      const pack = sportPack(row.sport);
      const engine = pack?.scoring ? engineFor(pack.scoring.family) : null;
      if (!engine) return null;
      const delay = parseSeasonScoringRules(row.rules).publicDelaySeconds;
      const stamps = Array.isArray(row.stamps) ? row.stamps : [];
      const index = delayedHistoryIndex(stamps, row.trust, delay, nowMs);
      let entry: { state: PublicLiveState } | undefined;
      if (index === "current") entry = { state: row.state as PublicLiveState };
      else if (index !== undefined) {
        const [released] = await tx.execute<{ entry: unknown }>(
          sql`select live_history_entry(${fixtureId}, ${slug}, ${token}, ${index}) as entry`,
        );
        const value = released?.entry as { state?: unknown } | null | undefined;
        if (!value) return null;
        entry =
          typeof value.state === "object" && value.state !== null
            ? { state: value.state as PublicLiveState }
            : undefined;
      }
      return { entry, engine, trust: row.trust, delay };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  if (!read) return { allowed: false, live: null };
  const { entry, engine, delay } = read;
  const row = { trust: read.trust };
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
