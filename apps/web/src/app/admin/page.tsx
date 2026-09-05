import { Badge, LoadingState } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { adminOutcomes, adminOverview, adminSportCatalogue } from "../../server/admin/actions";
import { platformAdminPageGate } from "../../server/admin/authz";
import type { SportCatalogueRow } from "../../server/admin/views";
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
  if ((await platformAdminPageGate("overview")) === null) {
    notFound();
  }
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <header className="dash-head">
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
  const [overview, outcomes, catalogue] = await Promise.all([
    adminOverview(),
    adminOutcomes(),
    adminSportCatalogue(),
  ]);
  if (overview === null || outcomes === null || catalogue === null) {
    // Unreachable — the gate above already proved the grant. Fail closed anyway.
    notFound();
  }
  return (
    <>
      <OverviewPanel overview={overview} outcomes={outcomes} />
      <SportCatalogue rows={catalogue} />
    </>
  );
}

/**
 * WHICH SPORTS THIS PLATFORM RUNS (SP-1 Phase 1).
 *
 * Read-only, and that is the design rather than an unfinished screen. Enabling
 * a sport requires its pack to exist in code, so the flag can never usefully
 * move ahead of a deploy — and a toggle here would spend administration's
 * provable "cannot act" property on a two-row list. Migration 0046 seeds it.
 */
function SportCatalogue({ rows }: { rows: SportCatalogueRow[] }) {
  return (
    <section className="admin-card" aria-labelledby="admin-sports">
      <h2 id="admin-sports">Sports</h2>
      <p className="dash-hint">
        Which shipped packs are switched on. Seeded by migration — administration observes.
      </p>
      <ul className="admin-sport-list">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="admin-sport-name">{row.label}</span>
            <Badge tone={row.enabled ? "success" : "neutral"}>{row.enabled ? "live" : "off"}</Badge>
            <span className="admin-sport-count">
              {row.competitions} {row.competitions === 1 ? "season" : "seasons"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
