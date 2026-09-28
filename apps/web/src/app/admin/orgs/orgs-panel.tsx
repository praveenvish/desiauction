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
import { RelativeTime } from "../admin-ui";
import { orgFacts, orgFlags } from "../directory-model";
import "../directory.css";

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
                // Each chip says how many it holds under the current search.
                count: formatCount(directory.counts[option.key]),
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
              <table className="admin-table is-linked da-rows" data-testid="admin-org-table">
                <thead>
                  <tr>
                    <th scope="col">Organization</th>
                    <th scope="col">On the platform</th>
                    <th scope="col" className="admin-dir-flags-head">
                      Needs a look
                    </th>
                    <th scope="col">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const facts = orgFacts(row);
                    const flags = orgFlags(row);
                    return (
                      <tr key={row.id}>
                        {/* Five numeric columns read "—" on almost every row: a
                            grid of dashes the one open case hid in. The row now
                            says what the club has done in one phrase, and
                            carries only the flags an operator acts on. */}
                        <td data-label="Organization" data-cell="title">
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
                          <span className="da-row-meta">{facts}</span>
                        </td>
                        <td data-label="On the platform" className="admin-dir-facts">
                          {facts}
                        </td>
                        <td
                          data-label="Needs a look"
                          data-cell="status"
                          className="admin-dir-flags"
                        >
                          {flags.length === 0 ? (
                            <span className="admin-dash" title="Nothing to look at">
                              —<span className="admin-sr-only">Nothing to look at</span>
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
            {/* There was no pagination anywhere: 50 of 349 organizations, and
                the other 299 were unreachable by browsing OR by any filter. A
                LINK, not a button: administration submits nothing. */}
            <div className="admin-pagination">
              <Pager
                label="More organizations"
                total={total}
                shown={rows.length}
                noun="organizations · newest first"
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
