import {
  EmptyState,
  Pager,
  Pill,
  SegmentedTabs,
  Toolbar,
  ToolbarCount,
  ToolbarSearch,
  ToolbarSpacer,
} from "@desiauction/ui";
import Link from "next/link";

import { formatCount, maskPersonContact } from "../../../server/admin/format";
import type { UserDirectory } from "../../../server/admin/views";
import { AdminFilterForm } from "../admin-filter-form";
import { RelativeTime, monogram } from "../admin-ui";
import { userFacts, userFlags } from "../directory-model";
import "../directory.css";

const USER_FILTERS: readonly { key: UserDirectory["filter"]; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "players", label: "Players" },
  { key: "profiled", label: "With a profile" },
];

function filterHref(query: string, filter: UserDirectory["filter"]): string {
  const params = new URLSearchParams();
  if (query !== "") params.set("q", query);
  if (filter !== "all") params.set("filter", filter);
  const qs = params.toString();
  return qs === "" ? "/admin/users" : `/admin/users?${qs}`;
}

/** PX-9 §3 — the user directory. GET-form search, linkable results, no writes. */
export function UsersPanel({
  directory,
  paged = false,
}: {
  directory: UserDirectory;
  /** On a later page (a cursor is set): the pager offers the way back. */
  paged?: boolean;
}) {
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
      <div className="admin-panel">
        <AdminFilterForm testId="admin-user-search">
          <Toolbar>
            <ToolbarSearch
              id="admin-user-q"
              name="q"
              label="Search users"
              placeholder="Name or mobile number"
              defaultValue={query}
              submitLabel="Search"
            />
            {/* PI-1 P6: the profile-aware facet, as the same segmented links
                the organizations directory uses — one filter look across
                administration. URL-driven like every admin filter. */}
            <SegmentedTabs
              label="Show"
              testId="admin-user-filter"
              items={USER_FILTERS.map((option) => ({
                key: option.key,
                label: option.label,
                count: formatCount(directory.counts[option.key]),
                active: option.key === directory.filter,
                href: filterHref(query, option.key),
              }))}
            />
            {directory.filter !== "all" ? (
              <input type="hidden" name="filter" value={directory.filter} />
            ) : null}
            <ToolbarSpacer />
            <ToolbarCount testId="admin-user-count">
              {query === ""
                ? `${formatCount(rows.length)} of ${formatCount(platformTotal)}`
                : `${formatCount(rows.length)} shown · ${formatCount(total)} match · ${formatCount(platformTotal)} total`}
            </ToolbarCount>
          </Toolbar>
        </AdminFilterForm>
        {rows.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              size="compact"
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
              <table className="admin-table is-linked da-rows" data-testid="admin-user-table">
                <thead>
                  <tr>
                    <th scope="col">User</th>
                    <th scope="col">On the platform</th>
                    <th scope="col" className="admin-dir-flags-head">
                      Grants
                    </th>
                    <th scope="col">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const facts = userFacts(row);
                    const flags = userFlags(row);
                    return (
                      <tr key={row.id}>
                        <td data-label="User" data-cell="title">
                          <span className="admin-cell-main admin-person">
                            <span className="admin-monogram" aria-hidden>
                              {monogram(row.name)}
                            </span>
                            <Link href={`/admin/users/${row.id}`} className="admin-name">
                              {row.name ?? "Unnamed"}
                            </Link>
                            {/* A fifty-row directory of full E.164 mobile numbers
                                is a bulk export of the platform's contact list:
                                the last four digits answer "which row is this?",
                                and the whole number is on the one person's page. */}
                            <span className="registration-phone admin-meta" data-private>
                              {maskPersonContact(row)}
                            </span>
                          </span>
                          {/* The phone row's second line: contact, then what the
                              person is — it wraps rather than cut mid-word. */}
                          <span className="da-row-meta">
                            <span data-private>{maskPersonContact(row)}</span> · {facts}
                          </span>
                        </td>
                        {/* One phrase for what the person IS on the platform —
                            two numeric columns of dashes never said it. */}
                        <td data-label="On the platform" className="admin-dir-facts">
                          {facts}
                        </td>
                        <td data-label="Grants" data-cell="status" className="admin-dir-flags">
                          {flags.length === 0 ? (
                            <span className="admin-dash" title="No grants">
                              —<span className="admin-sr-only">No grants</span>
                            </span>
                          ) : (
                            <span className="admin-pills">
                              {flags.map((flag) => (
                                <Pill key={flag.label} tone={flag.tone}>
                                  {flag.label}
                                </Pill>
                              ))}
                            </span>
                          )}
                        </td>
                        {/* The last thing they did; when they joined only when
                            they have done nothing since. */}
                        <td data-label="Last activity" className="is-side" data-cell="figure">
                          {row.lastActivityAt === null ? (
                            <span className="admin-meta">
                              Joined <RelativeTime at={row.createdAt} />
                            </span>
                          ) : (
                            <RelativeTime at={row.lastActivityAt} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="admin-pagination">
              <Pager
                label="More users"
                total={total}
                shown={rows.length}
                noun="users · newest first"
                firstHref={paged ? filterHref(query, directory.filter) : null}
                nextHref={nextHref}
                linkComponent={Link}
                nextTestId="admin-user-next"
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}
