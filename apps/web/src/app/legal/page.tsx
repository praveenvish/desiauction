import type { Metadata } from "next";
import Link from "next/link";

import { env } from "../../env";
import { LEGAL_DOCUMENTS } from "../../content/legal";
import "../content.css";

export const metadata: Metadata = {
  title: "Legal · DesiAuction",
  description: "Terms, privacy, refunds and the other documents that govern using DesiAuction.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/legal` },
};

/** PX-10 P-04 — the Legal Centre index. Public, no auth, printable documents. */
export default function LegalIndexPage() {
  return (
    <main className="content-page">
      <h1>Legal centre</h1>
      <p className="content-lead">
        The documents that govern using DesiAuction. Each is a beta draft under legal review — the
        current version and date are on every page.
      </p>
      <ul className="content-grid">
        {LEGAL_DOCUMENTS.map((doc) => (
          <li key={doc.slug}>
            <Link href={`/legal/${doc.slug}`} className="content-card">
              <h3>{doc.title}</h3>
              <p>{doc.summary}</p>
              <span className="content-card-meta">Effective {doc.effective}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
