import { Card, EmptyState } from "@desiauction/ui";
import Link from "next/link";

import type { UserDirectory } from "../../../server/admin/views";
import { ReadOnlyNotice, RelativeTime } from "../admin-ui";

/** PX-9 §3 — the user directory. GET-form search, linkable results, no writes. */
export function UsersPanel({ directory }: { directory: UserDirectory }) {
  const { rows, total, query } = directory;
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
        <p className="admin-meta" data-testid="admin-user-count">
          {rows.length} shown · {total} user{total === 1 ? "" : "s"} on the platform
        </p>
        {rows.length === 0 ? (
          <EmptyState
            headingLevel={2}
            title="No user matches"
            description={
              query === ""
                ? "Nobody has signed up yet."
                : `Nothing matches “${query}”. Try a name or a full mobile number.`
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="reg-table" data-testid="admin-user-table">
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Organizations</th>
                  <th scope="col">Active grants</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="reg-row">
                    <td>
                      <Link href={`/admin/users/${row.id}`} className="registration-name">
                        {row.name ?? "Unnamed"}
                      </Link>
                      <span className="registration-phone admin-meta">{row.phone}</span>
                    </td>
                    <td className="admin-count">{row.orgs}</td>
                    <td className="admin-count">{row.activeGrants}</td>
                    <td>
                      <RelativeTime at={row.createdAt} />
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
