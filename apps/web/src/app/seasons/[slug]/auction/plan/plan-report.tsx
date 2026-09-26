"use client";

import { TARGET_PRIORITY_LABELS, type PlanReport, type ReportOutcome } from "@desiauction/core";
import { Badge, Card, EmptyState, type BadgeTone } from "@desiauction/ui";

import type { PlanLotRow } from "../../../../../server/auction/owner-plan";
import { useMoney } from "../../../../../components/money-unit";

/**
 * HOW THE NIGHT WENT (WR-1, Phase 1.5). Shown on the plan page once the auction
 * is over: the plan as it stood at each hammer, against the record. Four
 * facts up top, then a line per target. It states; it does not grade — an
 * owner who went past a max to sign a must-have did exactly what the plan was
 * for, and the page says so in numbers, not adjectives.
 */

const OUTCOME: Record<ReportOutcome, { tone: BadgeTone; label: string }> = {
  won: { tone: "success", label: "Signed" },
  lost: { tone: "neutral", label: "Went elsewhere" },
  unsold: { tone: "neutral", label: "Unsold" },
  withdrawn: { tone: "neutral", label: "Withdrawn" },
  open: { tone: "neutral", label: "Never came up" },
};

/**
 * The players this team bought, as a list — name, role, price — never a
 * comma paragraph ("Off-plan: A (5,000 pts), B (1,000 pts), …" ran to ten).
 */
function BoughtList({
  rows,
  lotsByRegistration,
  labelOf,
  testId,
}: {
  rows: PlanReport["outsidePlan"];
  lotsByRegistration: Map<string, PlanLotRow>;
  labelOf: (role: string | null) => string;
  testId?: string;
}) {
  const money = useMoney();
  return (
    <ul className="plan-bought" data-testid={testId}>
      {[...rows]
        .sort((a, b) => b.paid - a.paid)
        .map((row) => {
          const lot = lotsByRegistration.get(row.registrationId);
          return (
            <li key={row.registrationId} className="plan-bought-row">
              <span className="plan-bought-name">{lot?.playerName ?? "A player"}</span>
              <span className="plan-bought-role">{labelOf(lot?.role ?? null)}</span>
              <span className="plan-bought-price">{money.ledger(row.paid)}</span>
            </li>
          );
        })}
    </ul>
  );
}

/**
 * THE NIGHT WITHOUT A PLAN. A team that never planned used to get seven tiles
 * of zeros ("0 of 0", "0 pts", "—") and only then "No targets yet". It gets
 * one sentence and what it actually bought.
 */
export function NoPlanReport({
  report,
  lotsByRegistration,
  labelOf,
}: {
  report: PlanReport;
  lotsByRegistration: Map<string, PlanLotRow>;
  labelOf: (role: string | null) => string;
}) {
  const money = useMoney();
  const bought = report.outsidePlan;
  return (
    <Card data-testid="plan-report" className="plan-noplan">
      <EmptyState
        headingLevel={2}
        title="You went in without a plan"
        description={
          bought.length === 0
            ? "And the night passed without a signing for this team."
            : `Bought ${String(bought.length)} ${bought.length === 1 ? "player" : "players"} for ${money.ledger(report.outsidePlanTotal)}.`
        }
      />
      {bought.length > 0 ? (
        <BoughtList
          rows={bought}
          lotsByRegistration={lotsByRegistration}
          labelOf={labelOf}
          testId="plan-report-outside-list"
        />
      ) : null}
    </Card>
  );
}

export function PlanReportCard({
  report,
  lotsByRegistration,
  labelOf,
}: {
  report: PlanReport;
  lotsByRegistration: Map<string, PlanLotRow>;
  labelOf: (role: string | null) => string;
}) {
  const money = useMoney();
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
          <span className="stat-value">{money.ledger(report.paidForTargets)}</span>
          <span className="stat-label">
            Paid for them · planned {money.ledger(report.plannedTotal)}
          </span>
        </div>
        <div className="stat-tile" data-testid="plan-report-over">
          <span className="stat-value">
            {report.overMaxCount === 0 ? "—" : money.ledger(report.overMaxTotal)}
          </span>
          <span className="stat-label">
            {report.overMaxCount === 0
              ? "Never past a max"
              : `Past a max ${report.overMaxCount === 1 ? "once" : `${String(report.overMaxCount)} times`}`}
          </span>
        </div>
        <div className="stat-tile" data-testid="plan-report-outside">
          <span className="stat-value">
            {report.outsidePlan.length === 0 ? "—" : money.ledger(report.outsidePlanTotal)}
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
                    {row.maxBid === null ? "no max" : `max ${money.ledger(row.maxBid)}`}
                  </span>
                </span>
                <span className="plan-report-outcome">
                  <Badge tone={outcome.tone}>{outcome.label}</Badge>
                  {row.paid !== null ? (
                    <span className="plan-sub">
                      {row.outcome === "won" ? "for" : "at"} {money.ledger(row.paid)}
                      {row.overBy !== null ? ` · ${money.ledger(row.overBy)} past your max` : ""}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {report.outsidePlan.length > 0 ? (
        <>
          <h3 className="plan-bought-title">Bought off-plan</h3>
          <BoughtList
            rows={report.outsidePlan}
            lotsByRegistration={lotsByRegistration}
            labelOf={labelOf}
            testId="plan-report-outside-list"
          />
        </>
      ) : null}
    </Card>
  );
}
