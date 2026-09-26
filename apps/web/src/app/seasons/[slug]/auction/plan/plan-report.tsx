"use client";

import { TARGET_PRIORITY_LABELS, type PlanReport, type ReportOutcome } from "@desiauction/core";
import { Badge, Card, EmptyState, PlayerImage, RosterMark, type BadgeTone } from "@desiauction/ui";

import type { PlanLotRow } from "../../../../../server/auction/owner-plan";
import type { PreSignedPlayer } from "../../../../../server/auction/live-summary";
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
            // A face, and the role under the name: the role sat ~700px from
            // the name across a full-width row (review r2, r3).
            <li key={row.registrationId} className="plan-bought-row">
              <PlayerImage
                name={lot?.playerName ?? "A player"}
                seed={row.registrationId}
                size="sm"
                shape="round"
                decorative
              />
              <span className="plan-bought-who">
                <span className="plan-bought-name">{lot?.playerName ?? "A player"}</span>
                <span className="plan-bought-role">{labelOf(lot?.role ?? null)}</span>
              </span>
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
 *
 * Round 5: the empty-state tray and headline sat on top of a ten-row list, so
 * the page said "nothing here" and then showed something. The empty state is
 * for an empty night only; a night with a squad leads with the squad's sums
 * and lists everyone in it — the pre-signed first, as /teams does.
 */
export function NoPlanReport({
  report,
  lotsByRegistration,
  labelOf,
  preSigned = [],
  squadSize,
  squadMax,
  purseRemaining,
}: {
  report: PlanReport;
  lotsByRegistration: Map<string, PlanLotRow>;
  labelOf: (role: string | null) => string;
  /** This team's pre-signed players — they count in the squad, so they are listed. */
  preSigned?: PreSignedPlayer[];
  squadSize?: number;
  squadMax?: number;
  purseRemaining?: number;
}) {
  const money = useMoney();
  const bought = report.outsidePlan;
  if (bought.length === 0 && preSigned.length === 0) {
    return (
      <Card data-testid="plan-report" className="plan-noplan">
        <EmptyState
          headingLevel={2}
          title="You went in without a plan"
          description="And the night passed without a signing for this team."
        />
      </Card>
    );
  }
  const size = squadSize ?? bought.length + preSigned.length;
  return (
    <Card data-testid="plan-report" className="plan-noplan plan-squad">
      <div className="plan-squad-head">
        <h2>Your squad</h2>
        <p className="plan-hint">No plan was set for this night — this is what the team signed.</p>
      </div>
      <dl className="plan-squad-facts">
        <div>
          <dt>Squad</dt>
          <dd>
            {size}
            {squadMax === undefined ? null : <span>/{squadMax}</span>}
          </dd>
          <dd className="plan-squad-sub">
            {bought.length} bought
            {preSigned.length > 0 ? ` + ${String(preSigned.length)} pre-signed` : ""}
          </dd>
        </div>
        <div>
          <dt>Spent</dt>
          <dd>{money.ledger(report.outsidePlanTotal)}</dd>
        </div>
        {purseRemaining === undefined ? null : (
          <div>
            <dt>Purse left</dt>
            <dd>{money.ledger(purseRemaining)}</dd>
          </div>
        )}
      </dl>
      {preSigned.length > 0 ? (
        <ul className="plan-bought" data-testid="plan-report-presigned-list">
          {preSigned.map((player) => (
            <li key={player.registrationId} className="plan-bought-row">
              <PlayerImage
                name={player.playerName ?? "A player"}
                seed={player.registrationId}
                src={player.photoUrl}
                size="sm"
                shape="round"
                decorative
              />
              <span className="plan-bought-who">
                <span className="plan-bought-line">
                  <span className="plan-bought-name">{player.playerName ?? "A player"}</span>
                  {player.isCaptain ? <RosterMark kind="captain" /> : null}
                  {player.isIcon ? <RosterMark kind="icon" /> : null}
                  {player.isRetained ? <RosterMark kind="retained" /> : null}
                </span>
                <span className="plan-bought-role">{labelOf(player.role)}</span>
              </span>
              <span className="plan-bought-price plan-bought-price--signed">Pre-signed</span>
            </li>
          ))}
        </ul>
      ) : null}
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
