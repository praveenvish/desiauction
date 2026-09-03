import { Card, EmptyState } from "@desiauction/ui";
import Link from "next/link";

import { actorLabel, formatCount, isSystemActor } from "../../../server/admin/format";
import type { AuditEntry, AuditFilters, AuditPage } from "../../../server/admin/views";
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
  const { rows, actions, total, filters, nextCursor } = page;
  const nextHref = nextCursor === null ? null : auditHref(filters, nextCursor);
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
        {/* A hundred audit entries under zero headings: the page had one h1 and
            nothing else, so nothing named what the list was. */}
        <h2 className="admin-section-title">Events</h2>
        <p className="admin-meta" data-testid="admin-audit-count">
          {formatCount(rows.length)} shown · {formatCount(total)} matching event
          {total === 1 ? "" : "s"} · times are IST
        </p>
        {rows.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No matching events"
            description="Nothing in the audit log matches these filters."
          />
        ) : (
          <>
            <ul className="admin-timeline" data-testid="admin-audit-list">
              {rows.map((row) => (
                <AuditRow key={row.id} row={row} />
              ))}
            </ul>
            {/* Paging replaces "narrow the filters to see more" — which was the
                only route past event 100 of 3,720. */}
            <nav className="admin-pagination" aria-label="Older events">
              {nextHref === null ? (
                <span className="admin-meta">End of the matching events.</span>
              ) : (
                <Link href={nextHref} data-testid="admin-audit-next">
                  Older 100 →
                </Link>
              )}
            </nav>
          </>
        )}
      </Card>
    </>
  );
}

/** The current filters, plus a cursor. Every filter survives the page turn. */
function auditHref(filters: AuditFilters, after: string): string {
  const params = new URLSearchParams();
  for (const key of ["q", "action", "actor", "scopeId", "from", "to"] as const) {
    const value = filters[key];
    if (value !== undefined && value !== "") {
      params.set(key, value);
    }
  }
  params.set("after", after);
  return `/admin/audit?${params.toString()}`;
}

function AuditRow({ row }: { row: AuditEntry }) {
  return (
    <li>
      <span className="admin-attention-subject">
        <span>
          <span className="admin-action">{row.action}</span>
          <span className="admin-meta">
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
                {row.subjectName ?? row.subject.slice(-6)}
              </>
            ) : null}
          </span>
        </span>
        <span className="admin-attention-kind">
          {row.scopeType}
          {row.scopeLabel !== null ? ` · ${row.scopeLabel}` : ""}
          {/* The platform sentinel is a 26-zero ULID — the noisiest string on
              the page, linking to a filter on a synthetic id. The word
              "platform" above already says everything the zeros said. */}
          {/^0+$/.test(row.scopeId) ? null : (
            <>
              {" · "}
              <Link href={`/admin/audit?scopeId=${row.scopeId}`}>{row.scopeId}</Link>
            </>
          )}
        </span>
        {row.meta !== null && row.meta !== undefined ? (
          <pre className="admin-evidence">{JSON.stringify(row.meta)}</pre>
        ) : null}
      </span>
      {/* On a forensic surface the absolute moment IS the datum, so it is drawn
          rather than hidden in a `title` only a mouse can reach. */}
      <RelativeTime at={row.at} absolute />
    </li>
  );
}
