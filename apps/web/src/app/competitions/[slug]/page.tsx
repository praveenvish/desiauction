import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { competitionView } from "../../../server/competition/actions";
import { CompetitionPanel } from "./competition-panel";
import "../competitions.css";

export const metadata = { title: "Competition · DesiAuction" };

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
          <h1 data-testid="competition-name">{view.competition.name}</h1>
          <CompetitionPanel view={view} slug={slug} />
        </div>
      </main>
    </ToastProvider>
  );
}
