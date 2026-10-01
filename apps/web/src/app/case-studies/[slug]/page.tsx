import { formatAmount } from "@desiauction/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft } from "@desiauction/ui";

import { env } from "../../../env";
import { caseStudy } from "../../../content/case-studies";
import { Prose } from "../../../content/blocks";
import { publicCaseStudyFigures } from "../../../server/competition/public";
import { articleJsonLd, breadcrumbJsonLd } from "../../../server/seo/json-ld";
import { JsonLd } from "../../../components/seo/json-ld";
import { PageBody, PageHero, StatStrip } from "../../../components/public/public-kit";
import { formatDayDate } from "../../../lib/format-date";
import "../../content.css";

// The figures are read from the season's record on every request: a season
// that is unpublished later must stop showing them.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const entry = caseStudy(slug);
  if (entry === undefined) return { title: "Case studies" };
  const url = `${env.PUBLIC_BASE_URL}/case-studies/${entry.slug}`;
  return {
    title: entry.title,
    description: entry.summary,
    alternates: { canonical: url },
    openGraph: {
      title: entry.title,
      description: entry.summary,
      url,
      type: "article",
      publishedTime: entry.publishedOn,
      modifiedTime: entry.updatedOn,
    },
  };
}

/**
 * `/case-studies/[slug]` (SEO-1 Phase 7): one league's story, in the
 * organizer's words, with its numbers read from the auction record.
 */
export default async function CaseStudyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = caseStudy(slug);
  if (entry === undefined) {
    notFound();
  }
  const figures = await publicCaseStudyFigures(entry.seasonSlug);
  const base = env.PUBLIC_BASE_URL;
  const path = `/case-studies/${entry.slug}`;
  return (
    <main className="content-page">
      <JsonLd
        data={[
          articleJsonLd({
            base,
            path,
            headline: entry.title,
            description: entry.summary,
            datePublished: entry.publishedOn,
            dateModified: entry.updatedOn,
          }),
          breadcrumbJsonLd(base, [
            { name: "Case studies", path: "/case-studies" },
            { name: entry.title, path },
          ]),
        ]}
      />
      <PageHero
        size="compact"
        eyebrow={
          <Link href="/case-studies" className="article-back no-print">
            <IconArrowLeft size={16} className="icon-lead" /> All case studies
          </Link>
        }
        title={entry.title}
        lede={`${entry.league} · ${entry.sport} · ${entry.city} · ${formatDayDate(entry.updatedOn, true)}`}
      />
      <PageBody>
        <div className="case-body" data-testid="case-study">
          {figures === null ? (
            <p className="case-note" data-testid="case-figures-missing">
              The auction&apos;s figures appear here while the season&apos;s page is published.
            </p>
          ) : (
            <StatStrip
              label="From the auction record"
              stats={[
                { value: String(figures.teams), label: "Teams" },
                { value: String(figures.sold), label: "Players sold" },
                {
                  value: formatAmount(figures.topPrice, figures.unit),
                  label: "Top price",
                },
                {
                  value: formatAmount(figures.totalSpent, figures.unit),
                  label: "Spent in total",
                },
              ]}
            />
          )}
          <blockquote className="case-quote">
            <p>{entry.quote}</p>
            <footer>
              {entry.organizer.name}, {entry.organizer.role}
            </footer>
          </blockquote>
          <article>
            <Prose blocks={entry.blocks} />
          </article>
          <p className="case-note">
            <Link href={`/c/${entry.seasonSlug}`}>See the season&apos;s teams and results</Link>
          </p>
        </div>
      </PageBody>
    </main>
  );
}
