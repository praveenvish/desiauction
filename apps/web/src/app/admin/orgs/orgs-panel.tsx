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

import { formatCount } from "../../../server/admin/format";
import type { OrgDirectory, OrgFilter } from "../../../server/admin/views";
import { AdminFilterForm } from "../admin-filter-form";
import { RelativeTime, TableCount } from "../admin-ui";

/**
 * PX-9 §2 — the organization directory.
 *
 * Search and filter are a plain GET form: the query lives in the URL, so a
 * result set is linkable and survives a reload — the thing an operator wants
 * when handing a finding to someone else. It also means the directory works
 * with no client JavaScript at all, and the platform's org list never ships to
 * the browser to be filtered there.
 *
 * The filters and the paging are the DATABASE's, not this file's: see
 * `organizationDirectory`. Everything below renders what it was handed.
 */
const FILTER_LABELS: readonly { key: OrgFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "finance", label: "Finance declared" },
  // Not "Open cases": a case that is `settled` but not `closed` is still a case
  // the platform has not finished with, and it is included here. See the badge.
  { key: "settling", label: "Cases not yet closed" },
  { key: "quiet", label: "No seasons" },
];

function filterLabel(filter: OrgFilter): string {
  return FILTER_LABELS.find((option) => option.key === filter)?.label ?? "All";
}

export function OrgsPanel({
  directory,
  paged = false,
}: {
  directory: OrgDirectory;
  /** On a later page (a cursor is set): the pager offers the way back. */
  paged?: boolean;
}) {
  const { rows, total, platformTotal, filter, query, nextCursor } = directory;
  const narrowed = query !== "" || filter !== "all";
  const nextHref = nextCursor === null ? null : pageHref({ query, filter, after: nextCursor });
  return (
    <>
      <div className="admin-panel">
        <AdminFilterForm testId="admin-org-search">
          <Toolbar>
            <ToolbarSearch
              id="admin-org-q"
              name="q"
              label="Search organizations, seasons and tournaments"
              placeholder="Club, season or tournament"
              defaultValue={query}
              submitLabel="Search"
            />
            {/* The four views as one segmented control — each is the filter it
                names, and a link, so the choice is in the URL like before. */}
            <SegmentedTabs
              label="Organization filter"
              items={FILTER_LABELS.map((option) => ({
                key: option.key,
                label: option.label,
                active: option.key === filter,
                href: filterHref(query, option.key),
              }))}
            />
            {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
            <ToolbarSpacer />
            {/* One sentence, one meaning. It used to read "1 shown · 1
                organization on the platform" for a search that matched one of
                349. Match count and platform count are separate numbers and
                are never spelled the same way. */}
            <ToolbarCount testId="admin-org-count">
              {narrowed
                ? `${formatCount(rows.length)} shown · ${formatCount(total)} match · ${formatCount(platformTotal)} total`
                : `${formatCount(rows.length)} of ${formatCount(platformTotal)}`}
            </ToolbarCount>
          </Toolbar>
        </AdminFilterForm>
        {rows.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              size="compact"
              headingLevel={3}
              title="No organization matches"
              description={
                // The old copy asserted "This filter has no organizations yet."
                // on a filter that had only ever looked at the newest fifty rows.
                // These sentences are now the database's answer over everything.
                query === ""
                  ? `No organization matches “${filterLabel(filter)}”. ${formatCount(platformTotal)} exist on the platform.`
                  : `Nothing matches “${query}”. Try a different name or slug.`
              }
            />
          </div>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table is-linked" data-testid="admin-org-table">
                <thead>
                  <tr>
                    <th scope="col">Organization</th>
                    <th scope="col" className="admin-num">
                      Seasons
                    </th>
                    <th scope="col" className="admin-num">
                      Members
                    </th>
                    <th scope="col" className="admin-num">
                      Auctions
                    </th>
                    <th scope="col">Cases</th>
                    <th scope="col">Finance</th>
                    <th scope="col">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      {/* On a phone each row is a card and the header strip is
                          hidden; `data-label` names every figure in its place,
                          so Seasons, Members and Cases never read as three
                          unlabelled numbers. */}
                      <td data-label="Organization">
                        <span className="admin-cell-main is-inline">
                          <Link href={`/admin/orgs/${row.slug}`} className="admin-name">
                            {row.name}
                          </Link>
                          <span className="admin-id admin-slug">{row.slug}</span>
                          {row.matchedSeason !== null ? (
                            <span className="admin-match" data-testid="admin-org-matched-season">
                              Matched: {row.matchedSeason}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td
                        data-label="Seasons"
                        className="admin-count admin-num"
                        data-zero={row.competitions === 0 || undefined}
                      >
                        <TableCount n={row.competitions} />
                      </td>
                      <td
                        data-label="Members"
                        className="admin-count admin-num"
                        data-zero={row.members === 0 || undefined}
                      >
                        <TableCount n={row.members} />
                      </td>
                      <td
                        data-label="Auctions"
                        className="admin-count admin-num"
                        data-zero={row.auctions === 0 || undefined}
                      >
                        <TableCount n={row.auctions} />
                      </td>
                      <td data-label="Cases" data-empty={row.cases === 0 || undefined}>
                        {/* `settled` is counted as unfinished — it can still be
                            closed — but it is not "open", and an amber pill on
                            a case that settled correctly reads as a problem
                            that is not there. */}
                        <span className="admin-pills">
                          {/* One figure, not "1" beside "● 1 open": the total
                              only when it says more than its parts. */}
                          {row.cases === 0 ? (
                            <TableCount n={0} />
                          ) : row.cases > row.openCases + row.settledCases ? (
                            <span className="admin-count">{formatCount(row.cases)}</span>
                          ) : null}
                          {row.openCases > 0 ? (
                            <Pill tone="amber" dot>
                              {row.openCases} open
                            </Pill>
                          ) : null}
                          {row.settledCases > 0 ? (
                            <Pill tone="neutral">{row.settledCases} settled</Pill>
                          ) : null}
                        </span>
                      </td>
                      <td data-label="Finance" data-empty={!row.financeDeclared || undefined}>
                        {/* "Not declared" 49 times down a column drowned the one
                            org that had. The dash is named for assistive tech. */}
                        {row.financeDeclared ? (
                          <span className="admin-state" data-tone="green">
                            <span className="admin-state-dot" aria-hidden />
                            Declared
                          </span>
                        ) : (
                          <span className="admin-dash" title="Not declared">
                            —<span className="admin-sr-only">Not declared</span>
                          </span>
                        )}
                      </td>
                      <td data-label="Last activity" className="is-side">
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
            {/* There was no pagination anywhere: 50 of 349 organizations, and
                the other 299 were unreachable by browsing OR by any filter. A
                LINK, not a button: administration submits nothing. */}
            <div className="admin-pagination">
              <Pager
                label="More organizations"
                total={total}
                shown={rows.length}
                noun="organizations"
                firstHref={paged ? filterHref(query, filter) : null}
                nextHref={nextHref}
                linkComponent={Link}
                nextTestId="admin-org-next"
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}

function filterHref(query: string, filter: OrgFilter): string {
  const params = new URLSearchParams();
  if (query !== "") {
    params.set("q", query);
  }
  if (filter !== "all") {
    params.set("filter", filter);
  }
  const qs = params.toString();
  return qs === "" ? "/admin/orgs" : `/admin/orgs?${qs}`;
}

function pageHref({
  query,
  filter,
  after,
}: {
  query: string;
  filter: OrgFilter;
  after: string;
}): string {
  const params = new URLSearchParams();
  if (query !== "") {
    params.set("q", query);
  }
  if (filter !== "all") {
    params.set("filter", filter);
  }
  params.set("after", after);
  return `/admin/orgs?${params.toString()}`;
}
