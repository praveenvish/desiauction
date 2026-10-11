import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { competitions, fixtures, matches } from "./schema";
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
