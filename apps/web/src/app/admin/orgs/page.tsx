import { LoadingState } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { adminOrganizations } from "../../../server/admin/actions";
import { platformAdminGate } from "../../../server/admin/authz";
import type { OrgFilter } from "../../../server/admin/views";
import { OrgsPanel } from "./orgs-panel";
import "../../competitions/competitions.css";
import "../admin.css";

export const metadata = { title: "Organizations · Platform admin · DesiAuction" };

const FILTERS: readonly OrgFilter[] = ["all", "finance", "settling", "quiet"];

function filterOf(value: string | undefined): OrgFilter {
  return FILTERS.includes(value as OrgFilter) ? (value as OrgFilter) : "all";
}

/** PX-9 §2 — Organization Administration. Gate first, then stream. Read-only. */
export default async function AdminOrgsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  if ((await platformAdminGate()) === null) {
    notFound();
  }
  const { q, filter } = await searchParams;
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <header className="dash-head">
          <h1>Organizations</h1>
          <p className="dash-hint">
            Every organization on the platform, with what it has done. Follow a link to work in the
            organization&rsquo;s own console.
          </p>
        </header>
        <Suspense key={`${q ?? ""}-${filter ?? ""}`} fallback={<LoadingState variant="page" />}>
          <Directory query={q} filter={filterOf(filter)} />
        </Suspense>
      </div>
    </main>
  );
}

async function Directory({ query, filter }: { query: string | undefined; filter: OrgFilter }) {
  const directory = await adminOrganizations(query, filter);
  if (directory === null) {
    notFound();
  }
  return <OrgsPanel directory={directory} />;
}
