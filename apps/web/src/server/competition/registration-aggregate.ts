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
import {
  auctions,
  auditLog,
  competitions,
  newId,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

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
  if (next === "withdrawn" || next === "rejected") {
    Object.assign(fields, LEAVES_THE_SQUAD);
  }
  return fields;
}

/**
 * A PLAYER WHO LEAVES THE SEASON LEAVES THEIR SQUAD (audit P1-9).
 *
 * Withdrawing or rejecting used to change the status and nothing else, so a
 * pre-signed captain who dropped out kept `team_id` and the armband. Every
 * reader that asks "who is on this team?" by `team_id` alone — the squad
 * counts, the engine's squad cap — went on counting them, while the lineups and
 * squad sheets, which ask for approved players, did not: two screens, two
 * squads. The marks go with the team, because a mark with no team is exactly
 * the orphan the player sheet warns about.
 *
 * Unconditional, and safe to be: the one row whose team is NOT ours to clear —
 * an approved player once the auction has opened, whose team the sale may have
 * written — can no longer reach `withdrawn` (see `rosterLockRefuses`), and a
 * row that was never approved was never in the pool the auction settled.
 */
const LEAVES_THE_SQUAD = {
  teamId: null,
  isIcon: false,
  isCaptain: false,
  isRetained: false,
} as const;

/**
 * The season's auction, read FOR SHARE inside the caller's transaction.
 *
 * Opening an auction UPDATEs its row and then settles the pool from
 * `registrations` in the same transaction (`settlePool`, packages/auction). A
 * roster write that decided "still scheduled" from a plain read could commit
 * after that UPDATE and before or during the settle — a captain marked into a
 * pool that had already been drawn without them. Taking a share lock on the
 * row serializes the two: if we lock first, the open waits for our commit and
 * its settle (READ COMMITTED, a fresh snapshot per statement) sees our write;
 * if the open updated first, we wait for it and read `live`.
 *
 * Only meaningful inside a transaction — every server-action boundary is one
 * (`withTenantDb`).
 */
export async function rosterAuction(
  db: Db,
  competitionId: string,
): Promise<{ id: string; status: string } | null> {
  const [row] = await db
    .select({ id: auctions.id, status: auctions.status })
    .from(auctions)
    .where(eq(auctions.competitionId, competitionId))
    .orderBy(desc(auctions.createdAt))
    .limit(1)
    .for("share");
  return row ?? null;
}

/** The roster belongs to the auction once it has left `scheduled` (P2-3, DA-04). */
export function auctionHoldsRoster(auction: { status: string } | null): boolean {
  return auction !== null && auction.status !== "scheduled";
}

/**
 * WITHDRAWING A POOL PLAYER, ONCE THE AUCTION HAS OPENED (audit F-D2).
 *
 * Core allows approved → withdrawn because it cannot see the auction. The
 * player's own withdraw was refused mid-auction; the organizer's was not, so a
 * player already on the block — or already sold and paid for — could be
 * withdrawn out from under the ledger. The rule lives here, in the aggregate,
 * so the single path, the bulk path and the player's path all obey it.
 */
async function rosterLockRefuses(
  tx: Db,
  competitionId: string,
  from: RegistrationStatus,
  event: RegistrationEvent,
): Promise<boolean> {
  if (!rosterLockCandidate(from, event)) {
    return false;
  }
  return auctionHoldsRoster(await rosterAuction(tx, competitionId));
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
  /** An approved player cannot be withdrawn once the auction has opened. */
  | { ok: false; reason: "roster_locked" }
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
  const outcome = await db.transaction(
    async (tx): Promise<{ tierLimited: string } | "raced" | "roster_locked" | null> => {
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
      if (await rosterLockRefuses(tx, competitionId, current.status, event)) {
        return "roster_locked";
      }
      /*
       * COMPARE-AND-SET (audit F-D3). The status was read before this
       * transaction and core decided against it; the write only lands if it is
       * still that status. Two organizers acting on one row at once — approve
       * and withdraw, say — used to both "succeed", the later overwriting the
       * earlier with a decision made about a state that no longer existed.
       */
      const written = await tx
        .update(registrations)
        .set(mutationFields(event, decision.next, reviewerId))
        .where(and(eq(registrations.id, registrationId), eq(registrations.status, current.status)))
        .returning({ id: registrations.id });
      if (written.length === 0) {
        return "raced";
      }
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
    },
  );
  if (outcome === "raced") {
    return { ok: false, reason: "illegal_transition" };
  }
  if (outcome === "roster_locked") {
    return { ok: false, reason: "roster_locked" };
  }
  if (outcome !== null) {
    return { ok: false, reason: "tier_limit", message: outcome.tierLimited };
  }
  await notifyPlayer(db, [registrationId], event);
  return { ok: true, status: decision.next };
}

export interface BatchResult {
  applied: string[];
  skipped: {
    id: string;
    reason: "illegal_transition" | "reason_required" | "tier_limit" | "roster_locked";
  }[];
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
  const fromOf = new Map(rows.map((r) => [r.id, r.status]));
  let apply = plan.apply;
  const written: string[] = [];
  if (apply.length > 0) {
    await db.transaction(async (tx) => {
      // The single path's roster lock, decided once for the batch: the
      // auction's state is one fact, and only approved rows are held by it.
      if (apply.some((entry) => rosterLockCandidate(fromOf.get(entry.id), event))) {
        if (auctionHoldsRoster(await rosterAuction(tx, competitionId))) {
          for (const entry of apply) {
            if (rosterLockCandidate(fromOf.get(entry.id), event)) {
              skipped.push({ id: entry.id, reason: "roster_locked" });
            }
          }
          apply = apply.filter((entry) => !rosterLockCandidate(fromOf.get(entry.id), event));
        }
      }
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
        const from = fromOf.get(entry.id);
        // Compare-and-set, as in `transition`: a row that moved since the plan
        // was read is skipped exactly as a single call on it would refuse.
        const updated =
          from === undefined
            ? []
            : await tx
                .update(registrations)
                .set(mutationFields(event, entry.next, reviewerId))
                .where(and(eq(registrations.id, entry.id), eq(registrations.status, from)))
                .returning({ id: registrations.id });
        if (updated.length === 0) {
          skipped.push({ id: entry.id, reason: "illegal_transition" });
          continue;
        }
        written.push(entry.id);
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
  const applied = written;
  await notifyPlayer(db, applied, event);
  return { applied, skipped };
}

function rosterLockCandidate(
  from: RegistrationStatus | undefined,
  event: RegistrationEvent,
): boolean {
  return event.type === "withdraw" && from === "approved";
}

/**
 * A team id from the browser is a claim, not a fact (audit P3). `team_id` is a
 * plain foreign key to `teams`, so without this any team in the org — another
 * season's, even — could be written onto this season's player, and every
 * squad count keyed on this season's teams would quietly lose them.
 * `updateTeamDetails` has always asked the same question.
 */
async function teamInSeason(db: Db, competitionId: string, teamId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.competitionId, competitionId)))
    .limit(1);
  return row !== undefined;
}

export type AssignTeamResult =
  { ok: true } | { ok: false; reason: "not_found" | "unknown_team" | "not_approved" };

/** Assign (or clear) a pre-auction team grouping — an audited registration mutation. */
export async function assignTeam(
  db: Db,
  orgId: string,
  competitionId: string,
  registrationId: string,
  teamId: string | null,
  actorId: string,
): Promise<AssignTeamResult> {
  if (teamId !== null && !(await teamInSeason(db, competitionId, teamId))) {
    return { ok: false, reason: "unknown_team" };
  }
  return db.transaction(async (tx): Promise<AssignTeamResult> => {
    // Clearing is always allowed; putting a player ON a squad is only for the
    // approved — see `setRegistrationMarks`.
    const written = await tx
      .update(registrations)
      .set({ teamId })
      .where(
        and(
          eq(registrations.id, registrationId),
          eq(registrations.competitionId, competitionId),
          ...(teamId !== null ? [eq(registrations.status, "approved")] : []),
        ),
      )
      .returning({ id: registrations.id });
    if (written.length === 0) {
      // No audit row for a write that did not happen — the timeline would
      // otherwise claim a team change on a player it never touched.
      const [exists] = await tx
        .select({ id: registrations.id })
        .from(registrations)
        .where(
          and(eq(registrations.id, registrationId), eq(registrations.competitionId, competitionId)),
        )
        .limit(1);
      return { ok: false, reason: exists === undefined ? "not_found" : "not_approved" };
    }
    await tx.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "registration.team_assigned",
      scopeType: "org",
      scopeId: orgId,
      subject: registrationId,
      meta: teamId !== null ? { teamId } : {},
    });
    return { ok: true };
  });
}

export type MarksResult =
  { ok: true } | { ok: false; reason: "not_found" | "unknown_team" | "not_approved" };

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
 *
 * ONLY AN APPROVED PLAYER CAN BE PUT ON A SQUAD (audit P1-9). A mark or a team
 * on a submitted, waitlisted, rejected or withdrawn row is a pre-signing of
 * somebody who is not in the season: the squad counts ask for approved
 * players, so it would be invisible there and still hold the team's armband
 * on `registrations_team_captain_uq`. CLEARING stays open on every row — it is
 * how an organizer tidies a mark left on a row before this rule existed.
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
      status: registrations.status,
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
  const adds =
    set.isIcon === true ||
    set.isRetained === true ||
    set.isCaptain === true ||
    (set.teamId !== undefined && set.teamId !== null);
  if (adds && stored.status !== "approved") {
    return { ok: false, reason: "not_approved" };
  }
  if (
    set.teamId !== undefined &&
    set.teamId !== null &&
    !(await teamInSeason(db, competitionId, set.teamId))
  ) {
    return { ok: false, reason: "unknown_team" };
  }
  const written = await db
    .transaction(async (tx) => {
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
      // The status the check above read, compared again at the write: a
      // withdrawal committed in between must not be followed by a pre-signing.
      const updated = await tx
        .update(registrations)
        .set(set)
        .where(
          and(
            eq(registrations.id, registrationId),
            eq(registrations.competitionId, competitionId),
            eq(registrations.status, stored.status),
          ),
        )
        .returning({ id: registrations.id });
      if (updated.length === 0) {
        // Throwing rolls back the demote above with it.
        throw new MarksRaced();
      }
      await tx.insert(auditLog).values({
        id: newId(),
        actor: actorId,
        action: "registration.marks_set",
        scopeType: "org",
        scopeId: orgId,
        subject: registrationId,
        meta: Object.fromEntries(Object.entries(set).map(([key, value]) => [key, String(value)])),
      });
      return true;
    })
    .catch((error: unknown) => {
      if (error instanceof MarksRaced) {
        return false;
      }
      throw error;
    });
  return written ? { ok: true } : { ok: false, reason: "not_approved" };
}

/** The row's status moved between the check and the write. */
class MarksRaced extends Error {}

/** Append an organizer note to a registration's timeline (append-only audit). */
export async function addNote(
  db: Db,
  orgId: string,
  competitionId: string,
  registrationId: string,
  actorId: string,
  note: string,
): Promise<{ ok: boolean }> {
  const trimmed = note.trim();
  if (trimmed === "") {
    return { ok: false };
  }
  // The capability was checked for THIS season; the note must land on one of
  // its registrations, not on any id the browser names (audit P3).
  const [target] = await db
    .select({ id: registrations.id })
    .from(registrations)
    .where(
      and(eq(registrations.id, registrationId), eq(registrations.competitionId, competitionId)),
    )
    .limit(1);
  if (target === undefined) {
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
