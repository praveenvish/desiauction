import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

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
      <p className="article-meta no-print">
        <Link href="/help" className="prose-link">
          <span aria-hidden="true">←</span> All help
        </Link>
      </p>
      <h1>{category.title}</h1>
      <p className="content-lead">{category.description}</p>
      {/* h1 → h3 skip on all six category pages: the article cards are h3 with
          no h2 between them and the title. One group of cards, so the group
          heading is the h2 the cards were missing. */}
      <h2 id="articles">Articles in this guide</h2>
      <ul className="content-grid" aria-labelledby="articles">
        {articles.map((article) => (
          <li key={article.slug}>
            <Link href={`/help/${article.slug}`} className="content-card">
              <h3>{article.title}</h3>
              <p>{article.summary}</p>
              <span className="content-card-meta">{article.readMinutes} min read</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
