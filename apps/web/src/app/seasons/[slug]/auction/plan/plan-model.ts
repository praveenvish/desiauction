import {
  TARGET_PRIORITIES,
  TARGET_PRIORITY_LABELS,
  roleLabel,
  type PlanFit,
  type TargetOutcome,
  type TargetPriority,
  type TargetState,
} from "@desiauction/core";
import type { BadgeTone } from "@desiauction/ui";

import type { PlanLotRow } from "../../../../../server/auction/owner-plan";
import type { PlanMutationResult } from "../../../../../server/auction/owner-plan-actions";

/**
 * The plan page's pure helpers (WR-1). No React, no server imports beyond
 * types, so the panel stays a thin skin and these stay unit-testable.
 */

/** Integer paise → the rupees an owner types back: "1500000", never grouped. */
export function rupeesFromPaise(value: number | null): string {
  if (value === null) {
    return "";
  }
  if (value % 100 === 0) {
    return String(value / 100);
  }
  return (value / 100).toFixed(2);
}

export interface PriorityGroup {
  priority: TargetPriority;
  label: string;
  items: TargetState[];
}

/** Targets in priority order, empty groups dropped: the page has no headings for nothing. */
export function groupByPriority(targets: readonly TargetState[]): PriorityGroup[] {
  return TARGET_PRIORITIES.flatMap((priority) => {
    const items = targets.filter((target) => target.priority === priority);
    return items.length === 0 ? [] : [{ priority, label: TARGET_PRIORITY_LABELS[priority], items }];
  });
}

/**
 * The pool filtered by what the owner typed. Every token must match somewhere
 * in the name, the registration number or the role. Left out: players already
 * on the plan, and lots already decided (sold to anyone, or withdrawn) — a plan
 * is for players still to come. An empty query shows nothing, because the pool
 * is not what the owner asked to see. Order is the queue's own.
 */
export function searchPool(
  lots: readonly PlanLotRow[],
  targeted: ReadonlySet<string>,
  query: string,
  limit = 8,
): PlanLotRow[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token !== "");
  if (tokens.length === 0) {
    return [];
  }
  const out: PlanLotRow[] = [];
  for (const lot of lots) {
    if (targeted.has(lot.registrationId) || lot.status === "sold" || lot.status === "withdrawn") {
      continue;
    }
    const haystack = `${lot.playerName ?? ""} ${lot.number} ${roleLabel(lot.role)}`.toLowerCase();
    if (tokens.every((token) => haystack.includes(token))) {
      out.push(lot);
      if (out.length >= limit) {
        break;
      }
    }
  }
  return out;
}

export function outcomeBadge(outcome: TargetOutcome): { tone: BadgeTone; label: string } | null {
  switch (outcome) {
    case "open":
      return null;
    case "won":
      return { tone: "success", label: "Signed" };
    case "lost":
      // A person, not an error: neutral ink (dignity grammar).
      return { tone: "neutral", label: "Went elsewhere" };
    case "unavailable":
      return { tone: "neutral", label: "Not in this auction" };
  }
}

export function fitBadge(fit: PlanFit): { tone: BadgeTone; label: string } {
  switch (fit) {
    case "fits":
      return { tone: "success", label: "Plan fits your purse" };
    case "at_risk":
      return { tone: "warning", label: "Plan leaves too little for the rest of the squad" };
    case "does_not_fit":
      return { tone: "danger", label: "Plan exceeds your purse" };
  }
}

type Refusal = Extract<PlanMutationResult, { ok: false }>["reason"];

/** What went wrong, in the owner's words. Never the rule's name. */
export function refusalMessage(
  reason: Refusal,
  context: { basePrice?: string; purse?: string },
): string {
  switch (reason) {
    case "invalid_max":
      return "Enter a whole rupee amount, or leave it empty for no cap.";
    case "below_base":
      return `The max can't be below this player's base price${
        context.basePrice === undefined ? "" : ` (${context.basePrice})`
      }.`;
    case "above_purse":
      return `The max can't be above the purse${
        context.purse === undefined ? "" : ` (${context.purse})`
      }.`;
    case "duplicate":
      return "This player is already on your plan.";
    case "not_in_auction":
      return "This player is not in the auction.";
    case "bad_priority":
      return "Pick a priority from the list.";
    case "bad_fallback":
      return "Pick a backup from the auction's players.";
    case "fallback_cycle":
      return "That backup leads back to this player.";
    case "unknown_target":
      return "That player is no longer on your plan. Refresh to see the latest.";
    case "auction_over":
      return "The auction is over. The plan can be read but not changed.";
    case "feature_off":
      return "Planning is switched off for this auction.";
    case "not_in_room":
      return "You're not in this auction for that team.";
  }
}

export interface RoleCount {
  role: string;
  count: number;
}

export interface RoleFacts {
  /** This team's squad by role: lots won plus pre-signed players. */
  squad: RoleCount[];
  /** Lots still to be decided, by role: neither sold nor withdrawn. */
  remaining: RoleCount[];
}

/**
 * ROLE FACTS (Phase 1.5): two counts an owner would otherwise tally by hand.
 * This is a statement of the record, not an estimate — and it stays a
 * statement: which roles a squad NEEDS is the owner's call (or, later, the
 * auction's quotas), never this function's. Roles appear in the SEASON's
 * order, zero counts included, so the line reads the same shape every time.
 *
 * `seasonRoles` used to be `REGISTRATION_ROLES`, which is cricket's four. In a
 * football auction that seeded four phantom zeroes an owner never asked for —
 * "0 batters · 0 bowlers · 0 all-rounders · 0 wicket-keepers" — and sorted
 * every real football role after them, because cricket's order has no opinion
 * about a defender. The comment above used to say a role "is always one of
 * four", which was true of cricket and of nothing else.
 */
export function roleFacts(
  lots: readonly PlanLotRow[],
  preSignedRoles: readonly string[],
  teamId: string,
  seasonRoles: readonly string[],
): RoleFacts {
  const squad = new Map<string, number>();
  const remaining = new Map<string, number>();
  for (const role of seasonRoles) {
    squad.set(role, 0);
    remaining.set(role, 0);
  }
  for (const role of preSignedRoles) {
    squad.set(role, (squad.get(role) ?? 0) + 1);
  }
  for (const lot of lots) {
    // A sport with no playing roles has no role tally to keep — the lot still
    // counts toward the squad and the purse, it simply has nothing to count IN.
    if (lot.role === null) {
      continue;
    }
    if (lot.status === "sold") {
      if (lot.soldToTeamId === teamId) {
        squad.set(lot.role, (squad.get(lot.role) ?? 0) + 1);
      }
    } else if (lot.status !== "withdrawn") {
      remaining.set(lot.role, (remaining.get(lot.role) ?? 0) + 1);
    }
  }
  const ordered = (counts: Map<string, number>): RoleCount[] =>
    [...counts.entries()]
      .sort(([a], [b]) => {
        const ia = seasonRoles.indexOf(a);
        const ib = seasonRoles.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
      })
      .map(([role, count]) => ({ role, count }));
  return { squad: ordered(squad), remaining: ordered(remaining) };
}
