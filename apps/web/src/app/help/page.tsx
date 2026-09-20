import {
  IconGavel,
  IconHelp,
  IconMessageCircle,
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
import {
  CountChips,
  PageBody,
  PageHero,
  PageSection,
  SportMontage,
  TopicCard,
  TopicGrid,
} from "../../components/public/public-kit";
import "../content.css";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Help centre · DesiAuction",
  description:
    "Guides for organizers, players and team owners — setup, registration, the live auction, settlement and finance.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/help` },
};

type Tone = "gold" | "green" | "blue" | "amber" | "purple" | "neutral";

/**
 * A face per category, so a reader scanning six sections has something other
 * than the heading to recognise. Keyed by the category's own slug — a new
 * category without an entry gets the neutral question mark rather than
 * nothing, which is the one thing a card grid cannot survive.
 */
const CATEGORY_FACE: Record<string, { icon: ReactNode; tone: Tone }> = {
  "getting-started": { icon: <IconSpark width={20} height={20} />, tone: "gold" },
  organizer: { icon: <IconTrophy width={20} height={20} />, tone: "blue" },
  player: { icon: <IconUsers width={20} height={20} />, tone: "green" },
  auction: { icon: <IconGavel width={20} height={20} />, tone: "purple" },
  money: { icon: <IconReceipt width={20} height={20} />, tone: "amber" },
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
        art={<SportMontage />}
        actions={
          <>
            <form className="content-searchbar no-print" action="/search" method="get" role="search">
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
        {HELP_CATEGORIES.map((category) => {
          const face = CATEGORY_FACE[category.slug] ?? {
            icon: <IconHelp width={20} height={20} />,
            tone: "neutral" as Tone,
          };
          return (
            <PageSection
              key={category.slug}
              headingId={category.slug}
              title={category.title}
              lede={category.description}
              action={
                <Link className="content-view-all" href={`/help/category/${category.slug}`}>
                  View all
                </Link>
              }
              flush
            >
              <TopicGrid>
                {helpArticlesIn(category.slug).map((article) => (
                  <TopicCard
                    key={article.slug}
                    href={`/help/${article.slug}`}
                    icon={face.icon}
                    tone={face.tone}
                    title={article.title}
                    description={article.summary}
                    foot={`${String(article.readMinutes)} min read`}
                  />
                ))}
              </TopicGrid>
            </PageSection>
          );
        })}

        <PageSection headingId="more" title="More" flush>
          <TopicGrid>
            <TopicCard
              href="/help/faq"
              icon={<IconHelp width={20} height={20} />}
              title="Frequently asked questions"
              description="Quick answers to the things people ask most."
            />
            <TopicCard
              href="/support"
              tone="neutral"
              icon={<IconMessageCircle width={20} height={20} />}
              title="Support"
              description="Reach a human, report a bug, or check what changed."
            />
          </TopicGrid>
          <p className="article-meta">
            {HELP_ARTICLES.length} articles · always free to read, no sign-in needed.
          </p>
        </PageSection>
      </PageBody>
    </main>
  );
}
