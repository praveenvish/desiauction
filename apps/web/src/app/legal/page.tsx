import type { Metadata } from "next";

import { env } from "../../env";
import { LEGAL_DOCUMENTS } from "../../content/legal";
import { ContentPage } from "../../components/public/content-page";
import { OperatorIdentityCard } from "../../components/public/operator-identity";
import { LinkRow, LinkRows } from "../../components/public/public-kit";
import "../content.css";

export const metadata: Metadata = {
  title: "Legal · DesiAuction",
  description: "Terms, privacy, refunds and the other documents that govern using DesiAuction.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/legal` },
};

/** The date every document first took effect; a later date is a revision. */
const LAUNCH_EFFECTIVE = LEGAL_DOCUMENTS.reduce(
  (earliest, doc) => (Date.parse(doc.effective) < Date.parse(earliest) ? doc.effective : earliest),
  LEGAL_DOCUMENTS[0]?.effective ?? "",
);

/**
 * PX-10 P-04 — the Legal Centre index. Public, no auth, printable documents.
 *
 * The documents are a single bordered list (name, one line, effective date),
 * and the side column carries WHO operates the platform — the statutory
 * identity that used to be 9px print in every footer (see operator-identity).
 */
export default function LegalIndexPage() {
  return (
    <ContentPage
      eyebrow="Legal"
      title={
        <>
          Legal <em>centre</em>
        </>
      }
      lede="The documents that govern using DesiAuction. Each is a beta draft under legal review — the current version and date are on every page."
      prose={false}
      aside={<OperatorIdentityCard />}
    >
      {/* One group, so the h2 IS the group (no h1 → h3 skip). */}
      <h2 id="documents" className="cl-list-title">
        The documents
      </h2>
      {/* No glyph per row (nine identical file icons), and the documents
          revised since launch say so: the recent dates used to carry the same
          weight as the rest, so a returning reader could not see what moved. */}
      <LinkRows labelledBy="documents">
        {LEGAL_DOCUMENTS.map((doc) => (
          <LinkRow
            key={doc.slug}
            href={`/legal/${doc.slug}`}
            title={doc.title}
            description={doc.summary}
            meta={
              doc.effective === LAUNCH_EFFECTIVE ? (
                doc.effective
              ) : (
                <span className="legal-updated">Updated {doc.effective}</span>
              )
            }
          />
        ))}
      </LinkRows>
    </ContentPage>
  );
}
