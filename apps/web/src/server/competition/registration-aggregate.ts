import {
  checkTierLimit,
  isTier,
  limitRefusalMessage,
  planRegistrationBatch,
  registrationTransition,
  TIER_LIMITS,
  type RegistrationBatchItem,
  type RegistrationEvent,
  type RegistrationStatus,
  type Tier,
} from "@desiauction/core";
import { auditLog, competitions, newId, registrations, type Db } from "@desiauction/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { logSecurityEvent, type SecurityAction } from "../auth/security-events";

// THE COMPETITION REGISTRATION AGGREGATE (M-IP3-2). This module is the ONLY place
// registration state mutates. Routes/services call it; nothing else writes the
// `status` column. Every transition is decided by core's pure machine, applied in
// a transaction with its audit row (so a state change and its evidence commit
// together), and — for bulk — behaves identically to N individual actions
// because it executes core's plan (planRegistrationBatch) verbatim.

interface AuditFields {
  status?: RegistrationStatus;
  rejectionReason?: string;
  rejectionNote?: string | null;
}

function mutationFields(
  event: RegistrationEvent,
  next: RegistrationStatus,
  reviewerId: string,
): Record<string, unknown> {
  const base: AuditFields = { status: next };
  const fields: Record<string, unknown> = {
    ...base,
    reviewedBy: reviewerId,
    reviewedAt: new Date(),
  };
  if (event.type === "reject") {
    fields["rejectionReason"] = event.reason;
    if (event.note !== undefined) {
      fields["rejectionNote"] = event.note;
    }
  }
  if (event.type === "restore") {
    // Clear stale rejection provenance when a registration is put back in triage.
    fields["rejectionReason"] = null;
    fields["rejectionNote"] = null;
  }
  return fields;
}

function auditMeta(event: RegistrationEvent): Record<string, string> {
  return event.type === "reject" ? { reason: event.reason } : {};
}

/**
 * DA-19: tell the PLAYER what was decided. The organiser's audit row is scoped
 * to the org and invisible to them; this is the same append-only substrate,
 * scoped to the person, which is exactly what /inbox reads.
 *
 * Best-effort by design: a notification must never fail an approval. The
 * decision and its org-scoped evidence have already committed by the time we
 * get here.
 */
const PLAYER_NOTICE: Partial<Record<RegistrationEvent["type"], SecurityAction>> = {
  approve: "registration.approved",
  reject: "registration.rejected",
  waitlist: "registration.waitlisted",
};

async function notifyPlayer(
  db: Db,
  registrationIds: readonly string[],
  event: RegistrationEvent,
): Promise<void> {
  const action = PLAYER_NOTICE[event.type];
  if (action === undefined || registrationIds.length === 0) {
    return;
  }
  const rows = await db
    .select({ personId: registrations.personId, competitionId: registrations.competitionId })
    .from(registrations)
    .where(inArray(registrations.id, registrationIds as string[]));
  for (const row of rows) {
    try {
      await logSecurityEvent(row.personId, action, { competitionId: row.competitionId });
    } catch {
      // A player who misses a notification still has the decision; a player
      // whose approval was rolled back by a failed notification does not.
    }
  }
}

export type TransitionResult =
  | { ok: true; status: RegistrationStatus }
  | { ok: false; reason: "not_found" | "illegal_transition" | "reason_required" }
  /** The season's pass covers fewer pool players than this approval would make. */
  | { ok: false; reason: "tier_limit"; message: string };

/**
 * The pool ceiling for a competition, or null when there is room.
 *
 * Returns the sentence rather than a code: every caller renders it, and a
 * commercial refusal that reads as an enum sends an organizer hunting for a bug.
 */
async function poolLimit(db: Db, competitionId: string): Promise<string | null> {
  const [season] = await db
    .select({ tier: competitions.tier })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .limit(1);
  const [{ count: approved } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(
      and(eq(registrations.competitionId, competitionId), eq(registrations.status, "approved")),
    );
  const decision = checkTierLimit(season?.tier ?? "free", "players", approved);
  return decision.ok ? null : limitRefusalMessage(decision);
}

/**
 * How many more pool players this season may approve, or `null` when the tier
 * is uncounted. The batch path needs the NUMBER — a single boolean cannot say
 * "you may approve 3 of these 50", which is what approving one-by-one would do.
 */
async function poolRemaining(db: Db, competitionId: string): Promise<number | null> {
  const [season] = await db
    .select({ tier: competitions.tier })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .limit(1);
  const tier: Tier = isTier(season?.tier ?? "") ? (season?.tier as Tier) : "free";
  const limit = TIER_LIMITS[tier].players;
  if (limit === null) {
    return null;
  }
  const [{ count: approved } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(
      and(eq(registrations.competitionId, competitionId), eq(registrations.status, "approved")),
    );
  return Math.max(0, limit - approved);
}

/** Single audited transition — the aggregate's atomic unit. */
export async function transition(
  db: Db,
  orgId: string,
  competitionId: string,
  registrationId: string,
  reviewerId: string,
  event: RegistrationEvent,
): Promise<TransitionResult> {
  const [current] = await db
    .select({ status: registrations.status })
    .from(registrations)
    .where(
      and(eq(registrations.id, registrationId), eq(registrations.competitionId, competitionId)),
    )
    .limit(1);
  if (current === undefined) {
    return { ok: false, reason: "not_found" };
  }
  const decision = registrationTransition(current.status, event);
  if (!decision.ok) {
    return { ok: false, reason: decision.reason };
  }
  /*
   * THE POOL CEILING, AT THE ONE MOMENT THE POOL GROWS.
   *
   * The pricing page's other half — "40 players" on Free — is checked here and
   * only here. NOT at submission: a season filling up is the organizer's
   * commercial problem, and turning a player away at the registration form for
   * it would punish the wrong person and lose a name the organizer may well
   * want. A player may always apply; approving them into the pool is the
   * organizer's act, and it is the act that costs.
   */
  if (decision.next === "approved" && current.status !== "approved") {
    const limited = await poolLimit(db, competitionId);
    if (limited !== null) {
      return { ok: false, reason: "tier_limit", message: limited };
    }
  }
  await db.transaction(async (tx) => {
    await tx
      .update(registrations)
      .set(mutationFields(event, decision.next, reviewerId))
      .where(eq(registrations.id, registrationId));
    await tx.insert(auditLog).values({
      id: newId(),
      actor: reviewerId,
      action: `registration.${event.type}`,
      scopeType: "org",
      scopeId: orgId,
      subject: registrationId,
      meta: auditMeta(event),
    });
  });
  await notifyPlayer(db, [registrationId], event);
  return { ok: true, status: decision.next };
}

export interface BatchResult {
  applied: string[];
  skipped: { id: string; reason: "illegal_transition" | "reason_required" | "tier_limit" }[];
}

/**
 * Bulk audited transition. Loads the selected registrations' current states,
 * asks core for the plan (identical to N individual decisions), and applies the
 * whole plan in ONE transaction — rollback-safe: a mid-batch failure leaves no
 * partial state. Each applied transition writes its own audit row.
 */
export async function transitionBatch(
  db: Db,
  orgId: string,
  competitionId: string,
  registrationIds: readonly string[],
  reviewerId: string,
  event: RegistrationEvent,
): Promise<BatchResult> {
  if (registrationIds.length === 0) {
    return { applied: [], skipped: [] };
  }
  const rows = await db
    .select({ id: registrations.id, status: registrations.status })
    .from(registrations)
    .where(
      and(
        eq(registrations.competitionId, competitionId),
        inArray(registrations.id, registrationIds as string[]),
      ),
    );
  const items: RegistrationBatchItem[] = rows.map((r) => ({ id: r.id, status: r.status }));
  const plan = planRegistrationBatch(items, event);
  const known = new Set(rows.map((r) => r.id));
  const skipped: BatchResult["skipped"] = [
    ...plan.skip,
    // Ids not in this competition are silently not-applied (tenant safety).
    ...registrationIds
      .filter((id) => !known.has(id))
      .map((id) => ({ id, reason: "illegal_transition" as const })),
  ];

  /*
   * THE POOL CEILING, ON THE BATCH PATH TOO.
   *
   * `transition` (single) checks poolLimit before it grows the pool; the batch
   * twin must behave identically to N single approvals — approve the ones that
   * fit under the tier, refuse the rest. Approving fifty in one click must not
   * sail a Free season past its forty. Only the approve event grows the pool.
   */
  let apply = plan.apply;
  if (event.type === "approve") {
    const remaining = await poolRemaining(db, competitionId);
    if (remaining !== null && plan.apply.length > remaining) {
      apply = plan.apply.slice(0, remaining);
      for (const entry of plan.apply.slice(remaining)) {
        skipped.push({ id: entry.id, reason: "tier_limit" });
      }
    }
  }

  if (apply.length > 0) {
    await db.transaction(async (tx) => {
      for (const entry of apply) {
        await tx
          .update(registrations)
          .set(mutationFields(event, entry.next, reviewerId))
          .where(eq(registrations.id, entry.id));
        await tx.insert(auditLog).values({
          id: newId(),
          actor: reviewerId,
          action: `registration.${event.type}`,
          scopeType: "org",
          scopeId: orgId,
          subject: entry.id,
          meta: auditMeta(event),
        });
      }
    });
  }
  const applied = apply.map((entry) => entry.id);
  await notifyPlayer(db, applied, event);
  return { applied, skipped };
}

/** Assign (or clear) a pre-auction team grouping — an audited registration mutation. */
export async function assignTeam(
  db: Db,
  orgId: string,
  competitionId: string,
  registrationId: string,
  teamId: string | null,
  actorId: string,
): Promise<{ ok: boolean }> {
  await db.transaction(async (tx) => {
    await tx
      .update(registrations)
      .set({ teamId })
      .where(
        and(eq(registrations.id, registrationId), eq(registrations.competitionId, competitionId)),
      );
    await tx.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "registration.team_assigned",
      scopeType: "org",
      scopeId: orgId,
      subject: registrationId,
      meta: teamId !== null ? { teamId } : {},
    });
  });
  return { ok: true };
}

export type MarksResult = { ok: true } | { ok: false; reason: "not_found" | "icon_and_captain" };

/**
 * Set organizer marks on a registration: icon (pre-signed marquee, excluded from
 * the auction), captain, and/or the pre-auction team. Any omitted field is left
 * unchanged. Append-only audit, same pattern as assignTeam.
 *
 * INVARIANT: a registration is never both Icon and Captain. An Icon is
 * pre-signed and never goes under the hammer; a Captain leads a squad that
 * plays. Both at once is a player the auction skips and the team expects to
 * lead — a contradiction about ONE person, and the write path is the authority.
 *
 * Note the DA-04 rule immediately below, and why it does NOT extend here. Two
 * players competing for one armband is a preference — the organiser means "this
 * player instead", so the previous captain is demoted. This is not that. There
 * is no second player to prefer, and silently clearing a mark the organiser set
 * would move the armband without telling them: exactly the invisible state
 * change the Icon work is fixing. So: refuse, and say why.
 */
export async function setRegistrationMarks(
  db: Db,
  orgId: string,
  competitionId: string,
  registrationId: string,
  marks: { isIcon?: boolean; isCaptain?: boolean; teamId?: string | null },
  actorId: string,
): Promise<MarksResult> {
  const set: Partial<{ isIcon: boolean; isCaptain: boolean; teamId: string | null }> = {};
  if (marks.isIcon !== undefined) {
    set.isIcon = marks.isIcon;
  }
  if (marks.isCaptain !== undefined) {
    set.isCaptain = marks.isCaptain;
  }
  if (marks.teamId !== undefined) {
    set.teamId = marks.teamId;
  }
  if (Object.keys(set).length === 0) {
    return { ok: true };
  }
  const [stored] = await db
    .select({
      isIcon: registrations.isIcon,
      isCaptain: registrations.isCaptain,
      teamId: registrations.teamId,
    })
    .from(registrations)
    .where(
      and(eq(registrations.id, registrationId), eq(registrations.competitionId, competitionId)),
    )
    .limit(1);
  if (stored === undefined) {
    return { ok: false, reason: "not_found" };
  }
  // The EFFECTIVE state after this patch, not the patch alone: setting
  // `isIcon: true` on a row that is already Captain is the same contradiction
  // as sending both flags in one call.
  const effectiveIcon = set.isIcon ?? stored.isIcon;
  const effectiveCaptain = set.isCaptain ?? stored.isCaptain;
  if (effectiveIcon && effectiveCaptain) {
    return { ok: false, reason: "icon_and_captain" };
  }
  await db.transaction(async (tx) => {
    // DA-04: a team has exactly one captain. `registrations_team_captain_uq`
    // makes two unrepresentable, so the armband has to CHANGE HANDS rather
    // than collide — an organiser naming a new captain means "this player
    // instead", not "error". The demote is scoped to the team the registration
    // is landing on, which is the one in this update when the caller moves it
    // and the stored one otherwise.
    const landingTeamId = set.teamId !== undefined ? set.teamId : stored.teamId;
    if (set.isCaptain === true && landingTeamId !== null) {
      await tx
        .update(registrations)
        .set({ isCaptain: false })
        .where(
          and(
            eq(registrations.competitionId, competitionId),
            eq(registrations.teamId, landingTeamId),
            eq(registrations.isCaptain, true),
            ne(registrations.id, registrationId),
          ),
        );
    }
    await tx
      .update(registrations)
      .set(set)
      .where(
        and(eq(registrations.id, registrationId), eq(registrations.competitionId, competitionId)),
      );
    await tx.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "registration.marks_set",
      scopeType: "org",
      scopeId: orgId,
      subject: registrationId,
      meta: Object.fromEntries(Object.entries(set).map(([key, value]) => [key, String(value)])),
    });
  });
  return { ok: true };
}

/** Append an organizer note to a registration's timeline (append-only audit). */
export async function addNote(
  db: Db,
  orgId: string,
  registrationId: string,
  actorId: string,
  note: string,
): Promise<{ ok: boolean }> {
  const trimmed = note.trim();
  if (trimmed === "") {
    return { ok: false };
  }
  await db.insert(auditLog).values({
    id: newId(),
    actor: actorId,
    action: "registration.note",
    scopeType: "org",
    scopeId: orgId,
    subject: registrationId,
    meta: { note: trimmed.slice(0, 500) },
  });
  return { ok: true };
}
