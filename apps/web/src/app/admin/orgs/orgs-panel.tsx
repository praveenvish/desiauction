import {
  EmptyState,
  IconArrowRight,
  IconLayers,
  IconSearch,
  Pill,
  SectionCard,
} from "@desiauction/ui";
import Link from "next/link";

import { formatCount } from "../../../server/admin/format";
import type { OrgDirectory, OrgFilter } from "../../../server/admin/views";
import { ReadOnlyNotice, RelativeTime } from "../admin-ui";

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

export function OrgsPanel({ directory }: { directory: OrgDirectory }) {
  const { rows, total, platformTotal, filter, query, nextCursor } = directory;
  const narrowed = query !== "" || filter !== "all";
  const nextHref = nextCursor === null ? null : pageHref({ query, filter, after: nextCursor });
  return (
    <>
      <ReadOnlyNotice />
      <SectionCard
        icon={<IconLayers />}
        title="Organizations"
        // One sentence, one meaning. It used to read "1 shown · 1 organization
        // on the platform" for a search that matched one of 349, because
        // `total` was the match count with a query and the UNFILTERED count
        // with a filter. Match count and platform count are now separate
        // numbers and are never spelled the same way.
        description={
          <span data-testid="admin-org-count">
            {narrowed
              ? `${formatCount(rows.length)} shown · ${formatCount(total)} match · ${formatCount(platformTotal)} on the platform`
              : `${formatCount(rows.length)} shown · ${formatCount(platformTotal)} organization${platformTotal === 1 ? "" : "s"} on the platform`}
          </span>
        }
        flush
      >
        <form className="admin-filters" method="get" role="search" data-testid="admin-org-search">
          <label className="admin-search" htmlFor="admin-org-q">
            <span className="admin-sr-only">Search organizations, seasons and tournaments</span>
            <IconSearch size={18} aria-hidden />
            <input
              id="admin-org-q"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Club, season or tournament"
              className="admin-search-input"
            />
          </label>
          <span className="admin-field">
            <label className="admin-field-label" htmlFor="admin-org-filter">
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
          </span>
          <button type="submit" className="admin-search-submit">
            Search
          </button>
        </form>
        {rows.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
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
              <table className="admin-table" data-testid="admin-org-table">
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
                        <span className="admin-cell-main">
                          <Link href={`/admin/orgs/${row.slug}`} className="admin-name">
                            {row.name}
                          </Link>
                          <span className="admin-id">{row.slug}</span>
                          {row.matchedSeason !== null ? (
                            <span className="admin-match" data-testid="admin-org-matched-season">
                              Matched: {row.matchedSeason}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td data-label="Seasons" className="admin-count admin-num">
                        {formatCount(row.competitions)}
                      </td>
                      <td data-label="Members" className="admin-count admin-num">
                        {formatCount(row.members)}
                      </td>
                      <td data-label="Auctions" className="admin-count admin-num">
                        {formatCount(row.auctions)}
                      </td>
                      <td data-label="Cases">
                        {/* `settled` is counted as unfinished — it can still be
                            closed — but it is not "open", and an amber pill on
                            a case that settled correctly reads as a problem
                            that is not there. */}
                        <span className="admin-pills">
                          <span className="admin-count">{formatCount(row.cases)}</span>
                          {row.openCases > 0 ? (
                            <Pill tone="amber" dot>
                              {row.openCases} open
                            </Pill>
                          ) : null}
                          {row.settledCases > 0 ? (
                            <Pill tone="green">{row.settledCases} settled</Pill>
                          ) : null}
                        </span>
                      </td>
                      <td data-label="Finance">
                        {row.financeDeclared ? (
                          <Pill tone="blue">Declared</Pill>
                        ) : (
                          <span className="admin-dash">Not declared</span>
                        )}
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
            {/* There was no pagination anywhere: 50 of 349 organizations, and
                the other 299 were unreachable by browsing OR by any filter. A
                LINK, not a button: administration submits nothing. */}
            <nav className="admin-pagination" aria-label="More organizations">
              {nextHref === null ? (
                <span className="admin-meta">End of the list.</span>
              ) : (
                <Link href={nextHref} data-testid="admin-org-next">
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
