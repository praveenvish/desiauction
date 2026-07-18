import { LoadingState } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { adminOrganization } from "../../../../server/admin/actions";
import { platformAdminGate } from "../../../../server/admin/authz";
import { OrgDetailPanel } from "./org-detail-panel";
import "../../../competitions/competitions.css";
import "../../admin.css";

export const metadata = { title: "Organization · Platform admin · DesiAuction" };

/**
 * PX-9 §2 — organization drill-down: lifecycle, competitions, members, grants,
 * financial and settlement status, and the deep links out. Read-only; every
 * link leads to the console that owns the work, which re-gates on its own
 * capability (a platform admin is not thereby an organizer).
 */
export default async function AdminOrgPage({ params }: { params: Promise<{ slug: string }> }) {
  if ((await platformAdminGate()) === null) {
    notFound();
  }
  const { slug } = await params;
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <Suspense fallback={<LoadingState variant="page" />}>
          <Detail slug={slug} />
        </Suspense>
      </div>
    </main>
  );
}

async function Detail({ slug }: { slug: string }) {
  const detail = await adminOrganization(slug);
  if (detail === null) {
    notFound();
  }
  return <OrgDetailPanel detail={detail} />;
}
