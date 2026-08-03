import { Card, EmptyState } from "@desiauction/ui";
import Link from "next/link";

import { formatCount, maskPhone } from "../../../server/admin/format";
import type { UserDirectory } from "../../../server/admin/views";
import { ReadOnlyNotice, RelativeTime } from "../admin-ui";

/** PX-9 §3 — the user directory. GET-form search, linkable results, no writes. */
export function UsersPanel({ directory }: { directory: UserDirectory }) {
  const { rows, total, platformTotal, query, nextCursor } = directory;
  const nextHref =
    nextCursor === null
      ? null
      : `/admin/users?${new URLSearchParams(
          query === "" ? { after: nextCursor } : { q: query, after: nextCursor },
        ).toString()}`;
  return (
    <>
      <ReadOnlyNotice />
      <Card>
        <form className="admin-filters" method="get" role="search" data-testid="admin-user-search">
          <div className="admin-filter-grow">
            <label className="stat-label" htmlFor="admin-user-q">
              Search users
            </label>
            <input
              id="admin-user-q"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Name or mobile number"
              className="admin-search-input"
            />
          </div>
          <button type="submit" className="admin-search-submit">
            Search
          </button>
        </form>
      </Card>
      <Card>
        <h2 className="admin-section-title">People</h2>
        <p className="admin-meta" data-testid="admin-user-count">
          {query === ""
            ? `${formatCount(rows.length)} shown · ${formatCount(platformTotal)} user${platformTotal === 1 ? "" : "s"} on the platform`
            : `${formatCount(rows.length)} shown · ${formatCount(total)} match · ${formatCount(platformTotal)} on the platform`}
        </p>
        {rows.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No user matches"
            description={
              query === ""
                ? "Nobody has signed up yet."
                : `Nothing matches “${query}”. Try a name or a full mobile number.`
            }
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="reg-table" data-testid="admin-user-table">
                <thead>
                  <tr>
                    <th scope="col">User</th>
                    <th scope="col" className="admin-num">
                      Organizations
                    </th>
                    <th scope="col" className="admin-num">
                      Active grants
                    </th>
                    <th scope="col">Joined</th>
                    <th scope="col">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="reg-row">
                      <td data-label="User">
                        <Link href={`/admin/users/${row.id}`} className="registration-name">
                          {row.name ?? "Unnamed"}
                        </Link>
                        {/* A fifty-row directory of full E.164 mobile numbers
                            is a bulk export of the platform's contact list, and
                            `?q=` put the other 1,098 one page away. The last
                            four digits answer the directory's actual question —
                            "which row is this?" — and the whole number is on
                            the one person's page an operator chose to open. */}
                        <span className="registration-phone admin-meta">
                          {maskPhone(row.phone)}
                        </span>
                      </td>
                      <td data-label="Organizations" className="admin-count admin-num">
                        {formatCount(row.orgs)}
                      </td>
                      <td data-label="Active grants" className="admin-count admin-num">
                        {formatCount(row.activeGrants)}
                      </td>
                      <td data-label="Joined">
                        <RelativeTime at={row.createdAt} />
                      </td>
                      <td data-label="Last activity">
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
            <nav className="admin-pagination" aria-label="More users">
              {nextHref === null ? (
                <span className="admin-meta">End of the list.</span>
              ) : (
                <Link href={nextHref} data-testid="admin-user-next">
                  Next 50 →
                </Link>
              )}
            </nav>
          </>
        )}
      </Card>
    </>
  );
}
