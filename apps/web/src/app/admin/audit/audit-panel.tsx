import { Card, EmptyState } from "@desiauction/ui";
import Link from "next/link";

import type { AuditEntry, AuditPage } from "../../../server/admin/views";
import { ReadOnlyNotice, RelativeTime } from "../admin-ui";

/**
 * PX-9 §4 — the audit viewer.
 *
 * Evidence is rendered verbatim. The `meta` column is whatever the writing
 * domain put there (a capability set, an event seq, a digest); administration
 * does not interpret it, summarise it or grade it — an audit viewer that
 * paraphrased its evidence would be worthless in the moment it matters.
 */
export function AuditPanel({ page }: { page: AuditPage }) {
  const { rows, actions, total, filters, truncated } = page;
  return (
    <>
      <ReadOnlyNotice />
      <Card>
        <form className="admin-filters" method="get" role="search" data-testid="admin-audit-search">
          <div className="admin-filter-grow">
            <label className="stat-label" htmlFor="admin-audit-q">
              Search
            </label>
            <input
              id="admin-audit-q"
              name="q"
              type="search"
              defaultValue={filters.q ?? ""}
              placeholder="Actor, scope, subject or action"
              className="admin-search-input"
            />
          </div>
          <div>
            <label className="stat-label" htmlFor="admin-audit-action">
              Action
            </label>
            <select
              id="admin-audit-action"
              name="action"
              defaultValue={filters.action ?? ""}
              className="admin-search-input"
            >
              <option value="">All actions</option>
              {actions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="stat-label" htmlFor="admin-audit-from">
              From
            </label>
            <input
              id="admin-audit-from"
              name="from"
              type="date"
              defaultValue={filters.from ?? ""}
              className="admin-search-input"
            />
          </div>
          <div>
            <label className="stat-label" htmlFor="admin-audit-to">
              To
            </label>
            <input
              id="admin-audit-to"
              name="to"
              type="date"
              defaultValue={filters.to ?? ""}
              className="admin-search-input"
            />
          </div>
          {/* Deep links carry actor/scope; keep them across a filter submit. */}
          {filters.actor !== undefined ? (
            <input type="hidden" name="actor" value={filters.actor} />
          ) : null}
          {filters.scopeId !== undefined ? (
            <input type="hidden" name="scopeId" value={filters.scopeId} />
          ) : null}
          <button type="submit" className="admin-search-submit">
            Filter
          </button>
        </form>
      </Card>

      <Card>
        <p className="admin-meta" data-testid="admin-audit-count">
          {rows.length} shown · {total} matching event{total === 1 ? "" : "s"}
          {truncated ? " · showing the newest 100 — narrow the filters to see more" : ""}
        </p>
        {rows.length === 0 ? (
          <EmptyState
            headingLevel={2}
            title="No matching events"
            description="Nothing in the audit log matches these filters."
          />
        ) : (
          <ul className="admin-timeline" data-testid="admin-audit-list">
            {rows.map((row) => (
              <AuditRow key={row.id} row={row} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function AuditRow({ row }: { row: AuditEntry }) {
  return (
    <li>
      <span className="admin-attention-subject">
        <span>
          <span className="admin-action">{row.action}</span>
          <span className="admin-meta">
            {" by "}
            <Link href={`/admin/users/${row.actor}`}>{row.actorName ?? row.actor.slice(-6)}</Link>
            {row.subject !== null ? (
              <>
                {" on "}
                {row.subjectName ?? row.subject.slice(-6)}
              </>
            ) : null}
          </span>
        </span>
        <span className="admin-attention-kind">
          {row.scopeType}
          {row.scopeLabel !== null ? ` · ${row.scopeLabel}` : ""} ·{" "}
          <Link href={`/admin/audit?scopeId=${row.scopeId}`}>{row.scopeId}</Link>
        </span>
        {row.meta !== null && row.meta !== undefined ? (
          <pre className="admin-evidence">{JSON.stringify(row.meta)}</pre>
        ) : null}
      </span>
      <RelativeTime at={row.at} />
    </li>
  );
}
