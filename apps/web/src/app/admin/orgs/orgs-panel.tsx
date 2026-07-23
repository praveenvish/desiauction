import { Badge, Card, EmptyState } from "@desiauction/ui";
import Link from "next/link";

import type { OrgDirectory } from "../../../server/admin/views";
import { ReadOnlyNotice, RelativeTime } from "../admin-ui";

/**
 * PX-9 §2 — the organization directory.
 *
 * Search and filter are a plain GET form: the query lives in the URL, so a
 * result set is linkable and survives a reload — the thing an operator wants
 * when handing a finding to someone else. It also means the directory works
 * with no client JavaScript at all, and the platform's org list never ships to
 * the browser to be filtered there.
 */
const FILTER_LABELS: readonly { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "finance", label: "Finance declared" },
  { key: "settling", label: "Open cases" },
  { key: "quiet", label: "No seasons" },
];

export function OrgsPanel({ directory }: { directory: OrgDirectory }) {
  const { rows, total, filter, query } = directory;
  return (
    <>
      <ReadOnlyNotice />
      <Card>
        <form className="admin-filters" method="get" role="search" data-testid="admin-org-search">
          <div className="admin-filter-grow">
            <label className="stat-label" htmlFor="admin-org-q">
              Search organizations
            </label>
            <input
              id="admin-org-q"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Name or slug"
              className="admin-search-input"
            />
          </div>
          <div>
            <label className="stat-label" htmlFor="admin-org-filter">
              Filter
            </label>
            <select
              id="admin-org-filter"
              name="filter"
              defaultValue={filter}
              className="admin-search-input"
            >
              {FILTER_LABELS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="admin-search-submit">
            Search
          </button>
        </form>
      </Card>

      <Card>
        <p className="admin-meta" data-testid="admin-org-count">
          {rows.length} shown · {total} organization{total === 1 ? "" : "s"} on the platform
        </p>
        {rows.length === 0 ? (
          <EmptyState
            // The page heading is h1 and this Card carries no h2 of its own, so
            // the empty state IS the section heading (axe heading-order).
            headingLevel={2}
            title="No organization matches"
            description={
              query === ""
                ? "This filter has no organizations yet."
                : `Nothing matches “${query}”. Try a different name or slug.`
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="reg-table" data-testid="admin-org-table">
              <thead>
                <tr>
                  <th scope="col">Organization</th>
                  <th scope="col">Seasons</th>
                  <th scope="col">Members</th>
                  <th scope="col">Auctions</th>
                  <th scope="col">Cases</th>
                  <th scope="col">Finance</th>
                  <th scope="col">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="reg-row">
                    <td>
                      <Link href={`/admin/orgs/${row.slug}`} className="registration-name">
                        {row.name}
                      </Link>
                      <span className="admin-id">{row.slug}</span>
                    </td>
                    <td className="admin-count">{row.competitions}</td>
                    <td className="admin-count">{row.members}</td>
                    <td className="admin-count">{row.auctions}</td>
                    <td>
                      <span className="admin-count">{row.cases}</span>
                      {row.openCases > 0 ? (
                        <>
                          {" "}
                          <Badge tone="warning">{row.openCases} open</Badge>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {row.financeDeclared ? (
                        <Badge tone="info">Declared</Badge>
                      ) : (
                        <span className="admin-meta">—</span>
                      )}
                    </td>
                    <td>
                      {row.lastActivityAt === null ? (
                        <span className="admin-meta">Never</span>
                      ) : (
                        <RelativeTime at={row.lastActivityAt} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
