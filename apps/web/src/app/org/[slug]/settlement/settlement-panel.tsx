"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import { Badge, Card, EmptyState, Field, Select, type BadgeTone } from "@desiauction/ui";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import type { SettlementDashboard } from "../../../../server/settlement/actions";
import type { DashboardCase } from "../../../../server/settlement/views";
import {
  CASE_STATUS_LABEL,
  SAVED_VIEWS,
  filterCases,
} from "../../../../server/settlement/worklist";
import "../../../competitions/[slug]/money/money.css";

/**
 * PX-7 §5 — the Settlement dashboard.
 *
 * A worklist, not a financial dashboard: every figure on it is the SAME
 * `caseFinancial` fold the console and the ceremony render, so a row and a case
 * can never disagree. Search, filter and saved views live in the URL — a
 * treasurer's "cases I still owe work on" is a link they can bookmark, and the
 * server renders it identically on a cold load.
 */

const STATUS_TONE: Record<string, BadgeTone> = {
  opened: "info",
  verified: "info",
  discrepant: "danger",
  settling: "warning",
  settled: "success",
  closed: "success",
  voided: "neutral",
};

function inr(value: number): string {
  return formatPaiseINR(paise(value));
}

export function SettlementPanel({ dashboard }: { dashboard: SettlementDashboard }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const view = params.get("view") ?? "attention";
  const status = params.get("status") ?? "";
  const query = params.get("q") ?? "";

  const rows = useMemo(
    () => filterCases(dashboard.view.cases, view, status, query),
    [dashboard.view.cases, view, status, query],
  );

  /** Every control writes the URL — the view IS the address (deep links, §8). */
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const { stats } = dashboard.view;

  return (
    <>
      <div className="stat-row">
        <Tile label="Needs attention" value={String(stats.attention)} id="stat-attention" />
        <Tile
          label="Collected today"
          value={inr(stats.collectedToday)}
          id="stat-today"
          note={`${String(stats.collectedTodayCount)} payment${stats.collectedTodayCount === 1 ? "" : "s"}`}
        />
        <Tile label="Outstanding" value={inr(stats.outstanding)} id="stat-outstanding" />
        <Tile label="Reconciled" value={String(stats.closed)} id="stat-closed" />
      </div>

      <Card>
        <ul className="saved-views" data-testid="saved-views">
          {SAVED_VIEWS.map((saved) => (
            <li key={saved.key}>
              <Link
                href={`${pathname}?view=${saved.key}`}
                title={saved.hint}
                data-testid={`view-${saved.key}`}
                aria-current={view === saved.key ? "page" : undefined}
              >
                <Badge tone={view === saved.key ? "info" : "neutral"}>{saved.label}</Badge>
              </Link>
            </li>
          ))}
        </ul>

        <div className="filter-bar">
          <Field
            label="Search cases"
            type="search"
            placeholder="Competition, case reference or status"
            defaultValue={query}
            onChange={(event) => {
              setParam("q", event.target.value);
            }}
            data-testid="case-search"
          />
          <Select
            label="Status"
            value={status}
            onChange={(event) => {
              setParam("status", event.target.value);
            }}
            data-testid="status-filter"
          >
            <option value="">Any status</option>
            {Object.entries(CASE_STATUS_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            headingLevel={2}
            title={
              dashboard.view.cases.length === 0
                ? "No settlement cases yet"
                : "Nothing matches this view"
            }
            description={
              dashboard.view.cases.length === 0
                ? "A case opens once an auction finishes. When one does, it appears here with what is owed and what has come in."
                : "Try a different saved view, clear the status filter, or search for the competition by name."
            }
          />
        </Card>
      ) : (
        <div className="case-grid" data-testid="case-list">
          {rows.map((row) => (
            <CaseCard key={row.caseId} row={row} />
          ))}
        </div>
      )}
    </>
  );
}

function Tile({
  label,
  value,
  id,
  note,
}: {
  label: string;
  value: string;
  id: string;
  note?: string;
}) {
  return (
    <div className="stat-tile">
      <span className="stat-value" data-testid={id}>
        {value}
      </span>
      <span className="stat-label">{label}</span>
      {note !== undefined ? <span className="stat-label">{note}</span> : null}
    </div>
  );
}

/**
 * The whole card is the link — bulk navigation is walking the worklist, and a
 * treasurer should never have to hunt for a target the size of a word.
 */
function CaseCard({ row }: { row: DashboardCase }) {
  return (
    <Link
      href={`/competitions/${row.competitionSlug}/money`}
      className="case-card"
      data-testid={`case-${row.caseId}`}
      data-status={row.status}
    >
      <span className="case-card-head">
        <span className="case-card-name">{row.competitionName}</span>
        <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>
          {CASE_STATUS_LABEL[row.status] ?? row.status}
        </Badge>
      </span>
      <span className="case-card-money">
        <span>
          Dues <strong>{inr(row.totalObligations)}</strong>
        </span>
        <span>
          Collected <strong>{inr(row.discharged)}</strong>
        </span>
        <span>
          Waived <strong>{inr(row.waived)}</strong>
        </span>
        <span>
          Outstanding <strong>{inr(row.outstanding)}</strong>
        </span>
      </span>
      <span className="case-card-money">
        <span>
          {row.teamCount} team{row.teamCount === 1 ? "" : "s"} · case {row.caseId.slice(-8)}
        </span>
      </span>
    </Link>
  );
}
