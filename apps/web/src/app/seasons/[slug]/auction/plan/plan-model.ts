import {
  TARGET_PRIORITIES,
  TARGET_PRIORITY_LABELS,
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
    const haystack =
      `${lot.playerName ?? ""} ${lot.number} ${lot.role.replace(/_/g, " ")}`.toLowerCase();
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
