import { LoadingState } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { adminOutcomes, adminOverview } from "../../server/admin/actions";
import { platformAdminGate } from "../../server/admin/authz";
import { OverviewPanel } from "./overview-panel";
import "../seasons/seasons.css";
import "./admin.css";

export const metadata = { title: "Platform admin · DesiAuction" };

/**
 * PX-9 §1 — the Platform Dashboard (PX-1 02 G1).
 *
 * GATE FIRST, then stream — the pattern PX-7/PX-8 paid for. The cheap gate
 * (`platform.admin`) resolves before anything renders, so a person without the
 * grant gets a real HTTP 404: administration is ABSENT, not locked. The
 * expensive half (counts, health derivation, the attention queue) streams
 * underneath Suspense.
 *
 * There is deliberately NO route-level `loading.tsx` anywhere under /admin: a
 * boundary ABOVE this page would commit a 200 before the gate ran and destroy
 * the 404 (the PX-2 finding, re-proved by PX-7 and PX-8 — it applies to
 * notFound() exactly as it does to redirect()).
 */
export default async function AdminPage() {
  if ((await platformAdminGate()) === null) {
    notFound();
  }
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <header className="dash-head">
          <h1>Platform</h1>
          <p className="dash-hint">
            Everything the platform is doing right now. Administration observes — every fix happens
            in the console that owns it.
          </p>
        </header>
        <Suspense fallback={<LoadingState variant="page" />}>
          <Board />
        </Suspense>
      </div>
    </main>
  );
}

async function Board() {
  const [overview, outcomes] = await Promise.all([adminOverview(), adminOutcomes()]);
  if (overview === null || outcomes === null) {
    // Unreachable — the gate above already proved the grant. Fail closed anyway.
    notFound();
  }
  return <OverviewPanel overview={overview} outcomes={outcomes} />;
}
