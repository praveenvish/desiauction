import { LoadingState } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { adminUsers } from "../../../server/admin/actions";
import { platformAdminPageGate } from "../../../server/admin/authz";
import { UsersPanel } from "./users-panel";
import "../../seasons/seasons.css";
import "../admin.css";

export const metadata = { title: "Users · Platform admin · DesiAuction" };

/** PX-9 §3 — User Administration. Gate first, then stream. Read-only. */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; after?: string; filter?: string }>;
}) {
  if ((await platformAdminPageGate("users")) === null) {
    notFound();
  }
  const { q, after, filter } = await searchParams;
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <header className="dash-head">
          <p className="dash-hint">
            Everyone on the platform, and what they hold. Grants are shown as the capability sets
            they actually are.
          </p>
        </header>
        <Suspense
          key={`${q ?? ""}-${after ?? ""}-${filter ?? ""}`}
          fallback={<LoadingState variant="page" />}
        >
          <Directory query={q} after={after} filter={filter} />
        </Suspense>
      </div>
    </main>
  );
}

// PI-1 P6: URL-driven facet, parsed fail-closed like every admin filter.
function parseUserFilter(value: string | undefined): "all" | "players" | "profiled" {
  return value === "players" || value === "profiled" ? value : "all";
}

async function Directory({
  query,
  after,
  filter,
}: {
  query: string | undefined;
  after: string | undefined;
  filter: string | undefined;
}) {
  const directory = await adminUsers(query, after, parseUserFilter(filter));
  if (directory === null) {
    notFound();
  }
  return <UsersPanel directory={directory} />;
}
