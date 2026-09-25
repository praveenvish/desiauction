import { IconFile } from "@desiauction/ui";
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
      <LinkRows labelledBy="documents">
        {LEGAL_DOCUMENTS.map((doc) => (
          <LinkRow
            key={doc.slug}
            href={`/legal/${doc.slug}`}
            icon={<IconFile size={20} weight="duotone" />}
            title={doc.title}
            description={doc.summary}
            meta={doc.effective}
          />
        ))}
      </LinkRows>
    </ContentPage>
  );
}
