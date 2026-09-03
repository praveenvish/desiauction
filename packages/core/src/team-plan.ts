/**
 * MY PLAN — the owner's private plan, compared against engine truth (WR-1).
 *
 * A team owner writes down the players they mean to bid for, the most they
 * mean to pay, a priority, and who they fall back to. During the auction this
 * module folds that plan against what the engine has already decided (the
 * snapshot: purse remaining, squad size, the lot on the block, its next legal
 * bid) and says, in numbers the owner can check by hand, where the plan stands.
 *
 * PURE, DETERMINISTIC, EXPLAINABLE. No IO, no clock, no randomness, no model.
 * Every state below is one inequality over inputs the owner can already see,
 * and the same function runs on the server for the plan page and on the client
 * for every snapshot frame, so the two never disagree.
 *
 * WHAT IT NEVER DOES. It never edits the owner's max, never proposes a price
 * for a named player, and never places or refuses a bid: the engine's gauntlet
 * (`decideBid`) is the only authority on that. Where the engine's own ceiling
 * (`maxAffordableBid`, the reserve rule) is lower than the plan, the engine's
 * verdict wins here too, so this surface can never encourage a bid the engine
 * would refuse.
 *
 * Money is integer paise throughout. "Headroom" can be negative and is a plain
 * number for that reason; every amount that is a real price is `Paise`.
 */

import { ladderContains, maxAffordableBid } from "./auction";
import type { IncrementSlab, LotStatus } from "./auction";
import { paise } from "./money";
import type { Paise } from "./money";

// ---------------------------------------------------------------------------
// Vocabulary

export const TARGET_PRIORITIES = [1, 2, 3] as const;
/** 1 must have · 2 high · 3 target (the default, and the one most rows keep). */
export type TargetPriority = (typeof TARGET_PRIORITIES)[number];

export const TARGET_PRIORITY_LABELS: Readonly<Record<TargetPriority, string>> = {
  1: "Must have",
  2: "High",
  3: "Target",
};

export function isTargetPriority(value: number): value is TargetPriority {
  return (TARGET_PRIORITIES as readonly number[]).includes(value);
}

/** One row of the owner's plan, exactly as stored. */
export interface PlanTarget {
  readonly registrationId: string;
  /** NULL = no cap; the target is counted at the lot's base price. */
  readonly maxBid: Paise | null;
  readonly priority: TargetPriority;
  readonly fallbackRegistrationId: string | null;
}

/** What the auction knows about one lot — the join key is the registration. */
export interface PlanLot {
  readonly lotId: string;
  readonly registrationId: string;
  readonly status: LotStatus;
  readonly basePrice: Paise;
  readonly soldToTeamId: string | null;
  readonly soldPrice: Paise | null;
}

/** The subset of the auction's rules the plan needs (all locked at creation). */
export interface PlanRules {
  readonly pursePerTeam: Paise;
  readonly squadMin: number;
  readonly squadMax: number;
  /** The reserve-rule floor: the cheapest any remaining lot can open at. */
  readonly minPossiblePrice: Paise;
  readonly slabs: readonly IncrementSlab[];
}

/** The lot on the block, as the snapshot describes it to this owner. */
export interface PlanCurrentLot {
  readonly lotId: string;
  readonly nextMinimumBid: Paise;
  readonly leadingAmount: Paise | null;
  /** True when this team's paddle holds the leading bid. */
  readonly leadingIsMine: boolean;
}

export interface PlanInput {
  readonly targets: readonly PlanTarget[];
  readonly lots: readonly PlanLot[];
  readonly myTeamId: string;
  /** From the snapshot's own paddle row — never redacted for the owner's scope. */
  readonly purseRemaining: Paise;
  /** Sold to this team so far plus pre-signed players (icons, retained). */
  readonly squadSize: number;
  readonly rules: PlanRules;
  readonly currentLot: PlanCurrentLot | null;
}

// ---------------------------------------------------------------------------
// Output

export type TargetOutcome = "open" | "won" | "lost" | "unavailable";

export interface TargetState extends PlanTarget {
  readonly outcome: TargetOutcome;
  readonly lotId: string | null;
  readonly lotStatus: LotStatus | null;
  readonly basePrice: Paise | null;
  /** What this row contributes to exposure: the max, or the base when no max. */
  readonly plannedAmount: Paise;
  readonly countedAtBase: boolean;
  /** The hammer price when won or lost; null otherwise. */
  readonly paidAmount: Paise | null;
  /** When the max is not a rung of the ladder: the last legal bid under it. */
  readonly ladderFloor: Paise | null;
  /** For a lost or unavailable target: the first open player down its fallback chain. */
  readonly effectiveBackup: string | null;
}

export type PlanFit = "fits" | "at_risk" | "does_not_fit";

export interface PlanBudget {
  readonly purseRemaining: Paise;
  /** Σ plannedAmount over open targets. */
  readonly plannedExposure: Paise;
  /** purseRemaining − plannedExposure. Negative means the plan does not fit. */
  readonly headroom: number;
  readonly openTargets: number;
  /** Squad slots still needed for squadMin after every open target is won. */
  readonly slotsAfterPlan: number;
  /** The engine's reserve rule applied to the plan: slotsAfterPlan × minPossiblePrice. */
  readonly reserveAfterPlan: Paise;
  readonly fit: PlanFit;
  /** Amount the plan must shed to become `fits`; 0 when it already does. */
  readonly shortfall: Paise;
  /** Open targets beyond the squad maximum, if the owner planned more than fit. */
  readonly excessTargets: number;
}

export interface Consequence {
  readonly amount: Paise;
  readonly purseAfter: Paise;
  readonly plannedExposureAfter: Paise;
  readonly headroomAfter: number;
  readonly fitAfter: PlanFit;
}

export type LotVerdict =
  /** Not my target: nothing to say (the line stays absent). */
  | "not_a_target"
  /** My paddle leads. `leadingOverBy` says whether my own bid passed my max. */
  | "leading"
  /** The engine would refuse the next bid regardless of the plan. */
  | "engine_ceiling"
  /** My target, no max set. */
  | "target_no_max"
  /** nextMinimumBid ≤ max. */
  | "within_plan"
  /** nextMinimumBid > max; `overBy` is the difference. */
  | "over_max";

export interface LotAdvice {
  readonly lotId: string;
  readonly registrationId: string | null;
  readonly target: TargetState | null;
  readonly verdict: LotVerdict;
  readonly nextBid: Paise;
  readonly maxAffordable: Paise;
  readonly ceilingReason: "purse" | "squad_full" | null;
  readonly overBy: Paise | null;
  readonly leadingOverBy: Paise | null;
  /** Winning this lot at `nextBid` (or at my leading bid when I lead). */
  readonly ifWon: Consequence;
}

export type PlanSuggestion =
  | {
      readonly kind: "recover";
      readonly amount: Paise;
      /** Lowest priority first, dearest first within a priority, until `amount` is covered. */
      readonly candidates: readonly {
        readonly registrationId: string;
        readonly plannedAmount: Paise;
        readonly priority: TargetPriority;
      }[];
    }
  | {
      readonly kind: "unaffordable";
      readonly registrationId: string;
      readonly plannedAmount: Paise;
      readonly maxAffordable: Paise;
    }
  | { readonly kind: "over_slots"; readonly excess: number }
  | {
      readonly kind: "backup";
      readonly lostRegistrationId: string;
      readonly nextRegistrationId: string;
    };

export interface PlanState {
  readonly budget: PlanBudget;
  readonly targets: readonly TargetState[];
  readonly currentLot: LotAdvice | null;
  readonly suggestions: readonly PlanSuggestion[];
}

// ---------------------------------------------------------------------------
// Ladder helper

/**
 * The last legal bid at or under `amount`: the largest rung of the increment
 * ladder that is ≤ amount, or null when amount is below base. Mirrors
 * `ladderContains` slab by slab so the two can never disagree about a rung.
 */
export function ladderFloor(
  base: Paise,
  slabs: readonly IncrementSlab[],
  amount: Paise,
): Paise | null {
  if (amount < base) {
    return null;
  }
  let rung: number = base;
  let lastInside: number = base;
  for (const slab of slabs) {
    if (rung >= amount) {
      break;
    }
    if (slab.upTo !== null && rung >= slab.upTo) {
      continue;
    }
    if (slab.upTo === null || amount < slab.upTo) {
      return paise(rung + Math.floor((amount - rung) / slab.step) * slab.step);
    }
    // The last rung strictly inside this slab, then the boundary rung the next
    // slab steps from (the same arithmetic as ladderContains).
    const steps = Math.ceil((slab.upTo - rung) / slab.step);
    lastInside = rung + (steps - 1) * slab.step;
    rung += steps * slab.step;
  }
  return paise(rung <= amount ? rung : lastInside);
}

// ---------------------------------------------------------------------------
// Validation (shared by the server action and the form)

export type TargetMaxValidation =
  | { readonly ok: true; readonly maxBid: Paise | null }
  | { readonly ok: false; readonly reason: "invalid" | "below_base" | "above_purse" };

/**
 * A max is optional; when given it must be a positive whole number of paise no
 * lower than the lot's base (a lower cap can never be bid) and no higher than
 * the purse (a higher cap can never be paid).
 */
export function validateTargetMax(
  raw: number | null,
  context: { readonly basePrice: Paise; readonly pursePerTeam: Paise },
): TargetMaxValidation {
  if (raw === null) {
    return { ok: true, maxBid: null };
  }
  if (!Number.isSafeInteger(raw) || raw <= 0) {
    return { ok: false, reason: "invalid" };
  }
  if (raw < context.basePrice) {
    return { ok: false, reason: "below_base" };
  }
  if (raw > context.pursePerTeam) {
    return { ok: false, reason: "above_purse" };
  }
  return { ok: true, maxBid: paise(raw) };
}

/**
 * Would pointing `registrationId` at `fallbackRegistrationId` close a loop?
 * Follows existing fallback pointers from the proposed backup; a chain that
 * returns to the row being edited is refused before it is written.
 */
export function fallbackWouldCycle(
  targets: readonly PlanTarget[],
  registrationId: string,
  fallbackRegistrationId: string | null,
): boolean {
  if (fallbackRegistrationId === null) {
    return false;
  }
  if (fallbackRegistrationId === registrationId) {
    return true;
  }
  const byId = new Map(targets.map((target) => [target.registrationId, target]));
  const seen = new Set<string>([registrationId]);
  let cursor: string | null = fallbackRegistrationId;
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    cursor = byId.get(cursor)?.fallbackRegistrationId ?? null;
  }
  return cursor === registrationId;
}

// ---------------------------------------------------------------------------
// The fold

function outcomeOf(lot: PlanLot | undefined, myTeamId: string): TargetOutcome {
  if (lot === undefined || lot.status === "withdrawn") {
    return "unavailable";
  }
  if (lot.status === "sold") {
    return lot.soldToTeamId === myTeamId ? "won" : "lost";
  }
  return "open";
}

/** A non-target backup is "open" while its lot is still to be decided. */
function registrationIsOpen(
  registrationId: string,
  states: ReadonlyMap<string, TargetState>,
  lots: ReadonlyMap<string, PlanLot>,
  myTeamId: string,
): boolean {
  const asTarget = states.get(registrationId);
  if (asTarget !== undefined) {
    return asTarget.outcome === "open";
  }
  return outcomeOf(lots.get(registrationId), myTeamId) === "open";
}

function fitOf(headroom: number, reserve: number): PlanFit {
  if (headroom < 0) {
    return "does_not_fit";
  }
  return headroom < reserve ? "at_risk" : "fits";
}

function priorityRank(priority: TargetPriority): number {
  // Lowest priority sheds first: 3 (target) → 2 (high) → 1 (must have).
  return 4 - priority;
}

export function evaluatePlan(input: PlanInput): PlanState {
  const { rules, myTeamId } = input;
  const lots = new Map(input.lots.map((lot) => [lot.registrationId, lot]));

  // Pass 1: every target's outcome and contribution.
  const partial = new Map<string, TargetState>();
  for (const target of input.targets) {
    const lot = lots.get(target.registrationId);
    const outcome = outcomeOf(lot, myTeamId);
    const basePrice = lot?.basePrice ?? null;
    const countedAtBase = target.maxBid === null;
    const plannedAmount = target.maxBid ?? basePrice ?? paise(0);
    const ladder =
      target.maxBid !== null &&
      basePrice !== null &&
      !ladderContains(basePrice, rules.slabs, target.maxBid)
        ? ladderFloor(basePrice, rules.slabs, target.maxBid)
        : null;
    partial.set(target.registrationId, {
      ...target,
      outcome,
      lotId: lot?.lotId ?? null,
      lotStatus: lot?.status ?? null,
      basePrice,
      plannedAmount,
      countedAtBase,
      paidAmount: outcome === "won" || outcome === "lost" ? (lot?.soldPrice ?? null) : null,
      ladderFloor: ladder,
      effectiveBackup: null,
    });
  }

  // Pass 2: fallback chains need every outcome first.
  const states: TargetState[] = [];
  for (const target of input.targets) {
    const state = partial.get(target.registrationId);
    if (state === undefined) {
      continue;
    }
    let effectiveBackup: string | null = null;
    if (state.outcome === "lost" || state.outcome === "unavailable") {
      const seen = new Set<string>([state.registrationId]);
      let cursor = state.fallbackRegistrationId;
      while (cursor !== null && !seen.has(cursor)) {
        seen.add(cursor);
        if (registrationIsOpen(cursor, partial, lots, myTeamId)) {
          effectiveBackup = cursor;
          break;
        }
        cursor = partial.get(cursor)?.fallbackRegistrationId ?? null;
      }
    }
    states.push({ ...state, effectiveBackup });
  }

  // Budget.
  const open = states.filter((state) => state.outcome === "open");
  const plannedExposure = paise(open.reduce((sum, state) => sum + state.plannedAmount, 0));
  const headroom = input.purseRemaining - plannedExposure;
  const slotsAfterPlan = Math.max(0, rules.squadMin - input.squadSize - open.length);
  const reserveAfterPlan = paise(slotsAfterPlan * rules.minPossiblePrice);
  const fit = fitOf(headroom, reserveAfterPlan);
  const shortfall = paise(
    fit === "does_not_fit" ? -headroom : fit === "at_risk" ? reserveAfterPlan - headroom : 0,
  );
  const budget: PlanBudget = {
    purseRemaining: input.purseRemaining,
    plannedExposure,
    headroom,
    openTargets: open.length,
    slotsAfterPlan,
    reserveAfterPlan,
    fit,
    shortfall,
    excessTargets: Math.max(0, input.squadSize + open.length - rules.squadMax),
  };

  const maxAffordable = maxAffordableBid({
    purseRemaining: input.purseRemaining,
    squadSize: input.squadSize,
    squadMin: rules.squadMin,
    minPossiblePrice: rules.minPossiblePrice,
  });

  // The lot on the block.
  let currentLot: LotAdvice | null = null;
  if (input.currentLot !== null) {
    const lotRow = input.lots.find((lot) => lot.lotId === input.currentLot?.lotId);
    const registrationId = lotRow?.registrationId ?? null;
    const target =
      registrationId === null
        ? null
        : (states.find((state) => state.registrationId === registrationId) ?? null);
    const isOpenTarget = target !== null && target.outcome === "open";
    const { nextMinimumBid, leadingAmount, leadingIsMine } = input.currentLot;
    const squadFull = input.squadSize >= rules.squadMax;

    let verdict: LotVerdict = "not_a_target";
    let ceilingReason: LotAdvice["ceilingReason"] = null;
    let overBy: Paise | null = null;
    let leadingOverBy: Paise | null = null;

    if (isOpenTarget) {
      const max = target.maxBid;
      if (leadingIsMine) {
        verdict = "leading";
        leadingOverBy =
          max !== null && leadingAmount !== null && leadingAmount > max
            ? paise(leadingAmount - max)
            : null;
      } else if (squadFull) {
        verdict = "engine_ceiling";
        ceilingReason = "squad_full";
      } else if (nextMinimumBid > maxAffordable) {
        verdict = "engine_ceiling";
        ceilingReason = "purse";
      } else if (max === null) {
        verdict = "target_no_max";
      } else if (nextMinimumBid <= max) {
        verdict = "within_plan";
      } else {
        verdict = "over_max";
        overBy = paise(nextMinimumBid - max);
      }
    }

    const amount = leadingIsMine && leadingAmount !== null ? leadingAmount : nextMinimumBid;
    currentLot = {
      lotId: input.currentLot.lotId,
      registrationId,
      target,
      verdict,
      nextBid: nextMinimumBid,
      maxAffordable,
      ceilingReason,
      overBy,
      leadingOverBy,
      ifWon: consequence(input, budget, isOpenTarget ? target : null, amount),
    };
  }

  // Suggestions: lists and facts, never prices the owner did not write.
  const suggestions: PlanSuggestion[] = [];
  if (budget.excessTargets > 0) {
    suggestions.push({ kind: "over_slots", excess: budget.excessTargets });
  }
  if (fit !== "fits") {
    const ordered = [...open].sort(
      (a, b) =>
        priorityRank(a.priority) - priorityRank(b.priority) ||
        b.plannedAmount - a.plannedAmount ||
        a.registrationId.localeCompare(b.registrationId),
    );
    const candidates: { registrationId: string; plannedAmount: Paise; priority: TargetPriority }[] =
      [];
    let freed = 0;
    for (const state of ordered) {
      if (freed >= shortfall) {
        break;
      }
      candidates.push({
        registrationId: state.registrationId,
        plannedAmount: state.plannedAmount,
        priority: state.priority,
      });
      freed += state.plannedAmount;
    }
    suggestions.push({ kind: "recover", amount: shortfall, candidates });
  }
  for (const state of [...open].sort((a, b) => a.registrationId.localeCompare(b.registrationId))) {
    if (state.plannedAmount > maxAffordable) {
      suggestions.push({
        kind: "unaffordable",
        registrationId: state.registrationId,
        plannedAmount: state.plannedAmount,
        maxAffordable,
      });
    }
  }
  for (const state of states) {
    if (state.effectiveBackup !== null) {
      suggestions.push({
        kind: "backup",
        lostRegistrationId: state.registrationId,
        nextRegistrationId: state.effectiveBackup,
      });
    }
  }

  return { budget, targets: states, currentLot, suggestions };
}

function consequence(
  input: PlanInput,
  budget: PlanBudget,
  target: TargetState | null,
  amount: Paise,
): Consequence {
  const purseAfter = paise(Math.max(0, input.purseRemaining - amount));
  const removes = target !== null && target.outcome === "open";
  const plannedExposureAfter = paise(budget.plannedExposure - (removes ? target.plannedAmount : 0));
  const openAfter = budget.openTargets - (removes ? 1 : 0);
  const slots = Math.max(0, input.rules.squadMin - (input.squadSize + 1) - openAfter);
  const headroomAfter = purseAfter - plannedExposureAfter;
  return {
    amount,
    purseAfter,
    plannedExposureAfter,
    headroomAfter,
    fitAfter: fitOf(headroomAfter, slots * input.rules.minPossiblePrice),
  };
}

/**
 * "What if I win this player for X?" — the same arithmetic as the live line,
 * for any registration in the auction (a target or not) and any amount.
 */
export function whatIf(
  input: PlanInput,
  registrationId: string | null,
  amount: Paise,
): Consequence {
  const state = evaluatePlan({ ...input, currentLot: null });
  const target =
    registrationId === null
      ? null
      : (state.targets.find((row) => row.registrationId === registrationId) ?? null);
  return consequence(input, state.budget, target, amount);
}
