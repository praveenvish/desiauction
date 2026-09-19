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
import type { RegistrationEditSet } from "./registration-edit";

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
  const approving = decision.next === "approved" && current.status !== "approved";
  const outcome = await db.transaction(async (tx): Promise<{ tierLimited: string } | null> => {
    /*
     * THE POOL CEILING, MADE ATOMIC (PRR P2/F37).
     *
     * The count was read BEFORE the transaction, so two organizers approving at
     * once could both see "39 of 40", both pass, and both commit — 41 in a
     * 40-player tier. A transaction-scoped advisory lock keyed on the
     * competition serializes approvals for THAT season (others are unaffected),
     * and the count-then-decide now happens inside the same transaction, so the
     * ceiling holds under concurrency. The lock releases automatically on commit.
     */
    if (approving) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('registration-approval'), hashtext(${competitionId}))`,
      );
      const limited = await poolLimit(tx, competitionId);
      if (limited !== null) {
        return { tierLimited: limited };
      }
    }
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
    return null;
  });
  if (outcome !== null) {
    return { ok: false, reason: "tier_limit", message: outcome.tierLimited };
  }
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
   * THE POOL CEILING, ON THE BATCH PATH TOO — ATOMIC (PRR P2/F37 re-validation).
   *
   * `transition` (single) takes a per-competition advisory lock and counts the
   * pool INSIDE the transaction so the ceiling holds under concurrency; the batch
   * twin must do the same, or two bulk-approves reading the same "remaining"
   * jointly sail a Free season past its forty. So the count-and-decide moves
   * inside the same advisory-locked transaction, exactly like the single path.
   * Only the approve event grows the pool.
   */
  let apply = plan.apply;
  if (apply.length > 0) {
    await db.transaction(async (tx) => {
      if (event.type === "approve") {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('registration-approval'), hashtext(${competitionId}))`,
        );
        const remaining = await poolRemaining(tx, competitionId);
        if (remaining !== null && apply.length > remaining) {
          for (const entry of apply.slice(remaining)) {
            skipped.push({ id: entry.id, reason: "tier_limit" });
          }
          apply = apply.slice(0, remaining);
        }
      }
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

export type MarksResult = { ok: true } | { ok: false; reason: "not_found" };

/**
 * Set organizer marks on a registration: icon (pre-signed marquee, excluded from
 * the auction), retained (kept from a prior season, excluded the same way),
 * captain, and/or the pre-auction team. Any omitted field is left unchanged.
 * Append-only audit, same pattern as assignTeam.
 *
 * RETENTION HAD NO WRITER UNTIL NOW, which is the odd part. `is_retained` has
 * been read in eight places since migration 0018 — the auction pool excludes
 * it, `placeBid` counts it into the squad cap, the poster prints "RETAINED",
 * the career page and the public showcase both render it — and nothing could
 * set it. Every consequence of retaining a player was built; retaining one
 * required hand-written SQL.
 *
 * NO MARK IS EXCLUSIVE WITH ANY OTHER. All three answer the same question —
 * "does this player skip the auction and join their team directly?" — for three
 * different reasons, and a real player can have every reason at once: last
 * season's captain, retained, and the marquee name on the poster. The pool
 * filter, the squad cap and the orphan warning all read `isPreSigned` (any of
 * the three), so no arithmetic double-counts; where a surface must print ONE
 * word, `preSignedKind` gives Icon precedence, then Captain, then Retained.
 *
 * Icon and Captain used to be refused together, on the reasoning that an Icon
 * "never goes under the hammer" while a Captain "leads a squad that plays". That
 * only held while captains were auctioned. Local leagues pick their captains
 * before the night — the founder's first real season did exactly that and
 * expected the captain to stay out of the pool — and the marquee player is
 * very often the captain. The refusal blocked the commonest case there is.
 */
export async function setRegistrationMarks(
  db: Db,
  orgId: string,
  competitionId: string,
  registrationId: string,
  marks: { isIcon?: boolean; isRetained?: boolean; isCaptain?: boolean; teamId?: string | null },
  actorId: string,
): Promise<MarksResult> {
  const set: Partial<{
    isIcon: boolean;
    isRetained: boolean;
    isCaptain: boolean;
    teamId: string | null;
  }> = {};
  if (marks.isIcon !== undefined) {
    set.isIcon = marks.isIcon;
  }
  if (marks.isRetained !== undefined) {
    set.isRetained = marks.isRetained;
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
  await db.transaction(async (tx) => {
    // DA-04: a team has exactly one captain. `registrations_team_captain_uq`
    // makes two unrepresentable, so the armband has to CHANGE HANDS rather
    // than collide — an organiser naming a new captain means "this player
    // instead", not "error". The demote is scoped to the team the registration
    // is landing on, which is the one in this update when the caller moves it
    // and the stored one otherwise.
    //
    // The EFFECTIVE captaincy, not the patch alone: moving a player who is
    // already captain onto a team that has one is the same collision as naming
    // them captain there, and it used to surface as a raw unique violation.
    const landingTeamId = set.teamId !== undefined ? set.teamId : stored.teamId;
    const landsAsCaptain = set.isCaptain ?? stored.isCaptain;
    if (landsAsCaptain && landingTeamId !== null) {
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

/**
 * Write an organizer's in-place correction — validated by `planRegistrationEdit`
 * before it gets here — and say so on the timeline.
 *
 * The audit records WHICH fields changed, never their values: a note or a
 * father's name copied into an append-only log would outlive the erasure that
 * removes it from the row.
 */
export async function updateRegistrationDetails(
  db: Db,
  orgId: string,
  competitionId: string,
  registrationId: string,
  set: RegistrationEditSet,
  changed: readonly string[],
  actorId: string,
): Promise<{ ok: boolean }> {
  if (changed.length === 0) {
    return { ok: true };
  }
  return db.transaction(async (tx) => {
    const updated =
      Object.keys(set).length === 0
        ? [{ id: registrationId }]
        : await tx
            .update(registrations)
            .set(set)
            .where(
              and(
                eq(registrations.id, registrationId),
                eq(registrations.competitionId, competitionId),
              ),
            )
            .returning({ id: registrations.id });
    if (updated.length === 0) {
      return { ok: false };
    }
    await tx.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "registration.details_edited",
      scopeType: "org",
      scopeId: orgId,
      subject: registrationId,
      meta: { fields: changed.join(",") },
    });
    return { ok: true };
  });
}
