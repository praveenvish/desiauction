import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { competitions, fixtures, matchLiveState, matches } from "./schema";
export interface ScoringPublicProof {
  s?: string;
  t?: string;
}
export function scoringPublicAccess(fixtureId: string, proof: ScoringPublicProof) {
  return and(
    eq(fixtures.id, fixtureId),
    ne(matches.phase, "void"),
    eq(matches.orgId, fixtures.orgId),
    eq(matches.competitionId, fixtures.competitionId),
    eq(competitions.orgId, fixtures.orgId),
    proof.s ? eq(competitions.slug, proof.s) : undefined,
    or(
      and(
        eq(competitions.visibility, "public"),
        inArray(fixtures.status, ["published", "in_progress", "completed"]),
      ),
      proof.t ? eq(matches.shareToken, proof.t) : sql`false`,
    ),
  );
}

/** Each history entry's `updatedAt`, in order, without the entries (F05). */
export const liveHistoryStamps = sql<
  unknown[]
>`(select coalesce(jsonb_agg(h.e -> 'updatedAt' order by h.n), '[]'::jsonb) from jsonb_array_elements(${matchLiveState.history}) with ordinality as h(e, n))`;

/** One history entry by its position. */
export function liveHistoryEntry(index: number) {
  return sql<unknown>`${matchLiveState.history} -> ${index}::int`;
}
