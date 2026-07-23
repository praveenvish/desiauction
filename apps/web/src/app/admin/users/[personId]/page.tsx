import { LoadingState } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { adminUser } from "../../../../server/admin/actions";
import { platformAdminGate } from "../../../../server/admin/authz";
import { UserDetailPanel } from "./user-detail-panel";
import "../../../seasons/seasons.css";
import "../../admin.css";

export const metadata = { title: "User · Platform admin · DesiAuction" };

/** PX-9 §3 — the user inspector: grants, memberships, recent activity. Read-only. */
export default async function AdminUserPage({ params }: { params: Promise<{ personId: string }> }) {
  if ((await platformAdminGate()) === null) {
    notFound();
  }
  const { personId } = await params;
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
