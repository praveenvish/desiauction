import { ButtonLink, LoadingState } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { settlementDashboard, settlementDeskGate } from "../../../../server/settlement/actions";
import { SettlementPanel } from "./settlement-panel";
import "../../../seasons/seasons.css";
import "../../../seasons/[slug]/money/money.css";

export const metadata = { title: "Settlement · DesiAuction" };

/**
 * PX-7 §5 — the org's Settlement dashboard.
 *
 * GATE FIRST, then stream. The cheap gate (membership + `settlement.view`)
 * resolves before anything renders, so a person without money authority gets a
 * real HTTP 404 — the desk is absent rather than locked. The expensive part
 * (folding every case in the org) streams underneath a Suspense boundary, which
 * is also what lets the panel read the URL for its saved view.
 *
 * There is deliberately NO route-level `loading.tsx`: a boundary ABOVE this
 * page would commit a 200 before the gate ran and destroy the 404.
 */
export default async function OrgSettlementPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await settlementDeskGate(slug);
  if (org === null) {
    notFound();
  }
  return (
    <main className="registrations-dash">
      <div className="dash-stack money-stack">
        <header className="dash-head">
          <div className="competition-title-row">
            <h1>Settlement</h1>
            <span className="date-row">
              <ButtonLink href={`/org/${slug}`} variant="secondary">
                {org.name}
              </ButtonLink>
            </span>
          </div>
          <p className="competitions-hint">
            Every case this organization has opened — what is owed, what came in, what closed
          </p>
        </header>
        <Suspense fallback={<LoadingState variant="page" />}>
          <Desk slug={slug} />
        </Suspense>
      </div>
    </main>
  );
}

/** The expensive half: one fold per case, streamed in behind the skeleton. */
async function Desk({ slug }: { slug: string }) {
  const dashboard = await settlementDashboard(slug);
  if (dashboard === null) {
    // Unreachable — the gate above already proved the grant. Fail closed anyway.
    notFound();
  }
  return <SettlementPanel dashboard={dashboard} />;
}
