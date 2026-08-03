import { LoadingState } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { adminPersonExists, adminUser } from "../../../../server/admin/actions";
import { platformAdminPageGate } from "../../../../server/admin/authz";
import { UserDetailPanel } from "./user-detail-panel";
import "../../../seasons/seasons.css";
import "../../admin.css";

export const metadata = { title: "User · Platform admin · DesiAuction" };

/**
 * PX-9 §3 — the user inspector: grants, memberships, recent activity. Read-only.
 *
 * GATE, then EXIST, then stream. The record check used to live inside the
 * Suspense boundary, which had already committed HTTP 200 — so
 * `/admin/users/00000000000000000000000000` and `/admin/users/NOTAULID` both
 * returned 200 with a "this page doesn't exist" body, while the same URL
 * returned a hard 404 to a non-admin. Not a corner case: the audit explorer
 * links every actor to this route, and 704 of 3,720 audit rows name an actor
 * who is not in `people` — the nil-ULID system actor authors 65 of them.
 */
export default async function AdminUserPage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  if ((await platformAdminPageGate("user", personId)) === null) {
    notFound();
  }
  if (!(await adminPersonExists(personId))) {
    notFound();
  }
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <Suspense fallback={<LoadingState variant="page" />}>
          <Detail personId={personId} />
        </Suspense>
      </div>
    </main>
  );
}

async function Detail({ personId }: { personId: string }) {
  const detail = await adminUser(personId);
  if (detail === null) {
    notFound();
  }
  return <UserDetailPanel detail={detail} />;
}
