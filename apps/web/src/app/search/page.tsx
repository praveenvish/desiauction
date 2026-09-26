import type { Metadata } from "next";
import Link from "next/link";

import { searchContent } from "../../content/search";
import { IconFile, IconHelp, IconPlay, IconRupee, IconSpark, IconTrophy } from "@desiauction/ui";

import { LinkRow, LinkRows, PageBody, PageHero } from "../../components/public/public-kit";
import "../content.css";

export const metadata: Metadata = {
  title: "Search · DesiAuction",
  description: "Search help, legal, pricing and support.",
  // Search results are not content to index.
  robots: { index: false },
};

/** What an empty search offers: the destinations visitors look for most. */
const SUGGESTIONS = [
  {
    href: "/help/getting-started",
    title: "A tour of DesiAuction",
    description: "What the platform does, and where to go next.",
    icon: <IconSpark size={20} weight="duotone" />,
  },
  {
    href: "/c",
    title: "Browse tournaments",
    description: "Every tournament published on DesiAuction.",
    icon: <IconTrophy size={20} weight="duotone" />,
  },
  {
    href: "/pricing",
    title: "Pricing",
    description: "Free during beta — what the passes will include.",
    icon: <IconRupee size={20} weight="duotone" />,
  },
  {
    href: "/#playground",
    title: "Try a mock auction",
    description: "Bid against the clock in your browser, no sign-in.",
    icon: <IconPlay size={20} weight="duotone" />,
  },
  {
    href: "/help/faq",
    title: "Frequently asked questions",
    description: "Quick answers to the things people ask most.",
    icon: <IconHelp size={20} weight="duotone" />,
  },
  {
    href: "/legal",
    title: "Legal centre",
    description: "Terms, privacy, refunds and who operates the platform.",
    icon: <IconFile size={20} weight="duotone" />,
  },
] as const;

/** How many hits a first page shows before the reader has to ask for the rest. */
const PAGE_SIZE = 12;

/**
 * PX-10 §6 — public product search. NAVIGATION ONLY (PX-2's ruling): it filters
 * the static content index and links to destinations. It is a plain GET form
 * rendered on the server, so it works with no client JavaScript and every
 * result is a real, linkable URL. It covers help, legal, marketing, support and
 * the release notes.
 *
 * The count is the TRUE number of matches. It used to print `results.length`
 * from a list `searchContent` had silently capped at twelve, so "auction" —
 * twenty-seven matches — reported "12 results", and nothing in the UI could
 * reach the other fifteen. Showing the rest is a query parameter away, and
 * works with JavaScript off like everything else here.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; all?: string }>;
}) {
  const { q, all } = await searchParams;
  const query = (q ?? "").trim();
  const matches = searchContent(query);
  const showAll = all === "1";
  const results = showAll ? matches : matches.slice(0, PAGE_SIZE);
  return (
    <main className="content-page">
      <PageHero
        size="compact"
        eyebrow="Find anything"
        title="Search"
        lede="Find help articles, legal documents, pricing and support."
        actions={
          <form className="content-searchbar no-print" action="/search" method="get" role="search">
            <label className="visually-hidden-heading" htmlFor="search-q">
              Search
            </label>
            {/* No autoFocus: it steals the caret from a reader who arrived with
            results already on screen, and jumps a screen reader past the count
            it was about to announce. */}
            <input
              id="search-q"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Search the site…"
            />
            <button type="submit">Search</button>
          </form>
        }
      />

      <PageBody>
        {query.length < 2 ? (
          // An empty search used to be one 13px line in a cream strip, which
          // read as a broken page. Now it offers the places people go most.
          <section className="search-suggest" aria-labelledby="popular">
            <h2 id="popular" className="cl-list-title">
              {query.length === 0
                ? "Popular destinations"
                : "Type at least two characters — or try"}
            </h2>
            <LinkRows labelledBy="popular" className="search-suggest-rows">
              {SUGGESTIONS.map((item) => (
                <LinkRow
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  title={item.title}
                  description={item.description}
                />
              ))}
            </LinkRows>
          </section>
        ) : matches.length === 0 ? (
          <p className="article-meta" data-testid="search-empty">
            Nothing matches “{query}”. Try a different word, or browse{" "}
            <Link href="/help" className="prose-link">
              the help centre
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="article-meta" data-testid="search-count">
              {matches.length} result{matches.length === 1 ? "" : "s"} for “{query}”
              {results.length < matches.length
                ? `, showing the first ${String(results.length)}`
                : ""}
            </p>
            <ul className="search-results" data-testid="search-results">
              {results.map((result) => (
                <li key={result.href}>
                  <Link href={result.href} className="search-result">
                    <span>
                      <strong>{result.title}</strong>
                      <span className="content-card-meta">{result.hint}</span>
                    </span>
                    <span className="search-result-section">{result.section}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {results.length < matches.length ? (
              <p className="article-meta no-print">
                <Link
                  href={`/search?q=${encodeURIComponent(query)}&all=1`}
                  className="prose-link"
                  data-testid="search-show-all"
                >
                  Show all {matches.length} results
                </Link>
              </p>
            ) : null}
          </>
        )}
      </PageBody>
    </main>
  );
}
