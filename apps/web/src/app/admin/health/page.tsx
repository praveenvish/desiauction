import { LoadingState } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { adminHealth } from "../../../server/admin/actions";
import { platformAdminGate } from "../../../server/admin/authz";
import { HealthPanel } from "./health-panel";
import "../../seasons/seasons.css";
import "../admin.css";

export const metadata = { title: "Health · Platform admin · DesiAuction" };

/**
 * PX-9 §5 — Platform Health.
 *
 * Existing snapshots only: `runnerHealthSnapshot` (workers, queues, schedules),
 * `followerHealthSnapshot` (ingest), `providerHealthSnapshot` (dispatch
 * channels), `certificationSnapshot`, `complianceQueueSnapshot` (recent
 * failures + recovery). Administration renders these verdicts and never
 * second-guesses them — and, being read-only, offers no recovery BUTTON: the
 * recovery capability lives in the finance console, with the people who hold
 * `finops.operate`.
 */
export default async function AdminHealthPage() {
  if ((await platformAdminGate()) === null) {
    notFound();
  }
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <header className="dash-head">
          <h1>Platform health</h1>
          <p className="dash-hint">
            Workers, queues, ingest, dispatch, exports and certification — as the platforms
            themselves report them.
          </p>
        </header>
        <Suspense fallback={<LoadingState variant="page" />}>
          <Health />
        </Suspense>
      </div>
    </main>
  );
}

async function Health() {
  const health = await adminHealth();
  if (health === null) {
    notFound();
  }
  return <HealthPanel health={health} />;
}
