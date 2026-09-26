import {
  ButtonLink,
  Card,
  EmptyState,
  Pager,
  SegmentedTabs,
  Toolbar,
  ToolbarChip,
  ToolbarCount,
  ToolbarSearch,
  ToolbarSpacer,
} from "@desiauction/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { env } from "../../../env";
import {
  parseDirectoryFilter,
  parseDirectorySort,
  publicCompetitionsDirectory,
  type DirectoryFilter,
  type DirectorySort,
} from "../../../server/competition/public";
import { PageBody, PageHero } from "../../../components/public/public-kit";
import { TournamentCard, TournamentGrid } from "../../../components/public/tournament-card";
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
  const facet =
    filter === "open"
      ? "Registration open"
      : filter === "live"
        ? "Live now"
        : filter === "upcoming"
          ? "Upcoming"
          : filter === "closed"
            ? "Registration closed"
            : "";
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
  const facetLabel =
    filter === "open"
      ? "Registration open"
      : filter === "live"
        ? "Live now"
        : filter === "upcoming"
          ? "Upcoming"
          : filter === "closed"
            ? "Registration closed"
            : "";
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
  /**
   * The five states a visitor actually sorts tournaments into. "Upcoming" and
   * "Registration closed" were missing, so every season that was neither open
   * nor live — most of them, most of the time — could only be found by
   * scrolling All, and a visitor looking for a tournament to watch next month
   * had no way to ask for one.
   */
  const facets: {
    key: DirectoryFilter;
    label: string;
    count: number;
    tone?: "live" | "open" | "closed" | "soon";
  }[] = [
    { key: "all", label: "All", count: directory.counts.all },
    { key: "open", label: "Registration open", count: directory.counts.open, tone: "open" },
    { key: "live", label: "Live now", count: directory.counts.live, tone: "live" },
    { key: "upcoming", label: "Upcoming", count: directory.counts.upcoming, tone: "soon" },
    {
      key: "closed",
      label: "Registration closed",
      count: directory.counts.closed,
      tone: "closed",
    },
  ];
  // Zero-count facets are noise ("Live now 0"); All and the active one stay.
  const shownFacets = facets.filter(
    (entry) => entry.key === "all" || entry.key === filter || entry.count > 0,
  );
  return (
    <main className="public-page mk">
      <PageHero
        size="compact"
        eyebrow={DIRECTORY_KICKER}
        title={
          <>
            Tournam<em>ents</em>
          </>
        }
        lede={DIRECTORY_DESCRIPTION}
      />

      <PageBody>
        {/* ONE ROW (wow pass). Search, facets, count and sort used to take four
            rows inside the hero, and the first card started ~740px down. The
            facet rides along as a hidden input so searching inside a facet
            keeps it, and the facet links carry `q` so switching keeps the
            search. */}
        <form className="dir-toolbar" action="/c" method="get" role="search">
          {filter === "all" ? null : <input type="hidden" name="filter" value={filter} />}
          <Toolbar testId="directory-filters">
            <ToolbarSearch
              id="directory-q"
              name="q"
              label="Search tournaments"
              submitLabel="Search"
              defaultValue={sp.q ?? ""}
              placeholder="Tournament, club or city"
              className="dir-search"
            />
            {term === "" ? null : (
              <ToolbarChip
                href={clearSearchHref}
                removeLabel="Clear search"
                testId="directory-clear"
              >
                “{term}”
              </ToolbarChip>
            )}
            <SegmentedTabs
              label="Filter tournaments"
              items={shownFacets.map((entry) => ({
                key: entry.key,
                label: entry.label,
                count: entry.count,
                active: entry.key === filter,
                href: directoryHref({ q: term, filter: entry.key, sort }),
              }))}
            />
            <ToolbarSpacer />
            <ToolbarCount testId="directory-count">
              <span aria-live="polite">
                {directory.entries.length === directory.total
                  ? `${String(directory.total)} ${noun}`
                  : `${String(directory.entries.length)} of ${String(directory.total)}`}
                <span className="visually-hidden">
                  {countLabel === "" ? "" : ` — ${countLabel}`}
                </span>
              </span>
            </ToolbarCount>
            <SortSelect value={sort} />
          </Toolbar>
        </form>

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
            <TournamentGrid testId="directory-list" className="da-stagger">
              {directory.entries.map((entry) => (
                <TournamentCard
                  key={entry.slug}
                  tournament={{
                    name: entry.name,
                    slug: entry.slug,
                    orgName: entry.orgName,
                    sport: entry.sport,
                    location: entry.location,
                    dates: formatDateRange(entry.startsOn, entry.endsOn),
                    open: entry.open,
                    live: entry.live,
                    teamCount: entry.teamCount,
                    playerCount: entry.playerCount,
                    logoUrl: entry.logoUrl,
                    coverUrl: entry.coverUrl,
                    entryCategory: entry.entryCategory,
                  }}
                />
              ))}
            </TournamentGrid>
          </section>
        )}
        {directory.totalPages > 1 ? (
          <div className="public-pagination">
            <Pager
              label="Pagination"
              total={directory.total}
              page={directory.page}
              pageCount={directory.totalPages}
              shown={directory.entries.length}
              noun={noun}
              hrefFor={(entry) => directoryHref({ q: term, filter, sort, page: entry })}
              linkComponent={Link}
            />
          </div>
        ) : null}
      </PageBody>
    </main>
  );
}
