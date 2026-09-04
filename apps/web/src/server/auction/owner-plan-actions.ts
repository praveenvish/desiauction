"use server";

import {
  evaluatePlan,
  parseRupeesToPaise,
  type AuctionStatus,
  type PlanRules,
  type PlanState,
} from "@desiauction/core";
import { teams, withTenantDb } from "@desiauction/db";
import { inArray } from "drizzle-orm";

import { dbHandle } from "../db";
import { featureEnabled } from "../feature-settings";
import { storage } from "../media";
import { liveGate } from "./live-actions";
import { lotMediaOf, preSignedPlayers, rulesOf, type AuctionRules } from "./live-summary";
import {
  addTarget,
  pickPlanTeam,
  planLots,
  planRulesOf,
  removeTarget,
  targetsOf,
  teamStanding,
  updateTarget,
  type PlanLotRow,
  type TargetRefusal,
  type TargetRow,
  type WriteContext,
} from "./owner-plan";

/**
 * MY PLAN — the actions (WR-1).
 *
 * THE GATE IS THE ROOM'S GATE. `liveGate` already decides who is in this
 * auction and for which teams (`myTeamIds`: accepted owner invite ∪ live
 * paddle grant ∪ held paddle). A plan request names a team; it is honoured
 * only when that team is one of the caller's, and a conductor who owns no team
 * gets the same `null` as a stranger. There is no second notion of ownership
 * here, and the team id in the request is never trusted on its own.
 *
 * Nothing in this file touches the engine. Plan writes never travel the
 * command gateway, never spend a bidder's rate budget, and never appear in the
 * snapshot: the plan is served BESIDE the auction (the `lotMedia` pattern),
 * and the client folds the two together on its own screen.
 *
 * NULL MEANS 404. Feature off, not in the room, team not yours — all of them
 * are the same absence, because a distinguishable refusal would confirm that
 * the thing being asked about exists.
 */

const TERMINAL: ReadonlySet<AuctionStatus> = new Set(["completed", "reconciled", "abandoned"]);

type Gate = NonNullable<Awaited<ReturnType<typeof liveGate>>>;

async function planGate(
  slug: string,
  requestedTeamId: string | null,
): Promise<{ gate: Gate; teamId: string } | null> {
  const gate = await liveGate(slug);
  if (gate === null) {
    return null;
  }
  const teamId = pickPlanTeam(gate.myTeamIds, requestedTeamId);
  return teamId === null ? null : { gate, teamId };
}

export interface PlanView {
  competition: { name: string; slug: string };
  auctionId: string;
  auctionStatus: AuctionStatus;
  /** True once the auction is over: the plan stays readable, never editable. */
  readOnly: boolean;
  team: { id: string; name: string };
  /** Every team this person could plan for (usually one). */
  teams: { id: string; name: string }[];
  rules: AuctionRules;
  /** The same rules typed as money, for the client-side fold. */
  planRules: PlanRules;
  /** The pool: every lot of the auction, as the queue already shows it. */
  lots: PlanLotRow[];
  /** Consent-gated photo and registration number per lot (the live room's `lotMedia`). */
  lotMedia: Record<string, { photoUrl: string | null; number: string | null }>;
  targets: TargetRow[];
  standing: { purseRemaining: number; squadSize: number };
  /** The fold, from rows alone (no lot on the block — the live room adds that). */
  state: PlanState;
}

export async function planView(
  slug: string,
  teamId: string | null = null,
): Promise<PlanView | null> {
  const gated = await planGate(slug, teamId);
  if (gated === null) {
    return null;
  }
  const { gate } = gated;
  return withTenantDb(
    dbHandle,
    { personId: gate.personId, orgId: gate.competition.orgId },
    async (db) => {
      const feature = await featureEnabled(db, "my_plan", {
        orgId: gate.competition.orgId,
        auctionId: gate.auction.id,
      });
      if (!feature.enabled) {
        return null;
      }
      const [teamRows, lotRows, targets, preSigned, lotMedia] = await Promise.all([
        db
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(inArray(teams.id, gate.myTeamIds)),
        planLots(db, gate.auction.id),
        targetsOf(db, gate.auction.id, gated.teamId),
        preSignedPlayers(db, gate.competition.id),
        lotMediaOf(db, gate.auction.id, (key) => storage.readUrl(key)),
      ]);
      const team = teamRows.find((row) => row.id === gated.teamId);
      if (team === undefined) {
        return null;
      }
      const rules = rulesOf(gate.auction.config);
      const planRules = planRulesOf(rules);
      const standing = teamStanding(
        lotRows,
        preSigned.filter((player) => player.teamId === gated.teamId).length,
        gated.teamId,
        planRules.pursePerTeam,
      );
      const state = evaluatePlan({
        targets,
        lots: lotRows,
        myTeamId: gated.teamId,
        purseRemaining: standing.purseRemaining,
        squadSize: standing.squadSize,
        rules: planRules,
        currentLot: null,
      });
      return {
        competition: { name: gate.competition.name, slug: gate.competition.slug },
        auctionId: gate.auction.id,
        auctionStatus: gate.auction.status,
        readOnly: TERMINAL.has(gate.auction.status),
        team,
        teams: teamRows,
        rules,
        planRules,
        lots: lotRows,
        lotMedia,
        targets,
        standing,
        state,
      };
    },
  );
}

export interface TargetActionInput {
  registrationId: string;
  /** Rupees as typed ("15,00,000", "₹15 L" is not accepted — plain rupees), or empty for no cap. */
  maxRupees: string;
  priority: number;
  fallbackRegistrationId: string | null;
  /** The snapshot version on screen when the owner acted, if the client had one. */
  atSeq: number | null;
}

export type PlanMutationResult =
  | { ok: true; targets: TargetRow[] }
  | { ok: false; reason: TargetRefusal | "not_in_room" | "feature_off" | "auction_over" };

function maxFromRupees(raw: string): { ok: true; maxBid: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: true, maxBid: null };
  }
  const parsed = parseRupeesToPaise(trimmed);
  return parsed.ok ? { ok: true, maxBid: parsed.value } : { ok: false };
}

type Mutation = (
  db: Parameters<typeof addTarget>[0],
  context: WriteContext,
) => ReturnType<typeof addTarget>;

async function mutate(
  slug: string,
  teamId: string,
  atSeq: number | null,
  run: Mutation,
): Promise<PlanMutationResult> {
  const gated = await planGate(slug, teamId);
  if (gated === null) {
    return { ok: false, reason: "not_in_room" };
  }
  const { gate } = gated;
  if (TERMINAL.has(gate.auction.status)) {
    return { ok: false, reason: "auction_over" };
  }
  return withTenantDb(
    dbHandle,
    { personId: gate.personId, orgId: gate.competition.orgId },
    async (db) => {
      const feature = await featureEnabled(db, "my_plan", {
        orgId: gate.competition.orgId,
        auctionId: gate.auction.id,
      });
      if (!feature.enabled) {
        return { ok: false, reason: "feature_off" } as const;
      }
      const [lotRows, existing] = await Promise.all([
        planLots(db, gate.auction.id),
        targetsOf(db, gate.auction.id, gated.teamId),
      ]);
      const context: WriteContext = {
        orgId: gate.competition.orgId,
        auctionId: gate.auction.id,
        teamId: gated.teamId,
        actorId: gate.personId,
        atSeq: Number.isInteger(atSeq) ? atSeq : null,
        pursePerTeam: planRulesOf(rulesOf(gate.auction.config)).pursePerTeam,
        lots: lotRows,
        existing,
      };
      const result = await run(db, context);
      if (!result.ok) {
        return result;
      }
      return { ok: true, targets: await targetsOf(db, gate.auction.id, gated.teamId) } as const;
    },
  );
}

export async function addTargetAction(
  slug: string,
  teamId: string,
  input: TargetActionInput,
): Promise<PlanMutationResult> {
  const max = maxFromRupees(input.maxRupees);
  if (!max.ok) {
    return { ok: false, reason: "invalid_max" };
  }
  return mutate(slug, teamId, input.atSeq, (db, context) =>
    addTarget(db, context, {
      registrationId: input.registrationId,
      maxBid: max.maxBid,
      priority: input.priority,
      fallbackRegistrationId: input.fallbackRegistrationId,
    }),
  );
}

export async function updateTargetAction(
  slug: string,
  teamId: string,
  targetId: string,
  input: Omit<TargetActionInput, "registrationId">,
): Promise<PlanMutationResult> {
  const max = maxFromRupees(input.maxRupees);
  if (!max.ok) {
    return { ok: false, reason: "invalid_max" };
  }
  return mutate(slug, teamId, input.atSeq, (db, context) =>
    updateTarget(db, context, targetId, {
      maxBid: max.maxBid,
      priority: input.priority,
      fallbackRegistrationId: input.fallbackRegistrationId,
    }),
  );
}

export async function removeTargetAction(
  slug: string,
  teamId: string,
  targetId: string,
  atSeq: number | null = null,
): Promise<PlanMutationResult> {
  return mutate(slug, teamId, atSeq, (db, context) => removeTarget(db, context, targetId));
}
