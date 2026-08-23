import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { PageTitle } from "../../../components/shell/page-title";
import { requireOnboarded } from "../../../server/auth/onboarding-gate";
import { seasonOverviewView } from "../../../server/competition/actions";
import { seasonPass } from "../../../server/competition/pass";
import { CreatedToast } from "./created-toast";
import { OverviewPanel } from "./overview-panel";
import { SeasonPassCard } from "./season-pass";
import "../seasons.css";

export const metadata = { title: "Season · DesiAuction" };

export default async function CompetitionHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // See /seasons: the public children under [slug] rule out a gate layout here.
  await requireOnboarded();
  const [view, pass] = await Promise.all([seasonOverviewView(slug), seasonPass(slug)]);
  if (view === null) {
    // Non-members and unknown slugs are indistinguishable (tenancy, IP-2 pattern).
    notFound();
  }
  return (
    <ToastProvider>
      <CreatedToast />
      <main className="competition-home">
        <div className="competition-stack">
          {/* The season's name is the shell's h1, sticky above; the hero keeps
              the state of play — status, live pill, where and when. The hero
              itself moved into the panel: its secondary action and its "Season
              details" trigger both depend on the panel's own state (DA-11). */}
          <PageTitle title={view.competition.name} testId="competition-name" />
          <OverviewPanel view={view} slug={slug} />
          {/* What the season's pass covers, and how close it is — visible at 2
              of 4 teams, not only at the refusal. */}
          {pass === null ? null : <SeasonPassCard slug={slug} pass={pass} />}
        </div>
      </main>
    </ToastProvider>
  );
}
