import { replayScoringState } from "./family-state";
import { competitions, fixtures, matches, matchEvents, type Db } from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { canCompetition } from "../competition/authz";
import { persistedMatchEvent } from "./persisted-event";
import { appendTrustEvidence } from "./trust-ledger";
import { updateMatchTrust } from "./trust";

export type TrustReviewDisposition = "verify" | "keep_flagged" | "exclude";

/** The platform caller must pass operatorFor before opening this tenant boundary. */
export async function reviewMatchTrust(
  db: Db,
  input: {
    fixtureId: string;
    orgId: string;
    personId: string;
    reason: string;
    disposition: TrustReviewDisposition;
    authority: "organizer" | "platform";
    attempt: number;
    lastSeq: number;
  },
  now = new Date(),
) {
  const refused = { ok: false as const, error: "This match review is unavailable." };
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 500) return refused;
  if (!["verify", "keep_flagged", "exclude"].includes(input.disposition)) return refused;
  if (input.authority === "organizer" && input.disposition !== "verify") return refused;
  const [match] = await db
    .select()
    .from(matches)
    .where(and(eq(matches.fixtureId, input.fixtureId), eq(matches.orgId, input.orgId)))
    .for("update");
  if (
    !match?.finishedAt ||
    match.phase === "void" ||
    match.attempt !== input.attempt ||
    match.lastSeq !== input.lastSeq
  )
    return refused;
  const [fixture] = await db
    .select()
    .from(fixtures)
    .where(
      and(
        eq(fixtures.id, input.fixtureId),
        eq(fixtures.orgId, input.orgId),
        eq(fixtures.competitionId, match.competitionId),
      ),
    );
  if (!fixture) return refused;
  if (
    input.authority === "organizer" &&
    !(await canCompetition(db, input.personId, fixture, "fixture.manage"))
  )
    return refused;
  const rows = await db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.fixtureId, fixture.id))
    .orderBy(matchEvents.seq);
  const [season] = await db
    .select({ sport: competitions.sport })
    .from(competitions)
    .where(and(eq(competitions.id, match.competitionId), eq(competitions.orgId, input.orgId)));
  if (!season) return refused;
  let state;
  try {
    state = replayScoringState(season.sport, rows.map(persistedMatchEvent));
  } catch {
    return refused;
  }
  if (
    !state.finished ||
    state.phase === "void" ||
    state.attempt !== input.attempt ||
    state.lastSeq !== input.lastSeq
  )
    return refused;
  const action =
    input.disposition === "verify"
      ? input.authority === "platform"
        ? "match.trust.platform_verified"
        : "match.trust.organizer_verified"
      : input.disposition === "exclude"
        ? "match.trust.platform_excluded"
        : "match.trust.kept_flagged";
  await appendTrustEvidence(
    db,
    fixture,
    input.personId,
    action,
    {
      attempt: state.attempt,
      lastSeq: state.lastSeq,
      reason,
      disposition: input.disposition,
    },
    now,
  );
  const trust = await updateMatchTrust(db, fixture.id, state, now, { refreshSnapshot: true });
  return { ok: true as const, trust: trust.level };
}
