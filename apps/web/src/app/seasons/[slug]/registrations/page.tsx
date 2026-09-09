import { sportPackFor } from "@desiauction/core";
import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { registrationDashboard } from "../../../../server/competition/actions";
import { RegistrationDashboardPanel } from "./dashboard-panel";
import { ShareRegistration } from "./share-registration";
import "../../seasons.css";

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
    dashboard.teams === undefined
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
      <main className="registrations-dash">
        <div className="dash-stack">
          <ShareRegistration slug={slug} open={dashboard.registrationOpen} />
          <RegistrationDashboardPanel
            slug={slug}
            stats={dashboard.stats}
            page={dashboard.page}
            teams={dashboard.teams}
            orphanPreSigned={dashboard.orphanPreSigned ?? []}
            {...(dashboard.kit !== undefined ? { kit: dashboard.kit } : {})}
            // Plain {key,label} pairs: a pack carries functions and cannot
            // cross into a client component.
            roles={sportPackFor(dashboard.competition.sport).roles.values.map((value) => ({
              key: value.key,
              label: value.label,
            }))}
            rolesRequired={sportPackFor(dashboard.competition.sport).roles.required}
            registrationOpen={dashboard.registrationOpen}
            categoryFlags={dashboard.categoryFlags ?? {}}
            filters={{
              search: sp["q"] ?? "",
              status: sp["status"] ?? "",
              fee: sp["fee"] ?? "",
              team: sp["team"] ?? "",
              sort: sp["sort"] ?? "recent",
            }}
          />
        </div>
      </main>
    </ToastProvider>
  );
}
