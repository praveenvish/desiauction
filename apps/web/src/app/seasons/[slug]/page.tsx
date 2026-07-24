import { Badge, ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { PageTitle } from "../../../components/shell/page-title";
import { seasonOverviewView } from "../../../server/competition/actions";
import { OverviewPanel } from "./overview-panel";
import "../seasons.css";

export const metadata = { title: "Season · DesiAuction" };

const STATUS_TONE = {
  draft: "neutral",
  setup: "info",
  registration_open: "success",
  registration_closed: "warning",
} as const;

export default async function CompetitionHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const view = await seasonOverviewView(slug);
  if (view === null) {
    // Non-members and unknown slugs are indistinguishable (tenancy, IP-2 pattern).
    notFound();
  }
  const meta = [view.competition.location, view.orgName].filter(
    (part): part is string => part !== null && part !== "",
  );
  return (
    <ToastProvider>
      <main className="competition-home">
        <div className="competition-stack">
          {/* The season's name is the shell's h1, sticky above; the hero keeps
              the state of play — status, live pill, where and when. */}
          <PageTitle title={view.competition.name} testId="competition-name" />
          <header className="season-hero">
            <div className="season-hero-main">
              <div className="season-hero-title">
                <Badge tone={STATUS_TONE[view.competition.status]} data-testid="competition-status">
                  {view.competition.status.replace(/_/g, " ")}
                </Badge>
                {view.auctionLive ? <span className="season-live-pill">AUCTION LIVE</span> : null}
              </div>
              {meta.length > 0 ? <p className="season-hero-meta">{meta.join(" · ")}</p> : null}
            </div>
            <div className="season-hero-actions">
              {/* The design's secondary hero action. The `open-fixtures` hook
                  lives on the Fixtures TAB instead: it is reachable from every
                  season page, and one testid may only match one node. */}
              {view.viewer.canManage ? (
                <ButtonLink href={`/seasons/${slug}/fixtures`} variant="secondary">
                  Fixtures
                </ButtonLink>
              ) : null}
              {view.auctionLive ? (
                <ButtonLink href={`/seasons/${slug}/auction/live`}>Go to live auction →</ButtonLink>
              ) : null}
            </div>
          </header>
          <OverviewPanel view={view} slug={slug} />
        </div>
      </main>
    </ToastProvider>
  );
}
