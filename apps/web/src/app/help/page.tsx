import {
  IconArrowRight,
  IconFlag,
  IconGavel,
  IconHelp,
  IconReceipt,
  IconSpark,
  IconTrophy,
  IconUsers,
} from "@desiauction/ui";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { env } from "../../env";
import { HELP_ARTICLES, HELP_CATEGORIES, helpArticlesIn } from "../../content/help";
import { CountChips, PageBody, PageHero } from "../../components/public/public-kit";
import "../content.css";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Help centre · DesiAuction",
  description:
    "Guides for organizers, players and team owners — setup, registration, the live auction, settlement and finance.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/help` },
};

/**
 * A face per category — a DISTINCT glyph, one tint. (It was one glyph repeated
 * on every card of a section, in five different tile colours.) Keyed by the
 * category's own slug; a new category without an entry gets the question mark.
 */
const CATEGORY_ICON: Record<string, ReactNode> = {
  "getting-started": <IconSpark size={24} weight="duotone" />,
  organizer: <IconTrophy size={24} weight="duotone" />,
  player: <IconUsers size={24} weight="duotone" />,
  auction: <IconGavel size={24} weight="duotone" />,
  money: <IconReceipt size={24} weight="duotone" />,
};

/**
 * WHAT PEOPLE ACTUALLY ARRIVE LOOKING FOR.
 *
 * Each chip is a real query against the real index — not a decorative tag —
 * and each one is phrased the way a visitor would type it rather than the way
 * the product names it. The mockup's version of this row sat above a grid of
 * cards claiming "6 articles", "8 articles" and so on; there are sixteen
 * articles in total, and a count nobody can verify is exactly what the content
 * ruling forbids. The real reading time rides on each card instead.
 */
const POPULAR = [
  "Create a tournament",
  "Player registration",
  "Live auction",
  "Receipts",
  "Teams and squads",
];

export default function HelpIndexPage() {
  return (
    <main className="content-page">
      <PageHero
        eyebrow="Support"
        title={
          <>
            Help <em>centre</em>
          </>
        }
        lede="Everything you need to run a tournament on DesiAuction — described exactly as the platform works."
        actions={
          <>
            <form
              className="content-searchbar no-print"
              action="/search"
              method="get"
              role="search"
            >
              <label className="visually-hidden-heading" htmlFor="help-q">
                Search help
              </label>
              <input id="help-q" name="q" type="search" placeholder="Search help and more…" />
              <button type="submit">Search</button>
            </form>
            <CountChips
              label="Popular searches"
              chips={POPULAR.map((term) => ({
                label: term,
                href: `/search?q=${encodeURIComponent(term)}`,
              }))}
            />
          </>
        }
      />

      <PageBody>
        {/* A CATEGORY INDEX, not six stacked card grids: one card per guide,
            its articles listed inside it as plain rows. Six cards make a clean
            3×2 — the old layout left an orphan or a half-empty row under
            every section and ran to ~3,950px on a laptop. */}
        <h2 className="visually-hidden-heading" id="guides">
          Guides
        </h2>
        <div className="help-index da-stagger">
          {HELP_CATEGORIES.map((category) => (
            <section key={category.slug} className="help-guide" aria-labelledby={category.slug}>
              <div className="help-guide-head">
                <span className="help-guide-tile" aria-hidden>
                  {CATEGORY_ICON[category.slug] ?? <IconHelp size={24} weight="duotone" />}
                </span>
                <div>
                  <h3 className="help-guide-title" id={category.slug}>
                    {category.title}
                  </h3>
                  <p className="help-guide-desc">{category.description}</p>
                </div>
              </div>
              <ul className="help-guide-list">
                {helpArticlesIn(category.slug).map((article) => (
                  <li key={article.slug}>
                    <Link href={`/help/${article.slug}`} className="help-guide-link">
                      <span>{article.title}</span>
                      <span className="help-guide-time">{article.readMinutes} min</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link className="content-view-all" href={`/help/category/${category.slug}`}>
                View all <IconArrowRight size={16} />
              </Link>
            </section>
          ))}
          <section className="help-guide help-guide-more" aria-labelledby="more">
            <div className="help-guide-head">
              <span className="help-guide-tile" aria-hidden>
                <IconFlag size={24} weight="duotone" />
              </span>
              <div>
                <h3 className="help-guide-title" id="more">
                  More help
                </h3>
                <p className="help-guide-desc">Quick answers, a human, and what changed lately.</p>
              </div>
            </div>
            <ul className="help-guide-list">
              <li>
                <Link href="/help/faq" className="help-guide-link">
                  <span>Frequently asked questions</span>
                  <IconArrowRight size={16} />
                </Link>
              </li>
              <li>
                <Link href="/support" className="help-guide-link">
                  <span>Contact support</span>
                  <IconArrowRight size={16} />
                </Link>
              </li>
              <li>
                <Link href="/rules-guidelines" className="help-guide-link">
                  <span>Rules &amp; guidelines</span>
                  <IconArrowRight size={16} />
                </Link>
              </li>
              <li>
                <Link href="/releases" className="help-guide-link">
                  <span>Release notes</span>
                  <IconArrowRight size={16} />
                </Link>
              </li>
            </ul>
            <p className="article-meta">
              {HELP_ARTICLES.length} articles · free to read, no sign-in needed.
            </p>
          </section>
        </div>
      </PageBody>
    </main>
  );
}
