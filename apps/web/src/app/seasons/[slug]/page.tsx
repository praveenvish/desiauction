import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { competitionView } from "../../../server/competition/actions";
import { CompetitionPanel } from "./competition-panel";
import "../seasons.css";

export const metadata = { title: "Season · DesiAuction" };

export default async function CompetitionHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const view = await competitionView(slug);
  if (view === null) {
    // Non-members and unknown slugs are indistinguishable (tenancy, IP-2 pattern).
    notFound();
  }
  return (
    <ToastProvider>
      <main className="competition-home">
        <div className="competition-stack">
          <div className="competition-title-row">
            <h1 data-testid="competition-name">{view.competition.name}</h1>
            <span className="date-row">
              {view.viewer.canManage ? (
                <ButtonLink
                  href={`/seasons/${slug}/auction`}
                  variant="secondary"
                  data-testid="open-auction"
                >
                  Auction
                </ButtonLink>
              ) : null}
              {view.viewer.canManage ? (
                <ButtonLink
                  href={`/seasons/${slug}/fixtures`}
                  variant="secondary"
                  data-testid="open-fixtures"
                >
                  Fixtures
                </ButtonLink>
              ) : null}
              {view.viewer.canReview ? (
                <ButtonLink
                  href={`/seasons/${slug}/registrations`}
                  variant="secondary"
                  data-testid="open-dashboard"
                >
                  Manage registrations
                </ButtonLink>
              ) : null}
            </span>
          </div>
          <CompetitionPanel view={view} slug={slug} />
        </div>
      </main>
    </ToastProvider>
  );
}
