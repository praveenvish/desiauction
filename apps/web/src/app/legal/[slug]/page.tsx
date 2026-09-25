import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft, IconFile } from "@desiauction/ui";

import { ContentLayout } from "../../../components/public/content-layout";
import { PageBody, PageHero, SideCard } from "../../../components/public/public-kit";
import { env } from "../../../env";
import { Prose, tocOf } from "../../../content/blocks";
import { LEGAL_DOCUMENTS, legalDocument } from "../../../content/legal";
import "../../content.css";

export function generateStaticParams(): { slug: string }[] {
  return LEGAL_DOCUMENTS.map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = legalDocument(slug);
  if (doc === undefined) {
    return { title: "Legal · DesiAuction" };
  }
  return {
    title: `${doc.title} · DesiAuction`,
    description: doc.summary,
    alternates: { canonical: `${env.PUBLIC_BASE_URL}/legal/${slug}` },
  };
}

/**
 * PX-10 P-04 — a legal document (PX-1 05 §9 skeleton), printable, with its
 * version history. Public, no auth. Unknown slugs render the branded 404.
 */
export default async function LegalDocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = legalDocument(slug);
  if (doc === undefined) {
    notFound();
  }
  return (
    <main className="content-page">
      <PageHero
        size="compact"
        eyebrow={
          <Link href="/legal" className="article-back no-print">
            <IconArrowLeft size={16} className="icon-lead" /> All legal documents
          </Link>
        }
        title={doc.title}
        lede={doc.summary}
      />
      <PageBody>
        {/* A legal document had no table of contents and an empty right 40%
            of the page. The side column now carries "On this page" and the
            document's facts; the TOC lists the h2s only (h3s made it a wall). */}
        <ContentLayout
          prose={false}
          meta={`Effective ${doc.effective} · version ${doc.versions[0]?.version ?? ""}`}
          anchors={[
            ...tocOf(doc.blocks)
              .filter((heading) => heading.level === 2)
              .map((heading) => ({ id: heading.id, label: heading.text })),
            { id: "version-history", label: "Version history" },
          ]}
          aside={
            <SideCard
              headingId="doc-facts"
              title="This document"
              icon={<IconFile size={20} weight="duotone" />}
            >
              <dl className="pk-side-facts">
                <div>
                  <dt>Effective</dt>
                  <dd>{doc.effective}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>{doc.versions[0]?.version ?? "—"}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>Beta draft</dd>
                </div>
              </dl>
              <p className="no-print">
                <Link href="/legal">All legal documents</Link>
              </p>
            </SideCard>
          }
        >
          <div className="cl-prose-doc">
            <Prose blocks={doc.blocks} />
          </div>

          <section className="content-section" aria-labelledby="version-history">
            <h2 id="version-history" className="prose-h2">
              Version history
            </h2>
            <dl className="prose-dl">
              {doc.versions.map((version) => (
                <div key={version.version} className="prose-dl-row">
                  <dt>
                    {version.version} — {version.date}
                  </dt>
                  <dd>{version.note}</dd>
                </div>
              ))}
            </dl>
          </section>
        </ContentLayout>
      </PageBody>
    </main>
  );
}
