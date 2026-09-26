import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { registrationDashboard } from "../../../../server/competition/actions";
import { RegistrationDashboardPanel } from "./dashboard-panel";
import { ShareRegistration } from "./share-registration";
import "../../seasons.css";
import "./registrations.css";

export const metadata = { title: "Registrations · DesiAuction" };

export default async function RegistrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const dashboard = await registrationDashboard(slug, {
    ...(sp["q"] !== undefined ? { search: sp["q"] } : {}),
    ...(sp["status"] !== undefined ? { status: sp["status"] } : {}),
    ...(sp["fee"] !== undefined ? { fee: sp["fee"] } : {}),
    ...(sp["team"] !== undefined ? { teamId: sp["team"] } : {}),
    ...(sp["role"] !== undefined ? { role: sp["role"] } : {}),
    ...(sp["sort"] !== undefined ? { sort: sp["sort"] } : {}),
    ...(sp["page"] !== undefined ? { page: sp["page"] } : {}),
  });
  if (dashboard === null) {
    notFound();
  }
  // DA-30: `page` is ABSENT without `registration.review` — the refusal below is
  // no longer a caption over a payload that already carried every applicant's
  // name, phone, age and photo URL. The two conditions are the same condition;
  // both are tested so the type narrows and the leak cannot come back by
  // someone rendering the panel above this guard.
  if (
    !dashboard.viewer.canReview ||
    dashboard.page === undefined ||
    dashboard.stats === undefined ||
    dashboard.teams === undefined ||
    dashboard.desk === undefined
  ) {
    return (
      <main className="registrations-dash">
        <div className="competitions-stack">
          <p role="alert" className="competitions-hint">
            You don&apos;t have permission to review registrations for this season.
          </p>
        </div>
      </main>
    );
  }
  return (
    <ToastProvider>
      <main className="registrations-dash rd-page">
        <div className="dash-stack rd-stack">
          <RegistrationDashboardPanel
            share={
              <ShareRegistration
                slug={slug}
                open={dashboard.registrationOpen}
                seasonName={dashboard.competition.name}
              />
            }
            canReopen={
              dashboard.viewer.canManage === true &&
              dashboard.competition.status === "registration_closed" &&
              !dashboard.desk.rosterLocked
            }
            slug={slug}
            stats={dashboard.stats}
            page={dashboard.page}
            teams={dashboard.teams}
            orphanPreSigned={dashboard.orphanPreSigned ?? []}
            {...(dashboard.kit !== undefined ? { kit: dashboard.kit } : {})}
            desk={dashboard.desk}
            registrationOpen={dashboard.registrationOpen}
            categoryFlags={dashboard.categoryFlags ?? {}}
            {...(sp["player"] !== undefined ? { initialPlayerId: sp["player"] } : {})}
            startReview={sp["review"] === "1"}
            filters={{
              search: sp["q"] ?? "",
              status: sp["status"] ?? "",
              fee: sp["fee"] ?? "",
              team: sp["team"] ?? "",
              role: sp["role"] ?? "",
              sort: sp["sort"] ?? "recent",
            }}
          />
        </div>
      </main>
    </ToastProvider>
  );
}
