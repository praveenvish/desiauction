import { IconBall, LoadingState, SectionCard } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  adminDeskQueue,
  adminOutcomes,
  adminOverview,
  adminSportCatalogue,
} from "../../server/admin/actions";
import { adminLiveNow } from "../../server/admin/live-watch";
import { platformAdminPageGate } from "../../server/admin/authz";
import type { SportCatalogueRow } from "../../server/admin/views";
import { AdminPageHead } from "./admin-ui";
import { OverviewPanel } from "./overview-panel";
import "../seasons/seasons.css";
import "./admin.css";
import "./overview.css";

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
        <AdminPageHead readOnly>
          The whole platform at a glance, as each part reports itself.
        </AdminPageHead>
        <Suspense fallback={<LoadingState variant="page" />}>
          <Board />
        </Suspense>
      </div>
    </main>
  );
}

async function Board() {
  const [overview, outcomes, catalogue, live, desks] = await Promise.all([
    adminOverview(),
    adminOutcomes(),
    adminSportCatalogue(),
    adminLiveNow(),
    adminDeskQueue(),
  ]);
  if (
    overview === null ||
    outcomes === null ||
    catalogue === null ||
    live === null ||
    desks === null
  ) {
    // Unreachable — the gate above already proved the grant. Fail closed anyway.
    notFound();
  }
  return (
    <>
      <OverviewPanel overview={overview} outcomes={outcomes} live={live} desks={desks} />
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
  const live = rows.filter((row) => row.enabled).length;
  return (
    <SectionCard
      icon={<IconBall />}
      concept="neutral"
      title="Sports"
      description={`${String(live)} of ${String(rows.length)} shipped packs switched on`}
    >
      <ul className="adm-sports">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="adm-sport-name">{row.label}</span>
            <span className="adm-sport-count" data-zero={row.competitions === 0 || undefined}>
              {row.competitions === 0
                ? "—"
                : `${String(row.competitions)} ${row.competitions === 1 ? "season" : "seasons"}`}
              {row.competitions === 0 ? <span className="admin-sr-only">0 seasons</span> : null}
            </span>
            {/* Twelve green "Live" pills said one thing twelve times: the state
                is a dot, and only an OFF sport spends a word. */}
            <span
              className="adm-sport-state"
              data-on={row.enabled || undefined}
              title={row.enabled ? "Live" : "Off"}
            >
              <span className="adm-sport-dot" aria-hidden />
              <span className={row.enabled ? "admin-sr-only" : undefined}>
                {row.enabled ? "Live" : "Off"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
