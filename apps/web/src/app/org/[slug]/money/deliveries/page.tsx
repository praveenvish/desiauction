import { AnnouncerProvider, LoadingState, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { deliveryWorkspace, financeGate } from "../../../../../server/financial-operations/actions";
import { DeliveriesPanel } from "./deliveries-panel";
import "../../../../seasons/seasons.css";
import "../../../../seasons/[slug]/money/money.css";
import "../finance.css";

export const metadata = { title: "Deliveries · DesiAuction" };

/**
 * PX-8 §2 — the Delivery workspace (PX-1 F1's Dispatches tab).
 *
 * Gate first (real 404 for a non-holder), then stream the lanes. No route-level
 * `loading.tsx`: a boundary above the gate would commit a 200 and destroy it.
 */
export default async function DeliveriesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if ((await financeGate(slug)) === null) {
    notFound();
  }
  return (
    <AnnouncerProvider>
      <ToastProvider>
        <main className="registrations-dash">
          <div className="dash-stack finance-stack">
            <header className="dash-head">
              <p className="competitions-hint">
                Every receipt and notice the platform tried to deliver — and what happened to it
              </p>
            </header>
            <Suspense fallback={<LoadingState variant="page" />}>
              <Lanes slug={slug} />
            </Suspense>
          </div>
        </main>
      </ToastProvider>
    </AnnouncerProvider>
  );
}

async function Lanes({ slug }: { slug: string }) {
  const workspace = await deliveryWorkspace(slug);
  if (workspace === null) {
    notFound();
  }
  return <DeliveriesPanel slug={slug} workspace={workspace} />;
}
