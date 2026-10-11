import { isPlacementState, replayScoringState, scoringResult } from "./family-state";
import { reminderBoundariesFor } from "./reminder-boundaries";
import { placementEngine, parseSeasonScoringRules } from "@desiauction/core/scoring";
import {
  auditLog,
  competitions,
  fixtureResults,
  fixtures,
  matchEvents,
  matches,
  newId,
  withTenantDb,
  type Db,
  type DbHandle,
} from "@desiauction/db";
import { and, desc, eq, gte, inArray, isNotNull, or } from "drizzle-orm";
import { dbHandle, systemDb } from "../db";
import { logger } from "../logger";
import { notificationGate } from "../messaging/gate";
import { organizersOf } from "../orgs/organizer-notify";
import { persistedMatchEvent } from "./append";
import { finalizeScoredMatch, revalidateScoredMatch } from "./finalize";
import { writeLiveState } from "./live-state";
import { dispatchTossReminders } from "./toss-reminder-delivery";
import { recoverGuestClaimInvites, recoverResultNotices } from "./result-notice-delivery";
import { updateMatchTrust } from "./trust";
import { dispatchConfirmationNotices } from "./result-notice-delivery";

import { SCORING_SYSTEM_ACTOR } from "./system-actor";
export { SCORING_SYSTEM_ACTOR } from "./system-actor";
const terminal = ["finished", "walkover", "no_result", "abandoned"] as const;
async function lockedMatch(db: Db, fixtureId: string) {
  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.fixtureId, fixtureId))
    .for("update");
  return match;
}
async function history(db: Db, fixtureId: string) {
  const rows = await db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.fixtureId, fixtureId))
    .orderBy(matchEvents.seq);
  return rows;
}
export async function refreshScoringTrust(db: Db, fixtureId: string, now: Date) {
  const match = await lockedMatch(db, fixtureId);
  if (!match?.finishedAt || match.phase === "void") return false;
  const [season] = await db
    .select({ sport: competitions.sport })
    .from(competitions)
    .where(eq(competitions.id, match.competitionId));
  if (!season) throw new Error("Scored season is missing");
  const state = replayScoringState(
    season.sport,
    (await history(db, fixtureId)).map(persistedMatchEvent),
  );
  if (state.attempt !== match.attempt || state.lastSeq !== match.lastSeq)
    throw new Error("Scoring revision is inconsistent");
  if (!state.finished || state.phase === "void") return false;
  return (await updateMatchTrust(db, fixtureId, state, now, { refreshSnapshot: true })).changed;
}
export async function sealScoring(db: Db, fixtureId: string, now: Date) {
  const match = await lockedMatch(db, fixtureId);
  if (!match || !match.finishedAt || !terminal.some((p) => p === match.phase)) return null;
  const [season] = await db
    .select({
      sport: competitions.sport,
      slug: competitions.slug,
      scoringRules: competitions.scoringRules,
    })
    .from(competitions)
    .where(eq(competitions.id, match.competitionId));
  if (!season) throw new Error("Scored season is missing");
  const rules = parseSeasonScoringRules(season.scoringRules);
  if (now.getTime() - match.finishedAt.getTime() <= rules.editWindowHours * 3600000) return null;
  const rows = await history(db, fixtureId);
  const state = replayScoringState(season.sport, rows.map(persistedMatchEvent));
  if (state.lastSeq !== match.lastSeq || state.attempt !== match.attempt)
    throw new Error("Scoring revision is inconsistent");
  if (
    !state.finished ||
    !(isPlacementState(state)
      ? placementEngine.deriveResult(state)
      : scoringResult(state, rules).result)
  )
    return null;
  const finalizations = await db
    .select({ meta: auditLog.meta })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.scopeType, "org"),
        eq(auditLog.scopeId, match.orgId),
        eq(auditLog.subject, fixtureId),
        eq(auditLog.action, "match.finalized"),
      ),
    );
  let revision = 0;
  for (const row of finalizations) {
    const meta = row.meta;
    if (
      meta &&
      typeof meta === "object" &&
      "attempt" in meta &&
      meta.attempt === match.attempt &&
      "lastSeq" in meta &&
      typeof meta.lastSeq === "number"
    )
      revision = Math.max(revision, meta.lastSeq);
  }
  const [result] = await db
    .select({ source: fixtureResults.source })
    .from(fixtureResults)
    .where(eq(fixtureResults.fixtureId, fixtureId));
  let effect = { fixtureId, slug: season.slug };
  if (revision < match.lastSeq || (!isPlacementState(state) && result?.source !== "scored")) {
    const responsible = rows.findLast(
      (e) =>
        e.attempt === match.attempt &&
        ["finish", "void", "amend", ...(isPlacementState(state) ? ["abandon"] : [])].includes(
          e.type,
        ),
    );
    if (!responsible || responsible.actorPersonId === SCORING_SYSTEM_ACTOR)
      throw new Error("Finished revision has no valid human provenance");
    effect = await finalizeScoredMatch(db, fixtureId, SCORING_SYSTEM_ACTOR, state, now, {
      recordedBy: responsible.actorPersonId,
    });
  }
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!fixture) throw new Error("Scored fixture is missing");
  await db
    .update(matches)
    .set({ phase: "final", finalizedAt: now, updatedAt: now })
    .where(eq(matches.fixtureId, fixtureId));
  await writeLiveState(db, {
    fixtureId,
    orgId: match.orgId,
    competitionId: match.competitionId,
    kickoffAt: fixture.kickoffAt,
    startedAt: match.startedAt,
    state,
    phase: "final",
    now,
  });
  return { sealed: true as const, effect };
}
export async function stallScoring(db: Db, fixtureId: string, now: Date) {
  const match = await lockedMatch(db, fixtureId);
  if (!match || !["live", "interrupted"].includes(match.phase)) return false;
  const rows = await history(db, fixtureId);
  const activity = Math.max(
    match.startedAt?.getTime() ?? match.createdAt.getTime(),
    ...rows.map((e) => e.receivedAt.getTime()),
  );
  if (now.getTime() - activity < 6 * 3600000) return false;
  const [season] = await db
    .select({ sport: competitions.sport })
    .from(competitions)
    .where(eq(competitions.id, match.competitionId));
  if (!season) throw new Error("Scored season is missing");
  const state = replayScoringState(season.sport, rows.map(persistedMatchEvent));
  if (state.attempt !== match.attempt || state.lastSeq !== match.lastSeq)
    throw new Error("Scoring revision is inconsistent");
  if (state.finished || !["live", "interrupted"].includes(state.phase)) return false;
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!fixture) throw new Error("Scored fixture is missing");
  await db
    .update(matches)
    .set({ phase: "stalled", updatedAt: now })
    .where(eq(matches.fixtureId, fixtureId));
  await db.insert(auditLog).values({
    id: newId(),
    actor: SCORING_SYSTEM_ACTOR,
    action: "match.stalled",
    scopeType: "org",
    scopeId: match.orgId,
    subject: fixtureId,
    meta: { attempt: match.attempt },
    at: now,
  });
  await writeLiveState(db, {
    fixtureId,
    orgId: match.orgId,
    competitionId: match.competitionId,
    kickoffAt: fixture.kickoffAt,
    startedAt: match.startedAt,
    state,
    phase: "stalled",
    now,
  });
  return true;
}
async function quietEligible(db: Db, fixtureId: string, now: Date) {
  const match = await lockedMatch(db, fixtureId);
  if (!match || match.phase !== "live") return null;
  const [ball] = await db
    .select({ receivedAt: matchEvents.receivedAt })
    .from(matchEvents)
    .where(
      and(
        eq(matchEvents.fixtureId, fixtureId),
        eq(matchEvents.attempt, match.attempt),
        inArray(matchEvents.type, ["ball", "rally"]),
      ),
    )
    .orderBy(desc(matchEvents.receivedAt))
    .limit(1);
  const lastBall = ball?.receivedAt ?? match.startedAt ?? match.createdAt;
  return now.getTime() - lastBall.getTime() >= 15 * 60000 ? match : null;
}
export async function quietScoring(handle: DbHandle, orgId: string, fixtureId: string, now: Date) {
  const recipients = await withTenantDb(
    handle,
    { personId: SCORING_SYSTEM_ACTOR, orgId },
    async (db) => ((await quietEligible(db, fixtureId, now)) ? organizersOf(db, orgId) : []),
  );
  let queued = 0;
  for (const personId of recipients) {
    queued += await withTenantDb(handle, { personId, orgId }, async (db) => {
      const match = await quietEligible(db, fixtureId, now);
      if (!match) return 0;
      if (!(await organizersOf(db, orgId)).includes(personId)) return 0;
      const [told] = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.scopeType, "person"),
            eq(auditLog.scopeId, personId),
            eq(auditLog.action, "match.quiet"),
            eq(auditLog.subject, fixtureId),
            gte(auditLog.at, new Date(now.getTime() - 30 * 60000)),
          ),
        )
        .limit(1);
      if (
        told ||
        !(
          await notificationGate(db, {
            kind: "match.quiet",
            channel: "in_app",
            recipient: { personId, contact: "" },
            orgId,
            now,
          })
        ).send
      )
        return 0;
      await db.insert(auditLog).values({
        id: newId(),
        actor: personId,
        action: "match.quiet",
        scopeType: "person",
        scopeId: personId,
        subject: fixtureId,
        meta: { orgId, fixtureId, competitionId: match.competitionId },
        at: now,
      });
      return 1;
    });
  }
  return queued;
}
export async function sweepScoring(
  options: { now?: Date; readDb?: Db; handle?: DbHandle; fixtureIds?: readonly string[] } = {},
) {
  const now = options.now ?? new Date(),
    readDb = options.readDb ?? systemDb,
    handle = options.handle ?? dbHandle;
  // Scheduled-job discovery is identity-only; eligibility is rechecked under tenant locks.
  const candidates = await readDb
    .select({ fixtureId: matches.fixtureId, orgId: matches.orgId })
    .from(matches)
    .where(
      or(
        isNotNull(matches.finishedAt),
        inArray(matches.phase, [
          "toss",
          "live",
          "interrupted",
          "innings_break",
          "result_reached",
          "stalled",
          ...terminal,
        ]),
      ),
    );
  const selected = candidates.filter(
    (c) => options.fixtureIds === undefined || options.fixtureIds.includes(c.fixtureId),
  );
  const failures: string[] = [];
  async function step(kind: "seal" | "stall" | "quiet" | "trust") {
    let changed = 0;
    for (const candidate of selected) {
      try {
        if (kind === "quiet") {
          changed += await quietScoring(handle, candidate.orgId, candidate.fixtureId, now);
          continue;
        }
        const result = await withTenantDb(
          handle,
          { personId: SCORING_SYSTEM_ACTOR, orgId: candidate.orgId },
          async (db) =>
            kind === "seal"
              ? sealScoring(db, candidate.fixtureId, now)
              : kind === "trust"
                ? refreshScoringTrust(db, candidate.fixtureId, now)
                : stallScoring(db, candidate.fixtureId, now),
        );
        if (result) {
          changed += 1;
          if (typeof result === "object") revalidateScoredMatch(result.effect);
        }
      } catch (error) {
        failures.push(`${kind}:${candidate.fixtureId}`);
        logger().warn(
          { err: error, fixtureId: candidate.fixtureId, step: kind },
          "scoring.sweep_match_failed",
        );
      }
    }
    return changed;
  }
  const finalized = await step("seal").catch(() => "failed" as const);
  const stalled = await step("stall").catch(() => "failed" as const);
  const quiet = await step("quiet").catch(() => "failed" as const);
  const trustRefreshed = await step("trust").catch(() => "failed" as const);
  await recoverResultNotices(readDb, reminderBoundariesFor(handle), options.fixtureIds).catch(
    (error: unknown) => {
      failures.push("result_notices");
      logger().warn({ err: error }, "scoring.result_notices_recovery_failed");
    },
  );
  await recoverGuestClaimInvites(readDb, reminderBoundariesFor(handle), options.fixtureIds).catch(
    (error: unknown) => {
      failures.push("guest_claim_notices");
      logger().warn({ err: error }, "scoring.guest_claim_notice_recovery_failed");
    },
  );
  for (const candidate of selected) {
    try {
      await dispatchConfirmationNotices(
        candidate.orgId,
        candidate.fixtureId,
        reminderBoundariesFor(handle),
        now,
      );
      await dispatchTossReminders(candidate.orgId, candidate.fixtureId, {
        now,
        ...(options.handle ? { boundaries: reminderBoundariesFor(options.handle) } : {}),
      });
    } catch (error) {
      failures.push(`reminder:${candidate.fixtureId}`);
      logger().warn(
        { err: error, fixtureId: candidate.fixtureId },
        "scoring.toss_reminder_recovery_failed",
      );
    }
  }
  return { finalized, stalled, quiet, trustRefreshed, failures };
}
