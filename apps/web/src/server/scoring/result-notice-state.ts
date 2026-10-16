import { noticeParticipants } from "./notice-participants";
import {
  fixtureResults,
  fixtureParticipants,
  fixtures,
  matches,
  matchAwards,
  type Db,
} from "@desiauction/db";
import { and, desc, eq, or, sql } from "drizzle-orm";
export interface MatchNoticeAddress {
  fixtureId: string;
  personId: string;
  kind: "match.result" | "match.award";
  awardKind?: "player_of_match" | "fighter_of_match" | "top_fragger";
}
const ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export function matchNoticeAddress(raw: string): MatchNoticeAddress | null {
  const parts = raw.replace(/^(email|whatsapp):/, "").split(":");
  if (
    parts[0] === "match.result" &&
    parts.length === 3 &&
    ID.test(parts[1] ?? "") &&
    ID.test(parts[2] ?? "")
  )
    return { kind: "match.result", fixtureId: parts[1] ?? "", personId: parts[2] ?? "" };
  if (
    parts[0] === "match.award" &&
    parts.length === 4 &&
    ID.test(parts[1] ?? "") &&
    ID.test(parts[3] ?? "") &&
    (parts[2] === "player_of_match" ||
      parts[2] === "fighter_of_match" ||
      parts[2] === "top_fragger")
  )
    return {
      kind: "match.award",
      fixtureId: parts[1] ?? "",
      personId: parts[3] ?? "",
      awardKind: parts[2],
    };
  return null;
}
/** Tenant-scoped eligibility for enqueue, delivery and authenticated recipient links. */
export async function eligibleMatchNotice(db: Db, orgId: string, address: MatchNoticeAddress) {
  const [fixture] = await db
    .select({
      id: fixtures.id,
      competitionId: fixtures.competitionId,
      number: fixtures.fixtureNumber,
      token: matches.shareToken,
    })
    .from(fixtures)
    .innerJoin(
      matches,
      and(
        eq(matches.fixtureId, fixtures.id),
        eq(matches.orgId, fixtures.orgId),
        eq(matches.competitionId, fixtures.competitionId),
      ),
    )
    .leftJoin(
      fixtureResults,
      and(
        eq(fixtureResults.fixtureId, fixtures.id),
        eq(fixtureResults.orgId, fixtures.orgId),
        eq(fixtureResults.competitionId, fixtures.competitionId),
      ),
    )
    .where(
      and(
        eq(fixtures.id, address.fixtureId),
        eq(fixtures.orgId, orgId),
        eq(fixtures.status, "completed"),
        or(
          eq(fixtureResults.source, "scored"),
          and(
            sql`${matches.awardVersion} like 'top-fragger-v1/%'`,
            sql`exists(select 1 from ${fixtureParticipants} fp where fp.fixture_id=${fixtures.id} and fp.org_id=${fixtures.orgId} and fp.source='scored')`,
          ),
        ),
      ),
    );
  if (!fixture) return null;
  const [match] = await db
    .select({ phase: matches.phase, finishedAt: matches.finishedAt })
    .from(matches)
    .where(eq(matches.fixtureId, address.fixtureId));
  if (!match?.finishedAt || match.phase === "void") return null;
  const participants = await noticeParticipants(
    db,
    address.fixtureId,
    orgId,
    fixture.competitionId,
  );
  const own = participants.filter((participant) => participant.personId === address.personId);
  if (!own.length) return null;
  if (address.kind === "match.award") {
    if (!address.awardKind) return null;
    const [award] = await db
      .select({ winner: matchAwards.winnerRegistrationId })
      .from(matchAwards)
      .where(
        and(
          eq(matchAwards.fixtureId, address.fixtureId),
          eq(matchAwards.orgId, orgId),
          eq(matchAwards.competitionId, fixture.competitionId),
          eq(matchAwards.scope, "match"),
          eq(matchAwards.kind, address.awardKind),
        ),
      )
      .orderBy(desc(matchAwards.createdAt), desc(matchAwards.id))
      .limit(1);
    if (!own.some((participant) => participant.registrationId === award?.winner)) return null;
  }
  return fixture;
}
