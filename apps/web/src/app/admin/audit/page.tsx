import { LoadingState } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { adminAudit } from "../../../server/admin/actions";
import { platformAdminGate } from "../../../server/admin/authz";
import type { AuditFilters } from "../../../server/admin/views";
import { AuditPanel } from "./audit-panel";
import "../../competitions/competitions.css";
import "../admin.css";

export const metadata = { title: "Audit · Platform admin · DesiAuction" };

/**
 * PX-9 §4 — the Audit Explorer.
 *
 * The audit log is APPEND-ONLY and this surface is a viewer: it filters and
 * reads. There is no event mutation here, and none is reachable from here —
 * `auditExplorer` is a select, and the module holds no writer to call.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if ((await platformAdminGate()) === null) {
    notFound();
  }
  const params = await searchParams;
  const one = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const filters: AuditFilters = {
    ...(one("q") !== undefined ? { q: one("q") } : {}),
    ...(one("action") !== undefined ? { action: one("action") } : {}),
    ...(one("actor") !== undefined ? { actor: one("actor") } : {}),
    ...(one("scopeId") !== undefined ? { scopeId: one("scopeId") } : {}),
    ...(one("from") !== undefined ? { from: one("from") } : {}),
    ...(one("to") !== undefined ? { to: one("to") } : {}),
  };
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <header className="dash-head">
          <h1>Audit</h1>
          <p className="dash-hint">
            Every audited action on the platform, newest first. Search matches the actor, the scope,
            the subject and the action — the whole correlation chain, from one box.
          </p>
        </header>
        <Suspense key={JSON.stringify(filters)} fallback={<LoadingState variant="page" />}>
          <Explorer filters={filters} />
        </Suspense>
      </div>
    </main>
  );
}

async function Explorer({ filters }: { filters: AuditFilters }) {
  const page = await adminAudit(filters);
  if (page === null) {
    notFound();
  }
  return <AuditPanel page={page} />;
}
