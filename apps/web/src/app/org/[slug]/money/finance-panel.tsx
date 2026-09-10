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
import { usePathname, useSearchParams } from "next/navigation";
import { useFilterQuery } from "../../../../lib/use-filter-query";
import { useMemo } from "react";

import type { FinanceWorkspace } from "../../../../server/financial-operations/actions";
import { IssuancePanel } from "./issuance-panel";
import type { RegisterRow } from "../../../../server/financial-operations/views";
import {
  DOC_KIND_LABEL,
  FINANCE_VIEWS,
  filterRegister,
  registerTotals,
} from "../../../../server/financial-operations/register";
import "../../../seasons/[slug]/money/money.css";
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

/**
 * The runner's own freshness budget (operations.ts measures
 * `oldestRequestedAgeMs` against 15 minutes). Work still waiting past it means
 * nothing is picking it up.
 */
const RUNNER_BUDGET_MS = 15 * 60_000;

/**
 * A waiting time in words. Pure: it takes an already-elapsed duration, resolved
 * on the server against the injected clock, so this renders identically in both
 * places. Deliberately coarse — the operator needs "is this stuck?", and
 * "9 days" answers that where "1192" never did.
 */
function waitedFor(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour" : `${String(hours)} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${String(days)} days`;
}

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
  const pathname = usePathname();
  const params = useSearchParams();
  /*
   * TWO READINGS OF THE SAME PARAMS, and the difference matters.
   *
   * `view` below is the RESOLVED value — "all" when the URL says nothing — and
   * that is what filters and renders. `useFilterQuery` is given the RAW value
   * instead, because a default that was never chosen must not be written back:
   * serialising it turns a cleared filter bar into `?view=all` rather than a
   * bare address, and the saved-view links are built from `pathname` on the
   * assumption that the bare address means "all".
   */
  const rawView = params.get("view") ?? "";
  const view = rawView === "" ? "all" : rawView;
  const kind = params.get("kind") ?? "";
  const query = params.get("q") ?? "";

  const { board, register } = workspace;
  const rows = useMemo(
    () => filterRegister(register, view, kind, query),
    [register, view, kind, query],
  );
  // Totals are of the WHOLE year's register, not the filtered view — a total
  // that moves when you type in a search box is not a total.
  const totals = useMemo(() => registerTotals(register, board.fy), [register, board.fy]);

  /*
   * The filter bar writes the URL and the SERVER reads it back, so the write
   * has to be deliberate: a navigation per keystroke, built from a live
   * `useSearchParams` snapshot, is what made clearing this box leave the empty
   * state up for twenty seconds on Safari. `useFilterQuery` explains it.
   */
  const { commit, search, setSearch } = useFilterQuery({ view: rawView, kind, q: query });

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
          {board.dashboard.components.map((component) => {
            // The runner lamp is corrected here against this org's own queue.
            // Upstream, runner health is `dead === 0` with no depth or age
            // test — and a runner that never runs cannot produce a dead job,
            // so being completely down scores "healthy". Observed: 1192 jobs
            // waiting, oldest 9 days, 0 dead, lamp green. A stalled queue is
            // the operator's problem whatever the platform thinks, so if work
            // has been waiting past the runner's own 15-minute budget we say
            // so rather than repeat a verdict our data contradicts.
            const stalled =
              component.component === "runner" &&
              board.jobs.oldestQueuedWaitMs !== null &&
              board.jobs.oldestQueuedWaitMs > RUNNER_BUDGET_MS;
            const status =
              stalled && component.status === "healthy" ? "degraded" : component.status;
            const detail = stalled
              ? `nothing picked up for ${waitedFor(board.jobs.oldestQueuedWaitMs)}`
              : component.detail;
            return (
              <li
                key={component.component}
                className="health-lamp"
                data-status={status}
                data-testid={`health-${component.component}`}
              >
                <span className="health-name">
                  {COMPONENT_LABEL[component.component] ?? component.component}
                </span>
                <span className="health-detail">
                  {status}
                  {detail === null ? "" : ` · ${detail}`}
                </span>
              </li>
            );
          })}
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
          {/* This org's jobs, not the platform's. `board.runner.jobs` counts
              every organization's work — it printed "1192 queued" on an org
              that owned five jobs, and on a brand-new org that owned none.
              The age is here because it is the number that tells the truth:
              upstream health is `dead === 0` with no age or depth test, so a
              runner that never runs reports healthy. */}
          <span>
            Jobs <strong>{board.jobs.queued} waiting</strong>
            {board.jobs.oldestQueuedWaitMs === null
              ? ""
              : `, oldest ${waitedFor(board.jobs.oldestQueuedWaitMs)}`}
            {board.jobs.dead === 0 ? "" : `, ${String(board.jobs.dead)} given up`}
          </span>
        </p>
      </Card>

      {/* --- What the register actually holds ---------------------------------
          The desk stated no money total at all: an operator could reconcile
          nothing without opening the register and adding it up by eye. */}
      <Card>
        <h2>This financial year</h2>
        <div className="stat-row">
          <Tile
            label="Receipted"
            value={inr(totals.receiptedPaise)}
            id="stat-receipted"
            note={`${String(totals.receipts)} ${totals.receipts === 1 ? "receipt" : "receipts"}`}
          />
          {totals.invoices > 0 ? (
            <Tile
              label="Invoiced"
              value={inr(totals.invoicedPaise)}
              id="stat-invoiced"
              note={`${String(totals.invoices)} ${totals.invoices === 1 ? "invoice" : "invoices"}`}
            />
          ) : null}
          {totals.corrections > 0 ? (
            <Tile label="Corrections" value={String(totals.corrections)} id="stat-corrections" />
          ) : null}
        </div>
        <p className="section-note">
          {/* Point at settlement rather than answering "who still owes us?" here.
              Two surfaces answering one money question with different arithmetic
              is how a book stops being trusted. */}
          What each team still owes is tracked in{" "}
          <Link href={`/org/${slug}/settlement`}>Settlement</Link>, which is where dues are computed
          and collected.
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
            // CONTROLLED. With `defaultValue` the box kept whatever had been
            // typed after a saved-view link dropped `q`, so it showed a term it
            // was no longer filtering by.
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            data-testid="register-search"
          />
          <Select
            label="Kind"
            value={kind}
            onChange={(event) => {
              // A chosen value, not a typed one — it lands at once.
              commit({ kind: event.target.value });
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
          // `money-scroll` restores overflow-x above 640px. `seasons.css` turns
          // .table-scroll's scrolling OFF under 1100px because .reg-table
          // card-stacks there — but .money-table only stacks at 640px, so
          // between 641 and 1100 these tables had neither a scroller nor a
          // stacked layout and simply escaped the card. Measured 785 > 768 here.
          // The class lives in money.css so /registrations keeps the behaviour
          // that rule was written for.
          <div
            className="table-scroll money-scroll"
            tabIndex={0}
            role="region"
            aria-label="Document register"
          >
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
                  {/* "Sealed digest", not "Reproducible": this column has
                      always rendered the digest taken when the document was
                      issued, and the code below says so plainly. Under the old
                      header a treasurer scanning for a broken document read hex
                      strings as a yes/no answer — and on mobile the stacked row
                      said literally "Reproducible bdebeedba536…". The live
                      reproduction check runs on the detail page, which is the
                      only place that actually re-derives the document. */}
                  <th scope="col">Sealed digest</th>
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
        {/* The qualified number, and a target you can actually hit. The link
            text used to be the bare series-relative number — usually a single
            digit — which made this 5.0 × 15px: below the 24 × 24 floor of
            WCAG 2.2 SC 2.5.8, and the ONLY route into a document. axe stays
            silent on it because `target-size` is not in the wcag21aa tag set. */}
        <Link className="doc-link" href={`/org/${slug}/money/documents/${row.docId}`}>
          {row.kind === "correction" ? "CN " : ""}
          {row.formatted}
        </Link>
      </td>
      <td data-label="Kind">{DOC_KIND_LABEL[row.kind] ?? row.kind}</td>
      <td data-label="Party">{row.partyLabel}</td>
      <td data-label="Amount" className="num">
        <span title={`${String(row.amount)} paise`}>{inr(row.amount)}</span>
      </td>
      <td data-label="Sealed digest">
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
