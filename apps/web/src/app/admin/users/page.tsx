import { LoadingState } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { adminUsers } from "../../../server/admin/actions";
import { platformAdminGate } from "../../../server/admin/authz";
import { UsersPanel } from "./users-panel";
import "../../competitions/competitions.css";
import "../admin.css";

export const metadata = { title: "Users · Platform admin · DesiAuction" };

/** PX-9 §3 — User Administration. Gate first, then stream. Read-only. */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  if ((await platformAdminGate()) === null) {
    notFound();
  }
  const { q } = await searchParams;
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <header className="dash-head">
          <h1>Users</h1>
          <p className="dash-hint">
            Everyone on the platform, and what they hold. Grants are shown as the capability sets
            they actually are.
          </p>
        </header>
        <Suspense key={q ?? ""} fallback={<LoadingState variant="page" />}>
          <Directory query={q} />
        </Suspense>
      </div>
    </main>
  );
}

async function Directory({ query }: { query: string | undefined }) {
  const directory = await adminUsers(query);
  if (directory === null) {
    notFound();
  }
  return <UsersPanel directory={directory} />;
}
