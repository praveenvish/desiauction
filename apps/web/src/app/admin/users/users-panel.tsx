import { EmptyState, IconArrowRight, IconSearch, IconUsers, SectionCard } from "@desiauction/ui";
import Link from "next/link";

import { formatCount, maskPersonContact } from "../../../server/admin/format";
import type { UserDirectory } from "../../../server/admin/views";
import { ReadOnlyNotice, RelativeTime } from "../admin-ui";

/** PX-9 §3 — the user directory. GET-form search, linkable results, no writes. */
export function UsersPanel({ directory }: { directory: UserDirectory }) {
  const { rows, total, platformTotal, query, nextCursor } = directory;
  const nextHref =
    nextCursor === null
      ? null
      : `/admin/users?${new URLSearchParams({
          ...(query === "" ? {} : { q: query }),
          // PI-1 P6: the facet must survive the page turn or "Next 50" resets it.
          ...(directory.filter === "all" ? {} : { filter: directory.filter }),
          after: nextCursor,
        }).toString()}`;
  return (
    <>
      <ReadOnlyNotice />
      <SectionCard
        icon={<IconUsers />}
        tone="blue"
        title="People"
        description={
          <span data-testid="admin-user-count">
            {query === ""
              ? `${formatCount(rows.length)} shown · ${formatCount(platformTotal)} user${platformTotal === 1 ? "" : "s"} on the platform`
              : `${formatCount(rows.length)} shown · ${formatCount(total)} match · ${formatCount(platformTotal)} on the platform`}
          </span>
        }
        flush
      >
        <form className="admin-filters" method="get" role="search" data-testid="admin-user-search">
          <label className="admin-search" htmlFor="admin-user-q">
            <span className="admin-sr-only">Search users</span>
            <IconSearch size={18} aria-hidden />
            <input
              id="admin-user-q"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Name or mobile number"
              className="admin-search-input"
            />
          </label>
          {/* PI-1 P6: profile-aware facet. URL-driven like every admin filter. */}
          <span className="admin-field">
            <label className="admin-field-label" htmlFor="admin-user-filter">
              Show
            </label>
            <select
              id="admin-user-filter"
              name="filter"
              defaultValue={directory.filter}
              className="admin-search-input"
              data-testid="admin-user-filter"
            >
              <option value="all">Everyone</option>
              <option value="players">Players (has a registration)</option>
              <option value="profiled">With a cricket profile</option>
            </select>
          </span>
          <button type="submit" className="admin-search-submit">
            Search
          </button>
        </form>
        {rows.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              headingLevel={3}
              title="No user matches"
              description={
                query === ""
                  ? "Nobody has signed up yet."
                  : `Nothing matches “${query}”. Try a name or a full mobile number.`
              }
            />
          </div>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table" data-testid="admin-user-table">
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
                    <tr key={row.id}>
                      <td data-label="User">
                        <span className="admin-cell-main">
                          <Link href={`/admin/users/${row.id}`} className="admin-name">
                            {row.name ?? "Unnamed"}
                          </Link>
                          {/* A fifty-row directory of full E.164 mobile numbers
                              is a bulk export of the platform's contact list,
                              and `?q=` put the other 1,098 one page away. The
                              last four digits answer the directory's actual
                              question — "which row is this?" — and the whole
                              number is on the one person's page an operator
                              chose to open. Masked in a screenshot too. */}
                          <span className="registration-phone admin-meta" data-private>
                            {maskPersonContact(row)}
                          </span>
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
                  Next 50
                  <IconArrowRight size={16} className="icon-trail" />
                </Link>
              )}
            </nav>
          </>
        )}
      </SectionCard>
    </>
  );
}
