import type { Metadata } from "next";
import Link from "next/link";

import { searchContent } from "../../content/search";
import "../content.css";

export const metadata: Metadata = {
  title: "Search · DesiAuction",
  description: "Search help, legal, pricing and support.",
  // Search results are not content to index.
  robots: { index: false },
};

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
      <h1>Search</h1>
      <p className="content-lead">Find help articles, legal documents, pricing and support.</p>

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
          placeholder="Search everything public…"
        />
        <button type="submit">Search</button>
      </form>

      {query.length < 2 ? (
        <p className="article-meta">Type at least two characters to search.</p>
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
            {results.length < matches.length ? `, showing the first ${String(results.length)}` : ""}
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
    </main>
  );
}
