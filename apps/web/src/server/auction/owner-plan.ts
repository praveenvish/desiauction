import {
  fallbackWouldCycle,
  isTargetPriority,
  paise,
  validateTargetMax,
  type LotStatus,
  type Paise,
  type PlanLot,
  type PlanRules,
  type PlanRevisionLike,
  type PlanSaleLike,
  type PlanTarget,
  type TargetPriority,
} from "@desiauction/core";
import {
  auctionEvents,
  auctionTeamTargetRevisions,
  auctionTeamTargets,
  lots,
  newId,
  paddles,
  people,
  registrations,
  writeSurvivingConstraint,
  type Db,
} from "@desiauction/db";
import { and, asc, eq } from "drizzle-orm";

import type { AuctionRules } from "./live-summary";

/**
 * THE OWNER'S PLAN, STORED (WR-1).
 *
 * Storage and validation only — the fold that compares a plan with the auction
 * is pure and lives in core's `team-plan.ts`. Every call here runs inside a
 * `withTenantDb` boundary opened by the action, so the participant-arm policy
 * on the two plan tables is what scopes the rows at the database; this module
 * ALSO filters by `teamId` on every read and write, because the action has
 * already proven that team is one the caller is in the room for. Two layers,
 * both required, neither trusted alone.
 *
 * Nothing here reads the engine, the snapshot or the socket. The pool a plan
 * picks from is the auction's own lots — the same names and numbers every
 * viewer already sees in the queue — so a plan adds no exposure of its own.
 */

// ---------------------------------------------------------------------------
// The pool: every lot of the auction, with the player behind it.

export interface PlanLotRow extends PlanLot {
  lotNumber: string;
  seq: number;
  playerName: string | null;
  /** Null in a sport whose pack declares no playing roles (Phase 2). */
  role: string | null;
  /** The registration number: the identity the player already sees on their public page. */
  number: string;
}

export async function planLots(db: Db, auctionId: string): Promise<PlanLotRow[]> {
  const rows = await db
    .select({
      lotId: lots.id,
      registrationId: lots.registrationId,
      lotNumber: lots.lotNumber,
      seq: lots.seq,
      status: lots.status,
      basePrice: lots.basePrice,
      soldPrice: lots.soldPrice,
      soldToTeamId: paddles.teamId,
      playerName: people.name,
      role: registrations.role,
      number: registrations.registrationNumber,
    })
    .from(lots)
    .innerJoin(registrations, eq(registrations.id, lots.registrationId))
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(paddles, eq(paddles.id, lots.soldToPaddleId))
    .where(eq(lots.auctionId, auctionId))
    .orderBy(asc(lots.seq));
  return rows.map((row) => ({
    ...row,
    status: row.status,
    basePrice: paise(row.basePrice),
    soldPrice: row.soldPrice === null ? null : paise(row.soldPrice),
  }));
}

/**
 * THE PLAN AS THE LIVE ROOM RECEIVES IT (M4). Served BESIDE the snapshot, never
 * in it: the engine hashes its snapshot bytes and halts on a per-viewer
 * difference. Lots carry the registration join and a starting status; the
 * client overlays the live frame (current lot, queue, resolved history) before
 * folding, so the line under the raise button and the paddle agree on the
 * same version. Only the viewer's own teams' targets are ever here.
 */
export interface LivePlanLot {
  lotId: string;
  registrationId: string;
  playerName: string | null;
  basePrice: number;
  status: LotStatus;
  soldToTeamId: string | null;
  soldPrice: number | null;
}

export interface LivePlan {
  lots: LivePlanLot[];
  planRules: PlanRules;
  /** Keyed by team id; every key is a team the viewer is in the room for. */
  targetsByTeam: Record<string, TargetRow[]>;
}

export function toLivePlanLot(row: PlanLotRow): LivePlanLot {
  return {
    lotId: row.lotId,
    registrationId: row.registrationId,
    playerName: row.playerName,
    basePrice: row.basePrice,
    status: row.status,
    soldToTeamId: row.soldToTeamId,
    soldPrice: row.soldPrice,
  };
}

/** The PlanRules slice of the locked config, typed as money. */
export function planRulesOf(rules: AuctionRules): PlanRules {
  return {
    pursePerTeam: paise(rules.pursePerTeam),
    squadMin: rules.squadMin,
    squadMax: rules.squadMax,
    minPossiblePrice: paise(rules.minPossiblePrice),
    slabs: rules.slabs.map((slab) => ({
      upTo: slab.upTo === null ? null : paise(slab.upTo),
      step: paise(slab.step),
    })),
  };
}

export interface TeamStanding {
  purseRemaining: Paise;
  squadSize: number;
}

/**
 * Where a team stands from the rows alone: committed = Σ hammer prices of the
 * lots it won; squad = those plus the pre-signed players it already carries.
 * The same arithmetic the engine's `placeBid` runs in SQL; this is the read
 * model's copy for a page that has no socket.
 */
export function teamStanding(
  lotRows: readonly PlanLotRow[],
  preSignedCount: number,
  teamId: string,
  pursePerTeam: Paise,
): TeamStanding {
  let committed = 0;
  let won = 0;
  for (const row of lotRows) {
    if (row.status === "sold" && row.soldToTeamId === teamId && row.soldPrice !== null) {
      committed += row.soldPrice;
      won += 1;
    }
  }
  return {
    purseRemaining: paise(Math.max(0, pursePerTeam - committed)),
    squadSize: won + preSignedCount,
  };
}

// ---------------------------------------------------------------------------
// The record, for the night's report (Phase 1.5).

/** This team's plan history, oldest first — private, same policy as the targets. */
export async function revisionsOf(
  db: Db,
  auctionId: string,
  teamId: string,
): Promise<PlanRevisionLike[]> {
  const rows = await db
    .select({
      targetId: auctionTeamTargetRevisions.targetId,
      kind: auctionTeamTargetRevisions.kind,
      registrationId: auctionTeamTargetRevisions.registrationId,
      maxBid: auctionTeamTargetRevisions.maxBid,
      priority: auctionTeamTargetRevisions.priority,
      at: auctionTeamTargetRevisions.at,
    })
    .from(auctionTeamTargetRevisions)
    .where(
      and(
        eq(auctionTeamTargetRevisions.auctionId, auctionId),
        eq(auctionTeamTargetRevisions.teamId, teamId),
      ),
    )
    .orderBy(asc(auctionTeamTargetRevisions.at));
  return rows.map((row) => ({
    targetId: row.targetId,
    kind: row.kind,
    registrationId: row.registrationId,
    maxBid: row.maxBid === null ? null : paise(row.maxBid),
    priority: row.priority as TargetPriority,
    atMs: row.at.getTime(),
  }));
}

/**
 * Every `LotSold` in the ledger, with when it fell. Public facts (the hall
 * heard them called); a lot reopened by undo and resold appears twice, and the
 * report keeps the sale that stood.
 */
export async function lotSalesOf(db: Db, auctionId: string): Promise<PlanSaleLike[]> {
  const rows = await db
    .select({ seq: auctionEvents.seq, atMs: auctionEvents.atMs, payload: auctionEvents.payload })
    .from(auctionEvents)
    .where(and(eq(auctionEvents.auctionId, auctionId), eq(auctionEvents.type, "LotSold")))
    .orderBy(asc(auctionEvents.seq));
  return rows.flatMap((row) => {
    const lotId = (row.payload as { lotId?: unknown }).lotId;
    return typeof lotId === "string" ? [{ lotId, atMs: row.atMs, seq: row.seq }] : [];
  });
}

// ---------------------------------------------------------------------------
// Which team a request is about.

/**
 * The team a plan request is for: the one asked for, if the caller is in the
 * room for it; the first they are in the room for, if none was asked; null if
 * they are in the room for none, or asked for one that is not theirs. Null
 * means 404 — the plan page does not admit that a rival team exists.
 */
export function pickPlanTeam(
  myTeamIds: readonly string[],
  requested: string | null,
): string | null {
  if (requested !== null) {
    return myTeamIds.includes(requested) ? requested : null;
  }
  return myTeamIds[0] ?? null;
}

// ---------------------------------------------------------------------------
// Targets.

export interface TargetRow extends PlanTarget {
  id: string;
  updatedAt: Date;
}

export async function targetsOf(db: Db, auctionId: string, teamId: string): Promise<TargetRow[]> {
  const rows = await db
    .select()
    .from(auctionTeamTargets)
    .where(and(eq(auctionTeamTargets.auctionId, auctionId), eq(auctionTeamTargets.teamId, teamId)))
    .orderBy(asc(auctionTeamTargets.priority), asc(auctionTeamTargets.createdAt));
  return rows.map(hydrate);
}

function hydrate(row: typeof auctionTeamTargets.$inferSelect): TargetRow {
  return {
    id: row.id,
    registrationId: row.registrationId,
    maxBid: row.maxBid === null ? null : paise(row.maxBid),
    priority: row.priority as TargetPriority,
    fallbackRegistrationId: row.fallbackRegistrationId,
    updatedAt: row.updatedAt,
  };
}

export interface TargetInput {
  registrationId: string;
  /** Integer paise, or null for no cap. */
  maxBid: number | null;
  priority: number;
  fallbackRegistrationId: string | null;
}

export type TargetRefusal =
  | "not_in_auction"
  | "duplicate"
  | "invalid_max"
  | "below_base"
  | "above_purse"
  | "bad_priority"
  | "bad_fallback"
  | "fallback_cycle"
  | "unknown_target";

export type TargetWriteResult =
  { ok: true; target: TargetRow } | { ok: false; reason: TargetRefusal };

export interface WriteContext {
  orgId: string;
  auctionId: string;
  teamId: string;
  actorId: string;
  /** The snapshot version the owner was looking at, when the client knew it. */
  atSeq: number | null;
  pursePerTeam: Paise;
  lots: readonly PlanLotRow[];
  existing: readonly TargetRow[];
}

/**
 * Everything a write must satisfy, decided before anything is written. The
 * database repeats the cheap parts as constraints (positive max, priority
 * range, no self-fallback, one row per player); this is where the parts that
 * need the auction's context are decided: the player must be a lot of THIS
 * auction, the max must sit between that lot's base and the purse, and a
 * fallback must be a lot too and must not close a loop.
 */
export function validateTarget(
  input: TargetInput,
  context: Pick<WriteContext, "pursePerTeam" | "lots" | "existing">,
): { ok: true; value: PlanTarget } | { ok: false; reason: TargetRefusal } {
  const lot = context.lots.find((row) => row.registrationId === input.registrationId);
  if (lot === undefined) {
    return { ok: false, reason: "not_in_auction" };
  }
  if (!Number.isInteger(input.priority) || !isTargetPriority(input.priority)) {
    return { ok: false, reason: "bad_priority" };
  }
  const max = validateTargetMax(input.maxBid, {
    basePrice: lot.basePrice,
    pursePerTeam: context.pursePerTeam,
  });
  if (!max.ok) {
    return { ok: false, reason: max.reason === "invalid" ? "invalid_max" : max.reason };
  }
  if (input.fallbackRegistrationId !== null) {
    const fallback = context.lots.find(
      (row) => row.registrationId === input.fallbackRegistrationId,
    );
    if (fallback === undefined || input.fallbackRegistrationId === input.registrationId) {
      return { ok: false, reason: "bad_fallback" };
    }
    if (fallbackWouldCycle(context.existing, input.registrationId, input.fallbackRegistrationId)) {
      return { ok: false, reason: "fallback_cycle" };
    }
  }
  return {
    ok: true,
    value: {
      registrationId: input.registrationId,
      maxBid: max.maxBid,
      priority: input.priority,
      fallbackRegistrationId: input.fallbackRegistrationId,
    },
  };
}

async function recordRevision(
  db: Db,
  context: WriteContext,
  targetId: string,
  kind: "added" | "updated" | "removed",
  value: PlanTarget,
): Promise<void> {
  await db.insert(auctionTeamTargetRevisions).values({
    id: newId(),
    orgId: context.orgId,
    auctionId: context.auctionId,
    teamId: context.teamId,
    targetId,
    kind,
    registrationId: value.registrationId,
    maxBid: value.maxBid,
    priority: value.priority,
    fallbackRegistrationId: value.fallbackRegistrationId,
    atSeq: context.atSeq,
    by: context.actorId,
  });
}

export async function addTarget(
  db: Db,
  context: WriteContext,
  input: TargetInput,
): Promise<TargetWriteResult> {
  if (context.existing.some((row) => row.registrationId === input.registrationId)) {
    return { ok: false, reason: "duplicate" };
  }
  const checked = validateTarget(input, context);
  if (!checked.ok) {
    return checked;
  }
  const id = newId();
  // The unique index is the last word on "one row per player": two tabs adding
  // the same target at once race here, and the loser must not poison the
  // caller's transaction (the DA-03 savepoint rule).
  const landed = await writeSurvivingConstraint(db, async (tx) => {
    await tx.insert(auctionTeamTargets).values({
      id,
      orgId: context.orgId,
      auctionId: context.auctionId,
      teamId: context.teamId,
      registrationId: checked.value.registrationId,
      maxBid: checked.value.maxBid,
      priority: checked.value.priority,
      fallbackRegistrationId: checked.value.fallbackRegistrationId,
      createdBy: context.actorId,
    });
  });
  if (!landed) {
    return { ok: false, reason: "duplicate" };
  }
  await recordRevision(db, context, id, "added", checked.value);
  const [row] = await db.select().from(auctionTeamTargets).where(eq(auctionTeamTargets.id, id));
  if (row === undefined) {
    return { ok: false, reason: "unknown_target" };
  }
  return { ok: true, target: hydrate(row) };
}

export async function updateTarget(
  db: Db,
  context: WriteContext,
  targetId: string,
  patch: Omit<TargetInput, "registrationId">,
): Promise<TargetWriteResult> {
  const current = context.existing.find((row) => row.id === targetId);
  if (current === undefined) {
    return { ok: false, reason: "unknown_target" };
  }
  const checked = validateTarget({ ...patch, registrationId: current.registrationId }, context);
  if (!checked.ok) {
    return checked;
  }
  const [row] = await db
    .update(auctionTeamTargets)
    .set({
      maxBid: checked.value.maxBid,
      priority: checked.value.priority,
      fallbackRegistrationId: checked.value.fallbackRegistrationId,
      updatedBy: context.actorId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(auctionTeamTargets.id, targetId),
        eq(auctionTeamTargets.auctionId, context.auctionId),
        eq(auctionTeamTargets.teamId, context.teamId),
      ),
    )
    .returning();
  if (row === undefined) {
    return { ok: false, reason: "unknown_target" };
  }
  await recordRevision(db, context, targetId, "updated", checked.value);
  return { ok: true, target: hydrate(row) };
}

export async function removeTarget(
  db: Db,
  context: WriteContext,
  targetId: string,
): Promise<TargetWriteResult> {
  const current = context.existing.find((row) => row.id === targetId);
  if (current === undefined) {
    return { ok: false, reason: "unknown_target" };
  }
  const deleted = await db
    .delete(auctionTeamTargets)
    .where(
      and(
        eq(auctionTeamTargets.id, targetId),
        eq(auctionTeamTargets.auctionId, context.auctionId),
        eq(auctionTeamTargets.teamId, context.teamId),
      ),
    )
    .returning({ id: auctionTeamTargets.id });
  if (deleted.length === 0) {
    return { ok: false, reason: "unknown_target" };
  }
  // A row that points at the removed player as its fallback keeps pointing at
  // a registration that still exists; the fold simply finds it is not a target
  // any more and follows it as a plain player. Nothing to rewrite.
  await recordRevision(db, context, targetId, "removed", current);
  return { ok: true, target: current };
}
