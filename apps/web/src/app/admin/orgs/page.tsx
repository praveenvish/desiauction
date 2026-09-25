import { LoadingState } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { adminOrganizations } from "../../../server/admin/actions";
import { platformAdminPageGate } from "../../../server/admin/authz";
import type { OrgFilter } from "../../../server/admin/views";
import { AdminPageHead } from "../admin-ui";
import { OrgsPanel } from "./orgs-panel";
import "../../seasons/seasons.css";
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
  searchParams: Promise<{ q?: string; filter?: string; after?: string }>;
}) {
  if ((await platformAdminPageGate("organizations")) === null) {
    notFound();
  }
  const { q, filter, after } = await searchParams;
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <AdminPageHead readOnly>Every club on the platform, and what it has done.</AdminPageHead>
        {/* Not keyed on the query: the filter form applies itself as you type,
            and a keyed boundary would remount it (and drop the caret) on every
            navigation. The old rows stay until the new ones land. */}
        <Suspense fallback={<LoadingState variant="page" />}>
          <Directory query={q} filter={filterOf(filter)} after={after} />
        </Suspense>
      </div>
    </main>
  );
}

async function Directory({
  query,
  filter,
  after,
}: {
  query: string | undefined;
  filter: OrgFilter;
  after: string | undefined;
}) {
  const directory = await adminOrganizations(query, filter, after);
  if (directory === null) {
    notFound();
  }
  return <OrgsPanel directory={directory} />;
}
