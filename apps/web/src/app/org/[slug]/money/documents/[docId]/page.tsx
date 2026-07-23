import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { documentWorkspace } from "../../../../../../server/financial-operations/actions";
import { DocumentPanel } from "./document-panel";
import "../../../../../seasons/seasons.css";
import "../../../../../seasons/[slug]/money/money.css";
import "../../finance.css";

export const metadata = { title: "Document · DesiAuction" };

/**
 * PX-8 §4 — Operations detail (PX-1 F2).
 *
 * One read gates AND loads: a single document is cheap, and `documentWorkspace`
 * returns null for a non-holder, an unknown document and another org's document
 * alike — so notFound() is the right answer to all three, and the screen never
 * confirms that a document it may not see exists.
 */
export default async function DocumentPage({
  params,
}: {
  params: Promise<{ slug: string; docId: string }>;
}) {
  const { slug, docId } = await params;
  const workspace = await documentWorkspace(slug, docId);
  if (workspace === null) {
    notFound();
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack finance-stack">
          <header className="dash-head">
            <div className="competition-title-row">
              <h1>Document</h1>
              <span className="date-row">
                <ButtonLink href={`/org/${slug}/money`} variant="secondary">
                  Finance
                </ButtonLink>
              </span>
            </div>
            <p className="competitions-hint">
              What it says, what it was made from, and everywhere it went
            </p>
          </header>
          <DocumentPanel slug={slug} workspace={workspace} />
        </div>
      </main>
    </ToastProvider>
  );
}
