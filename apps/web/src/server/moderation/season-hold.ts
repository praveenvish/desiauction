import { auditLog, competitions, newId, type Db } from "@desiauction/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

/**
 * THE PLATFORM HOLD — the one way DesiAuction itself takes a public page down.
 *
 * A published season is on the open web: its page, its player pages, its share
 * cards, the directory, the sitemap. Every one of those reads a single column,
 * `competitions.visibility` (see competition/public.ts), so a hold does exactly
 * two things in one statement: it makes the season private, and it stamps why.
 * Migration 0072's CHECK then keeps the season private for as long as the hold
 * stands, so no publishing path — the organizer's toggle, a script, a future
 * feature — can put it back.
 *
 * What a hold does NOT do: delete anything, touch registrations, stop an
 * auction or lock the club out. The club keeps running its season. The hold
 * removes only what strangers can read.
 *
 * Callers run this inside the season's own tenant boundary (`inOrg`), on the
 * application role: `competitions` is under RLS and the system role has no
 * UPDATE on it. The operator is not a member of the club; the boundary names
 * the club, and the platform gate that admitted the operator ran first.
 */

export const HOLD_REASON_MIN = 10;
export const HOLD_REASON_MAX = 500;

export const SEASON_HELD_ACTION = "competition.platform_held";
export const SEASON_HOLD_LIFTED_ACTION = "competition.platform_hold_lifted";

export type HoldOutcome =
  | { ok: true; slug: string; wasPublic: boolean }
  | { ok: false; reason: "unknown_season" | "already_held" | "not_held" | "invalid_reason" };

/** Trimmed, length-checked, or null when it will not do. */
export function holdReason(raw: string): string | null {
  const reason = raw.trim().replace(/\s+/g, " ");
  return reason.length >= HOLD_REASON_MIN && reason.length <= HOLD_REASON_MAX ? reason : null;
}

export async function holdSeason(
  db: Db,
  input: { competitionId: string; actorId: string; reason: string },
): Promise<HoldOutcome> {
  const reason = holdReason(input.reason);
  if (reason === null) {
    return { ok: false, reason: "invalid_reason" };
  }
  const [before] = await db
    .select({
      slug: competitions.slug,
      orgId: competitions.orgId,
      visibility: competitions.visibility,
      heldAt: competitions.platformHoldAt,
    })
    .from(competitions)
    .where(eq(competitions.id, input.competitionId))
    .limit(1);
  if (before === undefined) {
    return { ok: false, reason: "unknown_season" };
  }
  if (before.heldAt !== null) {
    return { ok: false, reason: "already_held" };
  }
  // Claimed with `platform_hold_at IS NULL`, so two operators taking the same
  // page down at once produce one hold and one "already held", never two rows
  // of audit for one act.
  const claimed = await db
    .update(competitions)
    .set({
      visibility: "private",
      platformHoldAt: new Date(),
      platformHoldReason: reason,
      platformHoldBy: input.actorId,
    })
    .where(and(eq(competitions.id, input.competitionId), isNull(competitions.platformHoldAt)))
    .returning({ id: competitions.id });
  if (claimed.length === 0) {
    return { ok: false, reason: "already_held" };
  }
  // On the club's own timeline, so its organizers can see what happened and
  // why — the same place every other change to their season is recorded.
  await db.insert(auditLog).values({
    id: newId(),
    actor: input.actorId,
    action: SEASON_HELD_ACTION,
    scopeType: "org",
    scopeId: before.orgId,
    subject: input.competitionId,
    meta: { reason, wasPublic: before.visibility === "public" },
  });
  return { ok: true, slug: before.slug, wasPublic: before.visibility === "public" };
}

/**
 * Lifting the hold hands the decision back to the organizer. It does NOT
 * republish: the season stays private until they choose to publish it again,
 * knowing why it was taken down.
 */
export async function liftSeasonHold(
  db: Db,
  input: { competitionId: string; actorId: string; note: string | null },
): Promise<HoldOutcome> {
  const [before] = await db
    .select({ slug: competitions.slug, orgId: competitions.orgId })
    .from(competitions)
    .where(eq(competitions.id, input.competitionId))
    .limit(1);
  if (before === undefined) {
    return { ok: false, reason: "unknown_season" };
  }
  const lifted = await db
    .update(competitions)
    .set({ platformHoldAt: null, platformHoldReason: null, platformHoldBy: null })
    .where(and(eq(competitions.id, input.competitionId), isNotNull(competitions.platformHoldAt)))
    .returning({ id: competitions.id });
  if (lifted.length === 0) {
    return { ok: false, reason: "not_held" };
  }
  const note = input.note?.trim().slice(0, HOLD_REASON_MAX) ?? "";
  await db.insert(auditLog).values({
    id: newId(),
    actor: input.actorId,
    action: SEASON_HOLD_LIFTED_ACTION,
    scopeType: "org",
    scopeId: before.orgId,
    subject: input.competitionId,
    meta: note === "" ? {} : { note },
  });
  return { ok: true, slug: before.slug, wasPublic: false };
}

/** What the organizer's console needs to know about a hold on their season. */
export interface SeasonHold {
  readonly heldAt: Date;
  readonly reason: string;
}

export async function seasonHoldOf(db: Db, competitionId: string): Promise<SeasonHold | null> {
  const [row] = await db
    .select({ heldAt: competitions.platformHoldAt, reason: competitions.platformHoldReason })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .limit(1);
  if (row === undefined || row.heldAt === null || row.reason === null) {
    return null;
  }
  return { heldAt: row.heldAt, reason: row.reason };
}
