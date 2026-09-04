"use client";

import {
  TARGET_PRIORITY_LABELS,
  formatPaiseINR,
  paise,
  type PlanReport,
  type ReportOutcome,
} from "@desiauction/core";
import { Badge, Card, type BadgeTone } from "@desiauction/ui";

import type { PlanLotRow } from "../../../../../server/auction/owner-plan";

/**
 * HOW THE NIGHT WENT (WR-1, Phase 1.5). Shown on the plan page once the auction
 * is over: the plan as it stood at each hammer, against the record. Four
 * facts up top, then a line per target. It states; it does not grade — an
 * owner who went past a max to sign a must-have did exactly what the plan was
 * for, and the page says so in numbers, not adjectives.
 */

function money(value: number): string {
  return formatPaiseINR(paise(value));
}

const OUTCOME: Record<ReportOutcome, { tone: BadgeTone; label: string }> = {
  won: { tone: "success", label: "Signed" },
  lost: { tone: "neutral", label: "Went elsewhere" },
  unsold: { tone: "neutral", label: "Unsold" },
  withdrawn: { tone: "neutral", label: "Withdrawn" },
  open: { tone: "neutral", label: "Never came up" },
};

export function PlanReportCard({
  report,
  lotsByRegistration,
}: {
  report: PlanReport;
  lotsByRegistration: Map<string, PlanLotRow>;
}) {
  const name = (registrationId: string) =>
    lotsByRegistration.get(registrationId)?.playerName ?? "A player";
  return (
    <Card data-testid="plan-report">
      <h2>How the night went</h2>
      <div className="stat-row plan-stats">
        <div className="stat-tile" data-testid="plan-report-signed">
          <span className="stat-value">
            {report.signed} of {report.targets}
          </span>
          <span className="stat-label">Targets signed</span>
        </div>
        <div className="stat-tile" data-testid="plan-report-paid">
          <span className="stat-value">{money(report.paidForTargets)}</span>
          <span className="stat-label">Paid for them · planned {money(report.plannedTotal)}</span>
        </div>
        <div className="stat-tile" data-testid="plan-report-over">
          <span className="stat-value">
            {report.overMaxCount === 0 ? "—" : money(report.overMaxTotal)}
          </span>
          <span className="stat-label">
            {report.overMaxCount === 0
              ? "Never past a max"
              : `Past a max ${report.overMaxCount === 1 ? "once" : `${String(report.overMaxCount)} times`}`}
          </span>
        </div>
        <div className="stat-tile" data-testid="plan-report-outside">
          <span className="stat-value">
            {report.outsidePlan.length === 0 ? "—" : money(report.outsidePlanTotal)}
          </span>
          <span className="stat-label">
            {report.outsidePlan.length === 0
              ? "Nothing bought off-plan"
              : `Bought off-plan · ${String(report.outsidePlan.length)}`}
          </span>
        </div>
      </div>
      {report.rows.length === 0 ? (
        <p className="plan-hint">No target stood when the hammers fell.</p>
      ) : (
        <ul className="plan-report-list">
          {report.rows.map((row) => {
            const outcome = OUTCOME[row.outcome];
            return (
              <li
                key={row.registrationId}
                className="plan-report-row"
                data-testid={`plan-report-${row.registrationId}`}
              >
                <span className="plan-report-name">
                  <span className="registration-name">{name(row.registrationId)}</span>
                  <span className="plan-sub">
                    {TARGET_PRIORITY_LABELS[row.priority]} ·{" "}
                    {row.maxBid === null ? "no max" : `max ${money(row.maxBid)}`}
                  </span>
                </span>
                <span className="plan-report-outcome">
                  <Badge tone={outcome.tone}>{outcome.label}</Badge>
                  {row.paid !== null ? (
                    <span className="plan-sub">
                      {row.outcome === "won" ? "for" : "at"} {money(row.paid)}
                      {row.overBy !== null ? ` · ${money(row.overBy)} past your max` : ""}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {report.outsidePlan.length > 0 ? (
        <p className="plan-hint" data-testid="plan-report-outside-list">
          Off-plan:{" "}
          {report.outsidePlan
            .map((row) => `${name(row.registrationId)} (${money(row.paid)})`)
            .join(", ")}
        </p>
      ) : null}
    </Card>
  );
}
