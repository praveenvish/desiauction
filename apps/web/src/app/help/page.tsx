import type { Metadata } from "next";
import Link from "next/link";

import { env } from "../../env";
import { HELP_ARTICLES, HELP_CATEGORIES, helpArticlesIn } from "../../content/help";
import "../content.css";

export const metadata: Metadata = {
  title: "Help centre · DesiAuction",
  description:
    "Guides for organizers, players and team owners — setup, registration, the live auction, settlement and finance.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/help` },
};

/**
 * PX-10 P-03 — the Help Centre index (PX-1 05 §8). Card list of the guide
 * categories and every article, plus a search box that submits to the public
 * search. Static, public, no authentication.
 */
export default function HelpIndexPage() {
  return (
    <main className="content-page">
      <h1>Help centre</h1>
      <p className="content-lead">
        Everything you need to run a tournament on DesiAuction — described exactly as the platform
        works.
      </p>

      <form className="content-searchbar no-print" action="/search" method="get" role="search">
        <label className="visually-hidden-heading" htmlFor="help-q">
          Search help
        </label>
        <input id="help-q" name="q" type="search" placeholder="Search help and more…" />
        <button type="submit">Search</button>
      </form>

      {HELP_CATEGORIES.map((category) => (
        <section key={category.slug} className="content-section" aria-labelledby={category.slug}>
          <h2 id={category.slug}>
            <Link href={`/help/category/${category.slug}`} className="prose-link">
              {category.title}
            </Link>
          </h2>
          <p className="content-lead" style={{ marginBottom: "var(--space-3)" }}>
            {category.description}
          </p>
          <ul className="content-grid">
            {helpArticlesIn(category.slug).map((article) => (
              <li key={article.slug}>
                <Link href={`/help/${article.slug}`} className="content-card">
                  <h3>{article.title}</h3>
                  <p>{article.summary}</p>
                  <span className="content-card-meta">{article.readMinutes} min read</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="content-section" aria-labelledby="more">
        <h2 id="more">More</h2>
        <ul className="content-grid">
          <li>
            <Link href="/help/faq" className="content-card">
              <h3>Frequently asked questions</h3>
              <p>Quick answers to the things people ask most.</p>
            </Link>
          </li>
          <li>
            <Link href="/support" className="content-card">
              <h3>Support</h3>
              <p>Reach a human, report a bug, or check what changed.</p>
            </Link>
          </li>
        </ul>
        <p className="article-meta">
          {HELP_ARTICLES.length} articles · always free to read, no sign-in needed.
        </p>
      </section>
    </main>
  );
}
