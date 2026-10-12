import { financeRegisterReturn } from "../../../../../../lib/finance-navigation";
import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { documentWorkspace } from "../../../../../../server/financial-operations/actions";
import { DocumentPanel } from "./document-panel";
import "../../../../../seasons/seasons.css";
import "../../../../../seasons/[slug]/money/money.css";
import "../../finance.css";

export const metadata = { title: "Document" };

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
  searchParams,
}: {
  params: Promise<{ slug: string; docId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug, docId }, selections] = await Promise.all([params, searchParams]);
  const workspace = await documentWorkspace(slug, docId);
  if (workspace === null) {
    notFound();
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack finance-stack">
          <header className="dash-head">
            <p className="competitions-hint">
              What it says, what it was made from, and everywhere it went
            </p>
          </header>
          <DocumentPanel
            slug={slug}
            workspace={workspace}
            returnHref={financeRegisterReturn(slug, selections["register"])}
          />
        </div>
      </main>
    </ToastProvider>
  );
}
