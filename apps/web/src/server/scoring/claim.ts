import { ReplayError } from "@desiauction/core/scoring";
import { replayScoringState } from "./family-state";
import { scoringEngine, unsupportedScoringMessage } from "./engine";
import {
  auditLog,
  competitions,
  fixtures,
  matchEvents,
  matches,
  newId,
  people,
  type Db,
} from "@desiauction/db";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { persistedMatchEvent } from "./append";
import { authorityKind } from "./authority";

const claimInput = z.object({
  deviceId: z.string().trim().min(1).max(200),
  mode: z.enum(["clean", "force"]),
});

/** Claim mutation and activity check share the append match lock. */
export async function claimScoring(
  db: Db,
  fixtureId: string,
  actorId: string,
  raw: unknown,
  now = new Date(),
) {
  const input = claimInput.safeParse(raw);
  if (!input.success)
    return { ok: false as const, error: "bad_payload", message: "Check the scoring device." };
  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.fixtureId, fixtureId))
    .for("update");
  if (!match) return { ok: false as const, error: "not_found", message: "Match not found." };
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!fixture) throw new Error("Scored fixture is missing");
  const authority = await authorityKind(db, actorId, fixture);
  if (!authority)
    return { ok: false as const, error: "forbidden", message: "You cannot score this match." };
  let holder: { name: string } | null = null;
  if (match.scorerPersonId) {
    const [person] = await db
      .select({ name: people.name })
      .from(people)
      .where(eq(people.id, match.scorerPersonId));
    holder = { name: person?.name ?? "Current scorer" };
  }
  // F09: a finished match is corrected by its scorer or an organiser; nobody
  // else takes it over by force.
  if (
    input.data.mode === "force" &&
    authority !== "a" &&
    (match.finishedAt !== null || match.phase === "final" || match.phase === "void")
  )
    return {
      ok: false as const,
      error: "claim_held",
      message: "This match is finished. Corrections go through the organiser.",
      holder,
      lastSeq: match.lastSeq,
    };
  if (match.scorerPersonId !== null && match.scorerPersonId !== actorId) {
    let permitted = input.data.mode === "force" && authority === "a";
    if (input.data.mode === "force" && !permitted) {
      const [last] = await db
        .select({ receivedAt: matchEvents.receivedAt })
        .from(matchEvents)
        .where(
          and(
            eq(matchEvents.fixtureId, fixtureId),
            eq(matchEvents.actorPersonId, match.scorerPersonId),
          ),
        )
        .orderBy(desc(matchEvents.receivedAt))
        .limit(1);
      const activity = Math.max(
        match.scorerClaimedAt?.getTime() ?? match.updatedAt.getTime(),
        last?.receivedAt.getTime() ?? 0,
      );
      permitted = now.getTime() - activity >= 120_000;
    }
    if (!permitted)
      return {
        ok: false as const,
        error: "claim_held",
        message: "The current scorer still holds this match.",
        holder,
        lastSeq: match.lastSeq,
      };
  }
  await db
    .update(matches)
    .set({
      scorerPersonId: actorId,
      scorerDeviceId: input.data.deviceId,
      scorerClaimedAt:
        match.scorerPersonId === actorId && match.scorerDeviceId === input.data.deviceId
          ? match.scorerClaimedAt
          : new Date(Math.max(now.getTime(), (match.scorerClaimedAt?.getTime() ?? 0) + 1)),
      updatedAt: now,
    })
    .where(eq(matches.fixtureId, fixtureId));
  await db.insert(auditLog).values({
    id: newId(),
    actor: actorId,
    action: input.data.mode === "force" ? "match.claim.forced" : "match.claim.taken",
    scopeType: "org",
    scopeId: match.orgId,
    subject: fixtureId,
    meta: { deviceId: input.data.deviceId, previousPersonId: match.scorerPersonId },
    at: now,
  });
  const [person] = await db
    .select({ name: people.name })
    .from(people)
    .where(eq(people.id, actorId));
  return {
    ok: true as const,
    holder: person ? { name: person.name ?? "Current scorer" } : null,
    lastSeq: match.lastSeq,
  };
}

export async function resumeScoring(db: Db, fixtureId: string, actorId: string, since: number) {
  if (!Number.isSafeInteger(since) || since < 0)
    return { ok: false as const, error: "bad_payload", message: "Check the resume sequence." };
  // The shared lock gives a consistent lastSeq and event slice against appends.
  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.fixtureId, fixtureId))
    .for("share");
  if (!match) return { ok: false as const, error: "not_found", message: "Match not found." };
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!fixture || !(await authorityKind(db, actorId, fixture)))
    return { ok: false as const, error: "forbidden", message: "You cannot score this match." };
  const [competition] = await db
    .select()
    .from(competitions)
    .where(eq(competitions.id, fixture.competitionId));
  const engine = competition ? scoringEngine(competition.sport) : null;
  if (!engine || !competition)
    return {
      ok: false as const,
      error: "bad_payload",
      message: competition ? unsupportedScoringMessage(competition.sport) : "Match not found.",
    };
  const canonicalRows = await db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.fixtureId, fixtureId))
    .orderBy(asc(matchEvents.seq));
  if (
    canonicalRows.length !== match.lastSeq ||
    canonicalRows.some((row, index) => row.seq !== index + 1)
  )
    return {
      ok: false as const,
      error: "bad_payload",
      message: "Scoring history is unavailable. Retry after recovery.",
    };
  try {
    replayScoringState(competition.sport, canonicalRows.map(persistedMatchEvent));
  } catch (error) {
    if (!(error instanceof ReplayError)) throw error;
    return {
      ok: false as const,
      error: "bad_payload",
      message: "Scoring history is unavailable. Retry after recovery.",
    };
  }
  const events = await db
    .select()
    .from(matchEvents)
    .where(and(eq(matchEvents.fixtureId, fixtureId), gt(matchEvents.seq, since)))
    .orderBy(asc(matchEvents.seq))
    .limit(2000);
  return {
    ok: true as const,
    attempt: match.attempt,
    lastSeq: match.lastSeq,
    events: events.map(persistedMatchEvent),
  };
}
