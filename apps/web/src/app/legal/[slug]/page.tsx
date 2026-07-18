import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { env } from "../../../env";
import { Prose } from "../../../content/blocks";
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
    <main className="content-page content-narrow">
      <p className="article-meta no-print">
        <Link href="/legal" className="prose-link">
          ← All legal documents
        </Link>
      </p>
      <h1>{doc.title}</h1>
      <p className="article-meta">
        Effective {doc.effective} · version {doc.versions[0]?.version}
      </p>
      <Prose blocks={doc.blocks} />

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
    </main>
  );
}
