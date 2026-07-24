import { LoadingState, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { financeGate, financeWorkspace } from "../../../../server/financial-operations/actions";
import { FinancePanel } from "./finance-panel";
import "../../../seasons/seasons.css";
import "../../../seasons/[slug]/money/money.css";
import "./finance.css";

export const metadata = { title: "Finance · DesiAuction" };

/**
 * PX-8 §1 — the Financial Operations dashboard (PX-1 F1).
 *
 * GATE FIRST, then stream. The cheap gate (membership + `finops.view`) resolves
 * before anything renders, so a person without a finance grant gets a real HTTP
 * 404 — the workspace is absent rather than locked. The expensive part (health
 * derivation, the attention queue, the register) streams underneath a Suspense
 * boundary.
 *
 * There is deliberately NO route-level `loading.tsx`: a boundary ABOVE this page
 * would commit a 200 before the gate ran and destroy the 404 (the PX-2/PX-7
 * finding — it applies to notFound() exactly as it does to redirect()).
 */
export default async function OrgMoneyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if ((await financeGate(slug)) === null) {
    notFound();
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack finance-stack">
          <header className="dash-head">
            <p className="competitions-hint">
              Financial operations — what the platform did after settlement, and what still needs a
              human
            </p>
          </header>
          <Suspense fallback={<LoadingState variant="page" />}>
            <Board slug={slug} />
          </Suspense>
        </div>
      </main>
    </ToastProvider>
  );
}

/** The expensive half: health, the queue and the register, streamed in. */
async function Board({ slug }: { slug: string }) {
  const workspace = await financeWorkspace(slug);
  if (workspace === null) {
    // Unreachable — the gate above already proved the grant. Fail closed anyway.
    notFound();
  }
  return <FinancePanel slug={slug} workspace={workspace} />;
}
