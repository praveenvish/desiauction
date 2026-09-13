import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { env } from "../../../env";
import { FAQS, HELP_ARTICLES, helpArticle, helpCategory } from "../../../content/help";
import { PageIntro } from "../../../components/marketing/page-intro";
import { ArticleView } from "../article-view";
import "../../content.css";

// Static generation for every article slug plus the FAQ page.
export function generateStaticParams(): { slug: string }[] {
  return [...HELP_ARTICLES.map((article) => ({ slug: article.slug })), { slug: "faq" }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (slug === "faq") {
    return { title: "FAQ · Help · DesiAuction", description: "Frequently asked questions." };
  }
  const article = helpArticle(slug);
  if (article === undefined) {
    return { title: "Help · DesiAuction" };
  }
  return {
    title: `${article.title} · Help · DesiAuction`,
    description: article.summary,
    alternates: { canonical: `${env.PUBLIC_BASE_URL}/help/${slug}` },
  };
}

/**
 * PX-10 P-03 — a help article, or the FAQ (a task-titled prose page). Unknown
 * slugs render the branded 404 (the invalid-route guarantee). Public, no auth.
 */
export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  if (slug === "faq") {
    return (
      <main className="content-page content-narrow">
        <PageIntro
          title="Frequently asked questions"
          lead="Quick answers to the things people ask most."
          back={{ href: "/help", label: "All help" }}
        />
        <div className="content-section">
          {FAQS.map((faq) => (
            <details key={faq.question} className="faq-item">
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </main>
    );
  }

  const article = helpArticle(slug);
  if (article === undefined) {
    notFound();
  }
  const category = helpCategory(article.category);
  return (
    <ArticleView
      title={article.title}
      meta={`${category?.title ?? "Help"} · ${String(article.readMinutes)} min read`}
      blocks={article.blocks}
    />
  );
}
