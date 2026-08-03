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
  searchParams: Promise<{ q?: string; after?: string }>;
}) {
  if ((await platformAdminPageGate("users")) === null) {
    notFound();
  }
  const { q, after } = await searchParams;
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <header className="dash-head">
          <p className="dash-hint">
            Everyone on the platform, and what they hold. Grants are shown as the capability sets
            they actually are.
          </p>
        </header>
        <Suspense key={`${q ?? ""}-${after ?? ""}`} fallback={<LoadingState variant="page" />}>
          <Directory query={q} after={after} />
        </Suspense>
      </div>
    </main>
  );
}

async function Directory({
  query,
  after,
}: {
  query: string | undefined;
  after: string | undefined;
}) {
  const directory = await adminUsers(query, after);
  if (directory === null) {
    notFound();
  }
  return <UsersPanel directory={directory} />;
}
