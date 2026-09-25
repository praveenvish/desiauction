import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft, IconFile } from "@desiauction/ui";

import { ContentLayout } from "../../../../components/public/content-layout";
import {
  LinkRow,
  LinkRows,
  PageBody,
  PageHero,
  SideCard,
} from "../../../../components/public/public-kit";
import { env } from "../../../../env";
import { HELP_CATEGORIES, helpArticlesIn, helpCategory } from "../../../../content/help";
import "../../../content.css";

export function generateStaticParams(): { slug: string }[] {
  return HELP_CATEGORIES.map((category) => ({ slug: category.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = helpCategory(slug);
  if (category === undefined) {
    return { title: "Help · DesiAuction" };
  }
  return {
    title: `${category.title} · Help · DesiAuction`,
    description: category.description,
    alternates: { canonical: `${env.PUBLIC_BASE_URL}/help/category/${slug}` },
  };
}

/** PX-10 — a help category page (article navigation). Public, no auth. */
export default async function HelpCategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = helpCategory(slug);
  if (category === undefined) {
    notFound();
  }
  const articles = helpArticlesIn(slug);
  return (
    <main className="content-page">
      <PageHero
        size="compact"
        eyebrow={
          <Link href="/help" className="article-back no-print">
            <IconArrowLeft size={16} className="icon-lead" /> All help
          </Link>
        }
        title={category.title}
        lede={category.description}
      />
      <PageBody>
        <ContentLayout
          prose={false}
          aside={
            <SideCard headingId="other-guides" title="Other guides">
              <ul className="pk-side-list">
                {HELP_CATEGORIES.filter((other) => other.slug !== slug).map((other) => (
                  <li key={other.slug}>
                    <Link href={`/help/category/${other.slug}`}>
                      {other.title}
                      <span className="help-guide-time">{helpArticlesIn(other.slug).length}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p>
                Can&rsquo;t find it? <Link href="/support">Ask support</Link>.
              </p>
            </SideCard>
          }
        >
          {/* One group of links, so the group heading is the h2. A list of rows
              (title, one line, reading time) — the card grid left a 4+1 orphan
              and spent ~190px per title. */}
          <h2 id="articles" className="cl-list-title">
            {articles.length} {articles.length === 1 ? "article" : "articles"} in this guide
          </h2>
          <LinkRows labelledBy="articles">
            {articles.map((article) => (
              <LinkRow
                key={article.slug}
                href={`/help/${article.slug}`}
                icon={<IconFile size={20} weight="duotone" />}
                title={article.title}
                description={article.summary}
                meta={`${String(article.readMinutes)} min read`}
              />
            ))}
          </LinkRows>
        </ContentLayout>
      </PageBody>
    </main>
  );
}
