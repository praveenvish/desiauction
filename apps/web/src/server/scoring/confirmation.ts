import { isPlacementState, replayScoringState } from "./family-state";
import {
  competitions,
  fixtures,
  matches,
  matchEvents,
  matchConfirmations,
  teamManagers,
  newId,
  type Db,
} from "@desiauction/db";
import { and, eq, isNull } from "drizzle-orm";
import { readConfirmationToken } from "./confirmation-token";
import {
  appendTrustEvidence,
  historicalAuthority,
  sameTrustRevision,
  trustEvidence,
} from "./trust-ledger";
import { persistedMatchEvent } from "./persisted-event";
import { updateMatchTrust } from "./trust";
const refused = { ok: false as const, error: "This confirmation is unavailable." };
export async function confirmationContext(
  db: Db,
  personId: string,
  token: unknown,
  now = new Date(),
) {
  const address = readConfirmationToken(token, now);
  if (!address) return null;
  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.fixtureId, address.fixtureId))
    .for("update");
  if (
    !match?.finishedAt ||
    match.phase === "void" ||
    match.attempt !== address.attempt ||
    match.lastSeq !== address.lastSeq
  )
    return null;
  const [fixture] = await db
    .select()
    .from(fixtures)
    .where(
      and(
        eq(fixtures.id, address.fixtureId),
        eq(fixtures.orgId, match.orgId),
        eq(fixtures.competitionId, match.competitionId),
      ),
    );
  if (!fixture) return null;
  const [manager] = await db
    .select({ id: teamManagers.id })
    .from(teamManagers)
    .where(
      and(
        eq(teamManagers.orgId, match.orgId),
        eq(teamManagers.competitionId, match.competitionId),
        eq(teamManagers.teamId, address.teamId),
        eq(teamManagers.personId, personId),
        isNull(teamManagers.revokedAt),
      ),
    )
    .limit(1);
  if (!manager) return null;
  const rows = await db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.fixtureId, address.fixtureId))
    .orderBy(matchEvents.seq);
  const [season] = await db
    .select({ sport: competitions.sport })
    .from(competitions)
    .where(and(eq(competitions.id, match.competitionId), eq(competitions.orgId, match.orgId)));
  if (!season) return null;
  let state;
  try {
    state = replayScoringState(season.sport, rows.map(persistedMatchEvent));
  } catch {
    return null;
  }
  if (
    !state.finished ||
    state.phase === "void" ||
    state.attempt !== address.attempt ||
    state.lastSeq !== address.lastSeq ||
    state.eventHistory.some(
      (event) => event.attempt === address.attempt && event.actorPersonId === personId,
    )
  )
    return null;
  const authority = historicalAuthority(await trustEvidence(db, fixture), state.eventHistory);
  const opposite =
    authority.representedTeamId === fixture.homeTeamId
      ? fixture.awayTeamId
      : authority.representedTeamId === fixture.awayTeamId
        ? fixture.homeTeamId
        : null;
  const validSide = isPlacementState(state)
    ? authority.representedTeamId !== null &&
      state.teamIds.includes(authority.representedTeamId) &&
      state.teamIds.includes(address.teamId) &&
      address.teamId !== authority.representedTeamId
    : opposite === address.teamId;
  if (!authority.complete || !authority.authority.d || !validSide) return null;
  return { address, fixture, match, state };
}
export async function confirmMatch(
  db: Db,
  personId: string,
  token: unknown,
  verdict: unknown,
  note: unknown,
  now = new Date(),
) {
  if (verdict !== "confirmed" && verdict !== "disputed") return refused;
  if (
    typeof note !== "string" ||
    note.trim().length > 500 ||
    (verdict === "disputed" && note.trim().length < 10)
  )
    return { ok: false as const, error: "Write a reason for the dispute (10–500 characters)." };
  const context = await confirmationContext(db, personId, token, now);
  if (!context) return refused;
  const { address, fixture, state } = context;
  const [existing] = await db
    .select()
    .from(matchConfirmations)
    .where(
      and(
        eq(matchConfirmations.fixtureId, address.fixtureId),
        eq(matchConfirmations.teamId, address.teamId),
      ),
    );
  const priorEvidence = await trustEvidence(db, fixture);
  const latestDecision = priorEvidence
    .filter(
      (row) => sameTrustRevision(row.meta, address) && typeof row.meta.trustOrder === "number",
    )
    .sort((a, b) => Number(a.meta.trustOrder) - Number(b.meta.trustOrder))
    .at(-1);
  if (
    latestDecision?.action === "match.trust.confirmation" &&
    existing?.personId === personId &&
    existing.verdict === verdict &&
    (existing.note ?? "") === note.trim() &&
    priorEvidence.some(
      (row) =>
        row.action === "match.trust.confirmation" &&
        row.meta.confirmationId === existing.id &&
        row.meta.attempt === address.attempt &&
        row.meta.lastSeq === address.lastSeq &&
        row.meta.verdict === verdict,
    )
  )
    return { ok: true as const, trust: context.match.trustLevel };
  const confirmationId = existing?.id ?? newId();
  await db
    .insert(matchConfirmations)
    .values({
      id: confirmationId,
      fixtureId: fixture.id,
      orgId: fixture.orgId,
      competitionId: fixture.competitionId,
      teamId: address.teamId,
      personId,
      verdict,
      note: note.trim() || null,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [matchConfirmations.fixtureId, matchConfirmations.teamId],
      set: { personId, verdict, note: note.trim() || null, createdAt: now },
    });
  await appendTrustEvidence(
    db,
    fixture,
    personId,
    "match.trust.confirmation",
    {
      confirmationId,
      teamId: address.teamId,
      attempt: address.attempt,
      lastSeq: address.lastSeq,
      verdict,
      note: note.trim() || null,
      tokenHash: address.tokenHash,
    },
    now,
  );
  const trust = await updateMatchTrust(db, fixture.id, state, now, { refreshSnapshot: true });
  return { ok: true as const, trust: trust.level };
}
