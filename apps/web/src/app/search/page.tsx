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

/**
 * PX-10 §6 — public product search. NAVIGATION ONLY (PX-2's ruling): it filters
 * the static content index and links to destinations. It is a plain GET form
 * rendered on the server, so it works with no client JavaScript and every
 * result is a real, linkable URL. Reaches every public destination — help,
 * legal, marketing, support, release notes — which the founder demo requires.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const results = searchContent(query);
  return (
    <main className="content-page">
      <h1>Search</h1>
      <p className="content-lead">Find help articles, legal documents, pricing and support.</p>

      <form className="content-searchbar no-print" action="/search" method="get" role="search">
        <label className="visually-hidden-heading" htmlFor="search-q">
          Search
        </label>
        <input
          id="search-q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Search everything public…"
          autoFocus
        />
        <button type="submit">Search</button>
      </form>

      {query.length < 2 ? (
        <p className="article-meta">Type at least two characters to search.</p>
      ) : results.length === 0 ? (
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
            {results.length} result{results.length === 1 ? "" : "s"} for “{query}”
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
        </>
      )}
    </main>
  );
}
