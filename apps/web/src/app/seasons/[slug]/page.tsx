import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { requireOnboarded } from "../../../server/auth/onboarding-gate";
import { seasonOverviewView } from "../../../server/competition/actions";
import { seasonPass } from "../../../server/competition/pass";
import { CreatedToast } from "./created-toast";
import { OverviewPanel } from "./overview-panel";
import { SeasonPassCard } from "./season-pass";
import "../seasons.css";
import "./_tabs/tabs.css";
import "./overview.css";

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
      {/* THE ONE <h1> ON THIS PAGE IS THE HERO'S. Every other season tab opens
          with the shell's page head (trail, title); on the overview the hero
          banner already says the season's name, over its cover photo, so the
          shell names nothing here — `pageIdentity` (nav.ts) decides that from
          the URL, on the server, so the HTML never carries a second h1. */}
      <main className="ov-page">
        <div className="ov-stack">
          <OverviewPanel
            view={view}
            slug={slug}
            // What the season's pass covers, and how close it is — visible at 2
            // of 4 teams, not only at the refusal. The pass is the club's
            // commercial arrangement, so it is shown only to the people who run
            // the season: a team owner was being shown "Season pass ·
            // Association" on a season they merely bid in.
            {...(pass === null || !view.viewer.canManage
              ? {}
              : { pass: <SeasonPassCard slug={slug} pass={pass} /> })}
          />
        </div>
      </main>
    </ToastProvider>
  );
}
