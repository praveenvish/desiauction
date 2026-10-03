import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { adminCanManagePeople, adminUsers } from "../../../server/admin/actions";
import { platformAdminPageGate } from "../../../server/admin/authz";
import { InvitePerson } from "./person-actions";
import { ROLE_OPTIONS } from "./role-options";
import { UsersPanel } from "./users-panel";
import "../../seasons/seasons.css";
import "../admin.css";
import { AdminPageHead } from "../admin-ui";

export const metadata = { title: "People · Platform admin" };

/**
 * PX-9 §3 / AC-1.2 — People. Gate first, then stream. Read for every admin;
 * a superadmin also gets Invite here and the controls on each person's page.
 */
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
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack admin-stack">
          <AdminPageHead readOnly={!(await adminCanManagePeople())}>
            Everyone on the platform, and what they hold.
          </AdminPageHead>
          {/* Rendered whole, not streamed under <Suspense>: these pages carry
              write controls, and a router.refresh() of a streamed boundary was
              only committed on the NEXT unrelated update — the page showed the
              old state for five seconds after every action (measured; AC-1). */}
          <Directory query={q} after={after} filter={filter} />
        </div>
      </main>
    </ToastProvider>
  );
}

// PI-1 P6: URL-driven facet, parsed fail-closed like every admin filter.
function parseUserFilter(
  value: string | undefined,
): "all" | "players" | "profiled" | "staff" | "suspended" {
  return value === "players" || value === "profiled" || value === "staff" || value === "suspended"
    ? value
    : "all";
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
  const [directory, canManage] = await Promise.all([
    adminUsers(query, after, parseUserFilter(filter)),
    adminCanManagePeople(),
  ]);
  if (directory === null) {
    notFound();
  }
  return (
    <UsersPanel
      directory={directory}
      paged={after !== undefined}
      {...(canManage ? { invite: <InvitePerson options={ROLE_OPTIONS} /> } : {})}
    />
  );
}
