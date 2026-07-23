import { ButtonLink, LoadingState, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  financeGate,
  reconciliationWorkspace,
} from "../../../../../server/financial-operations/actions";
import { ReconciliationPanel } from "./reconciliation-panel";
import "../../../../seasons/seasons.css";
import "../../../../seasons/[slug]/money/money.css";
import "../finance.css";

export const metadata = { title: "Reconciliation · DesiAuction" };

/**
 * PX-8 §3 — the Reconciliation workspace.
 *
 * Gate first (real 404), then stream: this page re-derives certification twice
 * and re-verifies every fiscal seal on read, so it is the most expensive
 * surface in the product and the one that most deserves a skeleton.
 */
export default async function ReconciliationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const org = await financeGate(slug);
  if (org === null) {
    notFound();
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack finance-stack">
          <header className="dash-head">
            <div className="competition-title-row">
              <h1>Reconciliation</h1>
              <span className="date-row">
                <ButtonLink href={`/org/${slug}/money`} variant="secondary">
                  Finance
                </ButtonLink>
              </span>
            </div>
            <p className="competitions-hint">
              Does finance still agree with settlement — proved from the log, not asserted
            </p>
          </header>
          <Suspense fallback={<LoadingState variant="page" />}>
            <Desk slug={slug} />
          </Suspense>
        </div>
      </main>
    </ToastProvider>
  );
}

async function Desk({ slug }: { slug: string }) {
  const workspace = await reconciliationWorkspace(slug);
  if (workspace === null) {
    notFound();
  }
  return <ReconciliationPanel slug={slug} workspace={workspace} />;
}
