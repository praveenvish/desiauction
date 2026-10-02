import { LoadingState } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { adminOrganization, adminOrganizationExists } from "../../../../server/admin/actions";
import { platformAdminPageGate } from "../../../../server/admin/authz";
import { adminClubDesk } from "../../../../server/platform-ops/club-actions";
import { ClubDeskPanel } from "./club-desk-panel";
import { OrgDetailPanel } from "./org-detail-panel";
import "../../../seasons/seasons.css";
import "../../admin.css";

export const metadata = { title: "Organization · Platform admin" };

/**
 * PX-9 §2 — organization drill-down: lifecycle, competitions, members, grants,
 * financial and settlement status, and the deep links out. Read-only; every
 * link leads to the console that owns the work, which re-gates on its own
 * capability (a platform admin is not thereby an organizer).
 *
 * GATE, then EXIST, then stream: an unknown slug used to be discovered inside
 * the Suspense boundary, after the 200 had already been committed, so
 * `/admin/orgs/no-such-org-xyz` answered 200 to an admin and 404 to everyone
 * else.
 */
export default async function AdminOrgPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if ((await platformAdminPageGate("organization", slug)) === null) {
    notFound();
  }
  if (!(await adminOrganizationExists(slug))) {
    notFound();
  }
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
  const [detail, desk] = await Promise.all([adminOrganization(slug), adminClubDesk(slug)]);
  if (detail === null) {
    notFound();
  }
  return (
    <>
      <OrgDetailPanel detail={detail} />
      {/* AC-1.3: the superadmin's controls for a stuck club. */}
      {desk === null ? null : (
        <ClubDeskPanel
          slug={slug}
          clubName={detail.org.name}
          desk={desk}
          members={detail.members.map((member) => ({
            personId: member.personId,
            name: member.name,
          }))}
        />
      )}
    </>
  );
}
