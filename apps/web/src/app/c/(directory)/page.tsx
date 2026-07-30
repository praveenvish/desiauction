import { Badge, Button, ButtonLink, Card, EmptyState, Field } from "@desiauction/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { env } from "../../../env";
import {
  parseDirectoryFilter,
  parseDirectorySort,
  publicCompetitionsDirectory,
  type DirectoryEntry,
  type DirectoryFilter,
  type DirectorySort,
} from "../../../server/competition/public";
import { IconArrowRight, IconCalendar, IconMapPin } from "../../../components/marketing/icons";
import { formatDateRange } from "../format";
import { DIRECTORY_DESCRIPTION, DIRECTORY_KICKER } from "./copy";
import { SortSelect } from "./sort-select";
import "../../marketing.css";
import "../directory.css";

interface DirectorySearchParams {
  q?: string;
  page?: string;
  filter?: string;
  sort?: string;
}

/**
 * The title used to be a constant, so `/c?q=night` announced the same
 * "Tournaments · DesiAuction" as the unfiltered directory — a screen reader
 * user who searched got no confirmation from the page title, and a browser
 * with ten open tabs showed ten identical ones. Searched and filtered views
 * also carry `robots: noindex` and canonical `/c`: they are slices of one
 * page, not pages of their own.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<DirectorySearchParams>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const term = sp.q?.trim() ?? "";
  const filter = parseDirectoryFilter(sp.filter);
  const facet = filter === "open" ? "Registration open" : filter === "live" ? "Live now" : "";
  const slice = [term === "" ? "" : `“${term}”`, facet].filter((part) => part !== "").join(" · ");
  const isSlice = slice !== "";
  return {
    title: isSlice ? `${slice} · Tournaments · DesiAuction` : "Tournaments · DesiAuction",
    description: DIRECTORY_DESCRIPTION,
    alternates: { canonical: `${env.PUBLIC_BASE_URL}/c` },
    ...(isSlice ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title: "Tournaments on DesiAuction",
      description: "Find a public tournament, watch the auction live, or register as a player.",
      url: `${env.PUBLIC_BASE_URL}/c`,
      type: "website",
    },
  };
}

/** Monogram for the crest fallback: first letters of the first two words. */
function monogram(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** Every directory link is one URL builder, so `q`, the facet, the sort and the
 *  page survive each other. Defaults are omitted rather than spelled out — a
 *  shared link should be the shortest URL that reproduces the view. */
function directoryHref(params: {
  q?: string;
  filter?: DirectoryFilter;
  sort?: DirectorySort;
  page?: number;
}): string {
  const search = new URLSearchParams();
  if (params.q !== undefined && params.q !== "") {
    search.set("q", params.q);
  }
  if (params.filter !== undefined && params.filter !== "all") {
    search.set("filter", params.filter);
  }
  if (params.sort !== undefined && params.sort !== "opportunity") {
    search.set("sort", params.sort);
  }
  if (params.page !== undefined && params.page > 1) {
    search.set("page", String(params.page));
  }
  const query = search.toString();
  return query === "" ? "/c" : `/c?${query}`;
}

/**
 * What one click on this card does, said on the card. The whole card is a
 * single link — exactly one tab stop per result — so the destination and the
 * label are chosen together rather than nesting a second link inside the first
 * (invalid HTML, and a keyboard user paying twice per row).
 *
 * A live auction is the exception that earns the direct route: watching needs
 * no account, so the card goes straight to the spectate stage instead of via
 * the competition page that carries the same door one click further down.
 */
function cardAction(entry: DirectoryEntry): { href: string; label: string; note: string | null } {
  if (entry.live) {
    return {
      href: `/seasons/${entry.slug}/auction/spectate`,
      label: "Watch live",
      note: "No account needed",
    };
  }
  return {
    href: `/c/${entry.slug}`,
    label: entry.open ? "Register" : "View tournament",
    note: null,
  };
}

// PX-5 public discovery: only tournaments their organizers PUBLISHED
// (visibility='public') appear here. Search, facet, sort and pagination are all
// URL-backed — every view a visitor can reach is a view they can send someone.
export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<DirectorySearchParams>;
}) {
  const sp = await searchParams;
  const pageNum = Number.parseInt(sp.page ?? "1", 10);
  const term = sp.q?.trim() ?? "";
  const filter = parseDirectoryFilter(sp.filter);
  const sort = parseDirectorySort(sp.sort);
  const directory = await publicCompetitionsDirectory({
    ...(sp.q !== undefined ? { q: sp.q } : {}),
    page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
    filter,
    sort,
  });
  const facetLabel = filter === "open" ? "Registration open" : filter === "live" ? "Live now" : "";
  const noun = directory.total === 1 ? "tournament" : "tournaments";
  // The verb has to agree with the noun, or a one-result facet reads "There are
  // 1 tournament" — reachable today via /c?filter=live&page=5.
  const verb = directory.total === 1 ? "is" : "are";
  const countLabel = [
    `Showing ${String(directory.entries.length)} of ${String(directory.total)} ${noun}`,
    term === "" ? "" : `for “${term}”`,
    facetLabel === "" ? "" : `· ${facetLabel}`,
  ]
    .filter((part) => part !== "")
    .join(" ");
  // `/c?page=5` used to return 200 with "No public tournaments yet" — a factual
  // lie about a directory holding six, and a dead end, because the pagination
  // block is skipped whenever totalPages is 1 so there was nothing to click.
  const outOfRange = directory.total > 0 && directory.entries.length === 0 && directory.page > 1;
  // Two different nothings, and they need two different ways out: the SEARCH
  // found nothing (drop the search), or the search found rows and the FACET
  // emptied them (drop the facet). Telling someone their search matched nothing
  // when it matched three is the same lie `?page=5` used to tell.
  const searchEmpty = term !== "" && directory.counts.all === 0;
  const clearSearchHref = directoryHref({ filter, sort });
  const clearFilterHref = directoryHref({ q: term, sort });
  const facets: { key: DirectoryFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: directory.counts.all },
    { key: "open", label: "Registration open", count: directory.counts.open },
    { key: "live", label: "Live now", count: directory.counts.live },
  ];
  return (
    <main className="public-page mk">
      {/* The floodlight head. `/c` sat on the daylight surface between a dark
          header and a dark footer — the one pale slab in an otherwise dark
          public journey — and on that surface `--text-accent` resolves to a
          muddy #865D12 instead of brand gold. Reusing the competition page's
          own `.public-hero` fixes the seam and the accent in one move. */}
      <header className="public-hero public-head" data-theme="floodlight">
        <div className="mk-container public-hero-inner">
          <p className="mk-kicker">{DIRECTORY_KICKER}</p>
          <h1>Tournaments</h1>
          <p className="public-sub">{DIRECTORY_DESCRIPTION}</p>
          <form className="public-controls" action="/c" method="get">
            <div className="public-search">
              <Field
                label="Search"
                name="q"
                defaultValue={sp.q ?? ""}
                placeholder="Tournament, club or city"
              />
              <Button type="submit">Search</Button>
              {term === "" ? null : (
                <ButtonLink
                  variant="secondary"
                  href={clearSearchHref}
                  data-testid="directory-clear"
                >
                  Clear
                </ButtonLink>
              )}
            </div>
            {/* The facet rides along as a hidden input so searching inside a
                facet keeps it, and the chips carry `q` so switching facet keeps
                the search. Either one alone would silently drop the other. */}
            {filter === "all" ? null : <input type="hidden" name="filter" value={filter} />}
            <div className="public-facets">
              <div
                className="showcase-filters public-filters"
                role="group"
                aria-label="Filter tournaments"
                data-testid="directory-filters"
              >
                {facets.map((entry) => (
                  <Link
                    key={entry.key}
                    className="showcase-filter"
                    href={directoryHref({ q: term, filter: entry.key, sort })}
                    data-active={entry.key === filter}
                    aria-current={entry.key === filter ? "true" : undefined}
                  >
                    {entry.label}
                    <span className="showcase-filter-count">{entry.count}</span>
                  </Link>
                ))}
              </div>
              <SortSelect value={sort} />
            </div>
          </form>
        </div>
      </header>
      <div className="public-body">
        <div className="mk-container">
          {directory.entries.length === 0 ? (
            <Card>
              {outOfRange ? (
                <EmptyState
                  aria-live="polite"
                  headingLevel={2}
                  title="That page doesn't exist"
                  description={
                    directory.totalPages === 1
                      ? `There ${verb} ${String(directory.total)} ${noun}, all on page 1.`
                      : `There ${verb} ${String(directory.total)} ${noun}, across ${String(directory.totalPages)} pages.`
                  }
                  action={
                    <ButtonLink href={directoryHref({ q: term, filter, sort })}>
                      Back to page 1
                    </ButtonLink>
                  }
                />
              ) : searchEmpty ? (
                <EmptyState
                  aria-live="polite"
                  headingLevel={2}
                  title={`No tournaments match “${term}”`}
                  description={`Try a shorter search, or clear it to see all ${String(directory.catalogue)} tournaments. Organizers can also keep a tournament unlisted — if someone sent you a direct link, that link still works.`}
                  action={
                    <span className="public-empty-actions">
                      <ButtonLink variant="secondary" href={clearSearchHref}>
                        Clear search
                      </ButtonLink>
                      <ButtonLink href="/c">Browse all tournaments</ButtonLink>
                    </span>
                  }
                />
              ) : filter !== "all" ? (
                <EmptyState
                  aria-live="polite"
                  headingLevel={2}
                  title={
                    filter === "live"
                      ? "No auction is live right now"
                      : "No tournament is taking registrations right now"
                  }
                  description={
                    term !== ""
                      ? `“${term}” matches ${String(directory.counts.all)} ${directory.counts.all === 1 ? "tournament" : "tournaments"}, but ${directory.counts.all === 1 ? "it is not" : "none of them is"} ${filter === "live" ? "mid-auction" : "taking registrations"} right now.`
                      : filter === "live"
                        ? `An auction runs for a couple of hours on the day, so this changes fast. All ${String(directory.catalogue)} public tournaments are listed under All.`
                        : `Organizers open registration when they are ready to take players. All ${String(directory.catalogue)} public tournaments are listed under All.`
                  }
                  action={
                    <span className="public-empty-actions">
                      {term === "" ? null : (
                        <ButtonLink variant="secondary" href={clearFilterHref}>
                          Show all matches
                        </ButtonLink>
                      )}
                      <ButtonLink href="/c">Browse all tournaments</ButtonLink>
                    </span>
                  }
                />
              ) : (
                <EmptyState
                  aria-live="polite"
                  headingLevel={2}
                  title="No public tournaments yet"
                  description="Organizers choose whether to list a tournament publicly. If someone sent you a direct link, it still works — open it and register there."
                  action={
                    <span className="public-empty-actions">
                      <ButtonLink variant="secondary" href="/help">
                        How DesiAuction works
                      </ButtonLink>
                      <ButtonLink href="/">Back to home</ButtonLink>
                    </span>
                  }
                />
              )}
            </Card>
          ) : (
            <section className="public-results" aria-labelledby="directory-results">
              {/* The card names are the only per-result headings, so they need a
                  heading ABOVE them to hang off: without this the whole page had
                  exactly one heading and a screen-reader user could not move
                  result to result. */}
              <h2 id="directory-results" className="visually-hidden">
                Tournament results
              </h2>
              <div className="public-results-head">
                <p className="public-count" aria-live="polite" data-testid="directory-count">
                  {countLabel}
                </p>
                <p className="public-helper">
                  Anyone can watch. Registering takes a mobile number, your name and playing role —
                  about a minute.
                </p>
              </div>
              <div className="public-grid" data-testid="directory-list">
                {directory.entries.map((entry) => {
                  const action = cardAction(entry);
                  return (
                    <Link
                      key={entry.slug}
                      href={action.href}
                      className="public-card-link"
                      data-live={entry.live ? "true" : undefined}
                    >
                      <article className="public-card">
                        <div className="public-card-head">
                          {entry.logoUrl !== null ? (
                            <img
                              className="public-card-crest"
                              src={entry.logoUrl}
                              alt=""
                              width={48}
                              height={48}
                              loading="lazy"
                            />
                          ) : (
                            <span className="public-card-crest public-card-mark" aria-hidden>
                              {monogram(entry.name)}
                            </span>
                          )}
                          <div className="public-card-titles">
                            <h3 className="public-card-name">{entry.name}</h3>
                            <span className="public-card-sub">{entry.orgName}</span>
                          </div>
                        </div>
                        <div className="public-card-meta">
                          {entry.location !== null ? (
                            <span className="public-card-sub">
                              <IconMapPin />
                              {entry.location}
                            </span>
                          ) : null}
                          <span className="public-card-sub">
                            <IconCalendar />
                            {formatDateRange(entry.startsOn, entry.endsOn)}
                          </span>
                        </div>
                        <div className="public-card-foot">
                          <span className="public-card-badges">
                            {entry.live ? <Badge tone="live">Live now</Badge> : null}
                            <Badge tone={entry.open ? "success" : "neutral"}>
                              {entry.open ? "Registration open" : "Registration closed"}
                            </Badge>
                          </span>
                          <span className="public-card-actions">
                            {action.note !== null ? (
                              <span className="public-card-note">{action.note}</span>
                            ) : null}
                            <span className="public-card-action">
                              {action.label}
                              <IconArrowRight />
                            </span>
                          </span>
                        </div>
                      </article>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
          {directory.totalPages > 1 ? (
            <nav className="public-pagination" aria-label="Pagination">
              {directory.page > 1 ? (
                <ButtonLink
                  variant="ghost"
                  href={directoryHref({ q: term, filter, sort, page: directory.page - 1 })}
                >
                  Previous
                </ButtonLink>
              ) : null}
              <span>
                Page {directory.page} of {directory.totalPages}
              </span>
              {directory.page < directory.totalPages ? (
                <ButtonLink
                  variant="ghost"
                  href={directoryHref({ q: term, filter, sort, page: directory.page + 1 })}
                >
                  Next
                </ButtonLink>
              ) : null}
            </nav>
          ) : null}
        </div>
      </div>
    </main>
  );
}
