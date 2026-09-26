import {
  EmptyState,
  Pager,
  Toolbar,
  ToolbarChip,
  ToolbarCount,
  ToolbarSearch,
  ToolbarSelect,
  ToolbarSpacer,
} from "@desiauction/ui";
import Link from "next/link";

import { ADMIN_ACCESS_ACTION } from "../../../server/admin/capabilities";
import { actorLabel, formatCount, isSystemActor } from "../../../server/admin/format";
import type { AuditEntry, AuditFilters, AuditPage } from "../../../server/admin/views";
import { AdminFilterForm } from "../admin-filter-form";
import { absoluteIst } from "../admin-ui";
import { formatDayDate } from "../../../lib/format-date";

/**
 * PX-9 §4 — the audit viewer.
 *
 * Evidence is rendered verbatim. The `meta` column is whatever the writing
 * domain put there (a capability set, an event seq, a digest); administration
 * does not interpret it, summarise it or grade it — an audit viewer that
 * paraphrased its evidence would be worthless in the moment it matters.
 */
export function AuditPanel({ page }: { page: AuditPage }) {
  const { rows, actions, total, filters, nextCursor } = page;
  const nextHref = nextCursor === null ? null : auditHref(filters, nextCursor);
  const days = groupByDay(rows);
  return (
    <>
      <div className="admin-panel">
        <AdminFilterForm testId="admin-audit-search">
          <Toolbar>
            <ToolbarSearch
              id="admin-audit-q"
              name="q"
              label="Search"
              placeholder="Actor, scope, subject or action"
              defaultValue={filters.q ?? ""}
              submitLabel="Filter"
            />
            <ToolbarSelect
              id="admin-audit-action"
              name="action"
              label="Action"
              defaultValue={filters.action ?? ""}
              options={[
                { value: "", label: "All actions" },
                ...actions.map((action) => ({ value: action, label: action })),
              ]}
            />
            <span className="admin-select admin-select-date">
              <label htmlFor="admin-audit-from">From</label>
              <input
                id="admin-audit-from"
                name="from"
                type="date"
                defaultValue={filters.from ?? ""}
              />
            </span>
            <span className="admin-select admin-select-date">
              <label htmlFor="admin-audit-to">To</label>
              <input id="admin-audit-to" name="to" type="date" defaultValue={filters.to ?? ""} />
            </span>
            {/* Deep links carry actor/scope; keep them across a filter change,
                and show them — a hidden filter is a list that lies. */}
            {filters.actor !== undefined ? (
              <>
                <input type="hidden" name="actor" value={filters.actor} />
                <ToolbarChip
                  href={auditHref({ ...filters, actor: undefined }, null)}
                  removeLabel="Remove the person filter"
                >
                  Person …{filters.actor.slice(-6)}
                </ToolbarChip>
              </>
            ) : null}
            {filters.scopeId !== undefined ? (
              <>
                <input type="hidden" name="scopeId" value={filters.scopeId} />
                <ToolbarChip
                  href={auditHref({ ...filters, scopeId: undefined }, null)}
                  removeLabel="Remove the scope filter"
                >
                  Scope …{filters.scopeId.slice(-6)}
                </ToolbarChip>
              </>
            ) : null}
            <ToolbarSpacer />
            {/* A hundred audit entries under zero headings: the page had one h1
                and nothing else. The day headings below name the list now. */}
            <ToolbarCount testId="admin-audit-count">
              {formatCount(rows.length)} of {formatCount(total)} event{total === 1 ? "" : "s"}
            </ToolbarCount>
          </Toolbar>
        </AdminFilterForm>
        {rows.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              size="compact"
              headingLevel={2}
              title="No matching events"
              description="Nothing in the audit log matches these filters."
            />
          </div>
        ) : (
          <>
            <div className="admin-log" data-testid="admin-audit-list">
              {days.map((day) => (
                <section key={day.key} className="admin-log-day" aria-label={day.label}>
                  <h2 className="admin-log-date">{day.label}</h2>
                  <ul className="admin-log-rows">
                    {runs(day.rows, filters.action !== ADMIN_ACCESS_ACTION).map((run) =>
                      run.length === 1 ? (
                        <AuditRow key={run[0]?.id} row={run[0] as AuditEntry} />
                      ) : (
                        <AccessRun key={run[0]?.id} rows={run} />
                      ),
                    )}
                  </ul>
                </section>
              ))}
            </div>
            {/* Paging replaces "narrow the filters to see more" — which was the
                only route past event 100 of 3,720. */}
            <div className="admin-pagination">
              <Pager
                label="Older events"
                total={total}
                shown={rows.length}
                noun="events"
                firstHref={filters.after !== undefined ? auditHref(filters, null) : null}
                nextHref={nextHref}
                linkComponent={Link}
                nextTestId="admin-audit-next"
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** The current filters, plus a cursor. Every filter survives the page turn. */
function auditHref(filters: AuditFilters, after: string | null): string {
  const params = new URLSearchParams();
  for (const key of ["q", "action", "actor", "scopeId", "from", "to"] as const) {
    const value = filters[key];
    if (value !== undefined && value !== "") {
      params.set(key, value);
    }
  }
  if (after !== null) {
    params.set("after", after);
  }
  const qs = params.toString();
  return qs === "" ? "/admin/audit" : `/admin/audit?${qs}`;
}

const DAY = { format: (at: Date | number): string => formatDayDate(at, true) };

const CLOCK = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Newest first in, newest first out — consecutive rows of one IST day. */
function groupByDay(
  rows: readonly AuditEntry[],
): { key: string; label: string; rows: AuditEntry[] }[] {
  const today = DAY.format(new Date());
  const groups: { key: string; label: string; rows: AuditEntry[] }[] = [];
  for (const row of rows) {
    const label = DAY.format(row.at);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === label) {
      last.rows.push(row);
    } else {
      groups.push({ key: label, label: label === today ? `Today · ${label}` : label, rows: [row] });
    }
  }
  return groups;
}

/**
 * Administration records its own page views, so an operator's browsing sat
 * between every real event as five, ten, twenty "admin.accessed" rows. A run of
 * them by one person folds into ONE row that says so and opens to the list.
 * Nothing is dropped or reordered: the rows are all still here, in order.
 * Filtered to the access log itself, nothing folds — there it IS the record.
 */
function runs(rows: readonly AuditEntry[], fold: boolean): AuditEntry[][] {
  if (!fold) return rows.map((row) => [row]);
  const out: AuditEntry[][] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    const head = last?.[0];
    if (
      last !== undefined &&
      head !== undefined &&
      row.action === ADMIN_ACCESS_ACTION &&
      head.action === ADMIN_ACCESS_ACTION &&
      head.actor === row.actor
    ) {
      last.push(row);
    } else {
      out.push([row]);
    }
  }
  return out;
}

function surfaceOf(row: AuditEntry): string | null {
  const meta = row.meta as { surface?: unknown } | null | undefined;
  return meta !== null && meta !== undefined && typeof meta.surface === "string"
    ? meta.surface
    : null;
}

function AccessRun({ rows }: { rows: readonly AuditEntry[] }) {
  const first = rows[0] as AuditEntry;
  const last = rows[rows.length - 1] as AuditEntry;
  const surfaces = [...new Set(rows.map(surfaceOf).filter((name) => name !== null))];
  return (
    <li className="admin-log-row admin-log-run">
      <time
        className="admin-log-time"
        dateTime={first.at.toISOString()}
        title={`${absoluteIst(last.at)} – ${absoluteIst(first.at)}`}
      >
        <span className="admin-sr-only">{absoluteIst(first.at)}</span>
        <span aria-hidden>{CLOCK.format(first.at)}</span>
      </time>
      <details className="admin-log-main admin-log-runbody">
        <summary>
          <span className="admin-log-line">
            <span className="admin-log-by">
              {actorLabel(first.actor, first.actorName)} viewed {rows.length} administration pages
            </span>
            {surfaces.length > 0 ? (
              <span className="admin-log-keys"> · {surfaces.join(", ")}</span>
            ) : null}
          </span>
        </summary>
        <ul className="admin-log-runlist">
          {rows.map((row) => (
            <AuditRow key={row.id} row={row} />
          ))}
        </ul>
      </details>
      <span className="admin-log-scope">platform</span>
    </li>
  );
}

function AuditRow({ row }: { row: AuditEntry }) {
  const meta = row.meta !== null && row.meta !== undefined ? JSON.stringify(row.meta) : null;
  return (
    <li className="admin-log-row">
      {/* On a forensic surface the absolute moment IS the datum: the clock is
          drawn first, and the full zone-named timestamp is what assistive
          technology hears (and what a hover shows). */}
      <time className="admin-log-time" dateTime={row.at.toISOString()} title={absoluteIst(row.at)}>
        <span className="admin-sr-only">{absoluteIst(row.at)}</span>
        <span aria-hidden>{CLOCK.format(row.at)}</span>
      </time>
      <span className="admin-log-main">
        <span className="admin-log-line">
          <span className="admin-action">{row.action}</span>
          <span className="admin-log-by">
            {" by "}
            {/* A machine-derived row (a lot the timer closed, a sweep the
                coordinator ran) is signed with the zero ULID. It rendered as a
                literal "000000" linked to a /admin/users page that 404s by
                design — a dead link to a person who does not exist. */}
            {isSystemActor(row.actor) ? (
              actorLabel(row.actor, row.actorName)
            ) : (
              <Link href={`/admin/users/${row.actor}`}>{actorLabel(row.actor, row.actorName)}</Link>
            )}
            {row.subject !== null ? (
              <>
                {" on "}
                <span className="admin-log-subject">
                  {row.subjectName ?? row.subject.slice(-6)}
                </span>
              </>
            ) : null}
          </span>
        </span>
        {meta !== null ? (
          <details className="admin-log-meta">
            {/* The evidence is one click away, not a second line on every
                row: the summary names its fields, the panel shows it whole. */}
            <summary title={meta}>
              <span className="admin-sr-only">Evidence: </span>
              <code>{evidenceKeys(row.meta)}</code>
            </summary>
            <pre className="admin-evidence">{JSON.stringify(row.meta, null, 2)}</pre>
          </details>
        ) : null}
      </span>
      <span className="admin-log-scope">
        {row.scopeType}
        {row.scopeLabel !== null ? ` · ${row.scopeLabel}` : ""}
        {/* The platform sentinel is a 26-zero ULID — the noisiest string on
            the page, linking to a filter on a synthetic id. The word
            "platform" already says everything the zeros said. */}
        {/^0+$/.test(row.scopeId) ? null : (
          <Link
            href={`/admin/audit?scopeId=${row.scopeId}`}
            className="admin-log-id"
            title={`Every event in scope ${row.scopeId}`}
          >
            <span className="admin-sr-only">Filter to scope </span>…{row.scopeId.slice(-6)}
          </Link>
        )}
      </span>
    </li>
  );
}

/** "{name, slug, auctionUnit}" — the evidence's shape, for the summary. */
function evidenceKeys(meta: unknown): string {
  if (meta !== null && typeof meta === "object" && !Array.isArray(meta)) {
    const keys = Object.keys(meta);
    return keys.length === 0 ? "{}" : `{${keys.join(", ")}}`;
  }
  return JSON.stringify(meta);
}
