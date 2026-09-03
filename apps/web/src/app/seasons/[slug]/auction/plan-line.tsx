"use client";

import { formatPaiseINR, paise, type LotVerdict, type PlanState } from "@desiauction/core";
import { Badge, type BadgeTone } from "@desiauction/ui";
import { useMemo } from "react";

import { backupFor } from "./plan-live";

/**
 * ONE LINE UNDER THE RAISE BUTTON (WR-1, M4).
 *
 * Rendered only when the lot on the block is on this owner's plan, or is the
 * next planned alternative for a target they lost. It says three things in the
 * owner's own numbers — their max, the next bid, and what winning at that price
 * would leave — and it never says "bid" or "stop". The raise button stays the
 * loudest thing on the surface; this is set in the muted text below it.
 *
 * The visually-hidden live region announces the VERDICT only, so a screen
 * reader hears "over your max" once, not every rung.
 */

function money(value: number): string {
  return formatPaiseINR(paise(value));
}

const VERDICT_BADGE: Record<
  Exclude<LotVerdict, "not_a_target">,
  { tone: BadgeTone; label: (overBy: string | null) => string }
> = {
  within_plan: { tone: "success", label: () => "Within your plan" },
  over_max: {
    tone: "danger",
    label: (overBy) => `Over your max${overBy === null ? "" : ` by ${overBy}`}`,
  },
  leading: { tone: "info", label: () => "You lead" },
  engine_ceiling: { tone: "neutral", label: () => "On your plan" },
  target_no_max: { tone: "neutral", label: () => "On your plan · no max" },
};

export function PlanLine({
  state,
  names,
}: {
  state: PlanState;
  names: (registrationId: string) => string;
}) {
  const advice = state.currentLot;
  const lostFor = backupFor(state);
  const verdict = advice?.verdict ?? "not_a_target";
  const announcement = useMemo(() => {
    switch (verdict) {
      case "within_plan":
        return "Within your plan.";
      case "over_max":
        return "Over your max.";
      case "leading":
        return "You lead this lot.";
      default:
        return "";
    }
  }, [verdict]);

  if (advice === null || (verdict === "not_a_target" && lostFor === null)) {
    return null;
  }
  const target = advice.target;
  const max = target?.maxBid ?? null;
  const badge = verdict === "not_a_target" ? null : VERDICT_BADGE[verdict];
  const after = advice.ifWon;
  const openAfter =
    state.budget.openTargets - (target !== null && target.outcome === "open" ? 1 : 0);

  return (
    <div className="plan-line" data-testid="plan-line" data-verdict={verdict}>
      <p className="plan-line-head">
        {lostFor !== null ? (
          <Badge tone="neutral" data-testid="plan-line-backup">
            Backup for {names(lostFor)}
          </Badge>
        ) : null}
        {badge !== null ? (
          <Badge tone={badge.tone} data-testid="plan-line-verdict">
            {badge.label(advice.overBy === null ? null : money(advice.overBy))}
          </Badge>
        ) : null}
        {verdict === "leading" && advice.leadingOverBy !== null ? (
          <span>
            <span className="plan-line-money">{money(advice.leadingOverBy)}</span> over your max
          </span>
        ) : null}
        {max !== null ? (
          <span>
            Your max <span className="plan-line-money">{money(max)}</span>
          </span>
        ) : target !== null && target.basePrice !== null ? (
          <span>
            Counted at base <span className="plan-line-money">{money(target.basePrice)}</span>
          </span>
        ) : null}
        {verdict !== "leading" ? (
          <span>
            · next bid <span className="plan-line-money">{money(advice.nextBid)}</span>
          </span>
        ) : null}
      </p>
      <p className="plan-line-next" data-testid="plan-line-next">
        {verdict === "leading" ? "If you win at" : "Win at"}{" "}
        <span className="plan-line-money">{money(after.amount)}</span> →{" "}
        <span className="plan-line-money">{money(after.purseAfter)}</span> left
        {openAfter === 0 ? (
          ", nothing else planned"
        ) : (
          <>
            , <span className="plan-line-money">{money(after.plannedExposureAfter)}</span> planned
            for {openAfter} {openAfter === 1 ? "target" : "targets"}
          </>
        )}
        {after.fitAfter === "does_not_fit"
          ? " · plan would no longer fit"
          : after.fitAfter === "at_risk"
            ? " · plan would leave too little for the squad"
            : ""}
      </p>
      <span className="auction-sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
