import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { env } from "../../../env";
import { GUIDES, guide } from "../../../content/guides";
import { articleJsonLd, breadcrumbJsonLd } from "../../../server/seo/json-ld";
import { JsonLd } from "../../../components/seo/json-ld";
import { ArticleView } from "../../help/article-view";
import { formatDayDate } from "../../../lib/format-date";
import "../../content.css";

export function generateStaticParams() {
  return GUIDES.map((entry) => ({ slug: entry.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const entry = guide(slug);
  if (entry === undefined) return { title: "Guides" };
  const url = `${env.PUBLIC_BASE_URL}/guides/${entry.slug}`;
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

/** `/guides/[slug]` (SEO-1 Phase 6): one guide, bylined to the team. */
export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = guide(slug);
  if (entry === undefined) {
    notFound();
  }
  const base = env.PUBLIC_BASE_URL;
  const path = `/guides/${entry.slug}`;
  return (
    <>
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
            { name: "Guides", path: "/guides" },
            { name: entry.title, path },
          ]),
        ]}
      />
      <ArticleView
        title={entry.title}
        meta={`By the DesiAuction team · ${formatDayDate(entry.updatedOn, true)} · ${String(entry.readMinutes)} min read`}
        blocks={entry.blocks}
        backHref="/guides"
        backLabel="All guides"
      />
    </>
  );
}
