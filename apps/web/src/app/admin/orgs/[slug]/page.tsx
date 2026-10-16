import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { adminOrganization, adminOrganizationExists } from "../../../../server/admin/actions";
import { platformAdminPageGate } from "../../../../server/admin/authz";
import { adminClubDesk, adminMoveDesk } from "../../../../server/platform-ops/club-actions";
import { OrgDesk } from "./org-desk";
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
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack admin-stack">
          {/* Rendered whole, not streamed under <Suspense>: these pages carry
              write controls, and a router.refresh() of a streamed boundary was
              only committed on the NEXT unrelated update — the page showed the
              old state for five seconds after every action (measured; AC-1). */}
          <Detail slug={slug} />
        </div>
      </main>
    </ToastProvider>
  );
}

async function Detail({ slug }: { slug: string }) {
  const [detail, desk, move] = await Promise.all([
    adminOrganization(slug),
    adminClubDesk(slug),
    adminMoveDesk(slug),
  ]);
  if (detail === null) {
    notFound();
  }
  const panel = <OrgDetailPanel detail={detail} desk={desk} move={move} />;
  // AC-1.3: a superadmin's controls sit on the rows they act on. Without the
  // desk (a read-only admin) the same page renders with no buttons.
  if (desk === null) {
    return panel;
  }
  return (
    <OrgDesk
      slug={slug}
      clubName={detail.org.name}
      members={detail.members.map((member) => ({ personId: member.personId, name: member.name }))}
      clubs={move?.clubs ?? []}
    >
      {panel}
    </OrgDesk>
  );
}
