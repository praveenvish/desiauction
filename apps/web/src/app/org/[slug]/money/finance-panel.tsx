"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Select,
  VisuallyHidden,
  type BadgeTone,
} from "@desiauction/ui";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import type { FinanceWorkspace } from "../../../../server/financial-operations/actions";
import { IssuancePanel } from "./issuance-panel";
import type { RegisterRow } from "../../../../server/financial-operations/views";
import {
  DOC_KIND_LABEL,
  FINANCE_VIEWS,
  filterRegister,
} from "../../../../server/financial-operations/register";
import "../../../competitions/[slug]/money/money.css";
import "./finance.css";

/**
 * PX-8 §1 — the Financial Operations dashboard (the ops board).
 *
 * Every figure is a certified snapshot's own field: health comes from
 * `operationsDashboardSnapshot`, the attention queue from
 * `complianceQueueSnapshot` (which already carries each item's resolving
 * action), collections from `issuanceSnapshot`. Nothing on this screen decides
 * whether something is healthy — the platform does, and this renders the verdict.
 */

const HEALTH_TONE: Record<string, BadgeTone> = {
  healthy: "success",
  degraded: "warning",
  failed: "danger",
};

const COMPONENT_LABEL: Record<string, string> = {
  follower: "Settlement ingest",
  runner: "Job runner",
  dispatch: "Deliveries",
  exports: "Exports",
  documents: "Documents",
  "settlement-sync": "Settlement sync",
  fiscal: "Fiscal year",
};

/** The platform's event vocabulary, said plainly. Unknown types render as themselves. */
const EVENT_LABEL: Record<string, string> = {
  ProfileDeclared: "Finance profile declared",
  ProfileAmended: "Finance profile amended",
  SeriesOpened: "Numbering series opened",
  DocumentIssued: "Document issued",
  CorrectionIssued: "Correction issued",
  SeriesClosed: "Numbering series closed",
  DispatchRequested: "Delivery requested",
  DispatchSent: "Delivery sent",
  DispatchConfirmed: "Delivery confirmed",
  DispatchFailed: "Delivery failed",
  ExportRequested: "Export requested",
  ExportCompleted: "Export completed",
  ExportFailed: "Export failed",
  PeriodOpened: "Fiscal year opened",
  DayAttested: "Day attested",
  ExceptionNoted: "Exception noted",
  PeriodClosed: "Fiscal year sealed",
  PeriodReopened: "Fiscal year reopened",
};

function inr(value: number): string {
  return formatPaiseINR(paise(value));
}

export function FinancePanel({ slug, workspace }: { slug: string; workspace: FinanceWorkspace }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = params.get("view") ?? "all";
  const kind = params.get("kind") ?? "";
  const query = params.get("q") ?? "";

  const { board, register } = workspace;
  const rows = useMemo(
    () => filterRegister(register, view, kind, query),
    [register, view, kind, query],
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <>
      {/* --- The lifecycle's entrance: nothing downstream exists without it --- */}
      <IssuancePanel slug={slug} workspace={workspace} />

      {/* --- Operations overview --------------------------------------------- */}
      <Card>
        <div className="competition-title-row">
          <h2>Operations</h2>
          <Badge tone={HEALTH_TONE[board.dashboard.overall] ?? "neutral"} data-testid="ops-overall">
            {board.dashboard.overall}
          </Badge>
        </div>
        <ul className="health-row" data-testid="health-row">
          {board.dashboard.components.map((component) => (
            <li
              key={component.component}
              className="health-lamp"
              data-status={component.status}
              data-testid={`health-${component.component}`}
            >
              <span className="health-name">
                {COMPONENT_LABEL[component.component] ?? component.component}
              </span>
              <span className="health-detail">
                {component.status}
                {component.detail === null ? "" : ` · ${component.detail}`}
              </span>
            </li>
          ))}
        </ul>
        <p className="freshness" data-testid="freshness">
          <span>
            Fiscal year <strong>{board.fy}</strong>
          </span>
          <span>
            Settlement ingest{" "}
            <strong>
              {board.follower.current ? "current" : `${String(board.follower.totalBehind)} behind`}
            </strong>
          </span>
          <span>
            Jobs <strong>{board.runner.jobs.queued} queued</strong>, {board.runner.jobs.dead} dead
          </span>
        </p>
      </Card>

      {/* --- The numbers an operator opens the day with ------------------------ */}
      <div className="stat-row">
        <Tile
          label="Awaiting a receipt"
          value={String(board.collections.awaitingReceipt)}
          id="stat-awaiting"
          note={board.collections.autoReceipt ? "auto-receipt on" : "auto-receipt off"}
        />
        <Tile label="Documents issued" value={String(board.collections.issued)} id="stat-issued" />
        <Tile
          label="Needs attention"
          value={String(board.queue.items.length)}
          id="stat-attention"
        />
        <Tile label="Today's activity" value={String(board.todayTotal)} id="stat-today" />
      </div>

      {/* --- Exceptions: the ranked attention queue ---------------------------- */}
      <Card>
        <h2>Needs attention</h2>
        {board.queue.items.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="Nothing needs a human"
            description="Every component is healthy, no delivery has failed and no export is unverified. The platform re-derives this on every read — it is never a stale flag."
          />
        ) : (
          <ul className="attention-list" data-testid="attention-list">
            {board.queue.items.map((item, index) => (
              <li className="attention-item" key={`${item.kind}-${String(index)}`}>
                <span>
                  <Badge tone={item.kind.endsWith("failed") ? "danger" : "warning"}>
                    {item.kind}
                  </Badge>{" "}
                  <span className="attention-subject">{item.subject}</span>
                </span>
                {/* The platform names the resolving action; the console shows it
                    verbatim rather than guessing a different remedy. */}
                <span className="attention-action">{item.action}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* --- Today ------------------------------------------------------------- */}
      <Card>
        <h2>Today</h2>
        {board.today.length === 0 ? (
          <p className="section-note">Nothing has happened in finance today.</p>
        ) : (
          <ul className="attention-list" data-testid="today-list">
            {board.today.map((line) => (
              <li className="attention-item" key={line.type}>
                <span className="attention-subject">{EVENT_LABEL[line.type] ?? line.type}</span>
                <strong>{line.count}</strong>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* --- The documents register ------------------------------------------- */}
      <Card>
        <h2>Documents</h2>
        <ul className="saved-views" data-testid="finance-views">
          {FINANCE_VIEWS.map((saved) => (
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
            label="Search documents"
            type="search"
            placeholder="Number, party, payment reference or digest"
            defaultValue={query}
            onChange={(event) => {
              setParam("q", event.target.value);
            }}
            data-testid="register-search"
          />
          <Select
            label="Kind"
            value={kind}
            onChange={(event) => {
              setParam("kind", event.target.value);
            }}
            data-testid="kind-filter"
          >
            <option value="">Any kind</option>
            {Object.entries(DOC_KIND_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title={register.length === 0 ? "No documents yet" : "Nothing matches this view"}
            description={
              register.length === 0
                ? "Receipts and invoices appear here as settlement collects money. Nothing is issued by this screen."
                : "Try a different view, clear the kind filter, or search by number, party or payment reference."
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="money-table" data-testid="register-table">
              <caption>
                <VisuallyHidden>Every document this organization has issued</VisuallyHidden>
              </caption>
              <thead>
                <tr>
                  <th scope="col">Number</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Party</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col">Reproducible</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <RegisterLine key={row.docId} slug={slug} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function RegisterLine({ slug, row }: { slug: string; row: RegisterRow }) {
  return (
    <tr data-testid={`doc-${row.docId}`}>
      <td data-label="Number">
        <Link href={`/org/${slug}/money/documents/${row.docId}`}>
          {row.kind === "correction" ? "CN " : ""}
          {row.number}
        </Link>
      </td>
      <td data-label="Kind">{DOC_KIND_LABEL[row.kind] ?? row.kind}</td>
      <td data-label="Party">{row.partyLabel}</td>
      <td data-label="Amount" className="num">
        <span title={`${String(row.amount)} paise`}>{inr(row.amount)}</span>
      </td>
      <td data-label="Reproducible">
        {/* The register lists what exists; the DETAIL page runs the live
            reproduction. A digest here is the sealed one, not a claim. */}
        <span className="digest">{row.contentDigest.slice(0, 12)}…</span>
      </td>
    </tr>
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
