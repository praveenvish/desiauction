import {
  ButtonLink,
  IconGavel,
  IconPlay,
  IconUser,
  Pill,
  SectionCard,
  ToastProvider,
  type KitTone,
} from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageTitle } from "../../../../components/shell/page-title";
import { auctionDashboard } from "../../../../server/auction/actions";
import { auctioneerPanelView } from "../../../../server/auction/auctioneer-actions";
import { practiceCardView } from "../../../../server/auction/practice-actions";
import { appointmentsPanelView } from "../../../../server/competition/appointment-actions";
import { requireOnboarded } from "../../../../server/auth/onboarding-gate";
import { standingsView } from "../../../../server/competition/fixture-actions";
import { teamsWorkspaceView } from "../../../../server/competition/actions";
import { PublishByHand } from "../teams/hand-entry";
import { ResultsSheet } from "../teams/results-sheet";
import "../teams/teams.css";
import { AuctionPanel } from "./auction-panel";
import { AuctioneerPanel } from "./auctioneer-panel";
import { PracticeCard } from "./practice-card";
import "../../seasons.css";
// The hub renders <BroadcastLinks>, and every rule that dresses it —
// `.broadcast-row`, `.share-auction-button`, `.broadcast-url` — lives in
// auction.css, which each of the eight SIBLING auction routes imports and this
// one did not. Three separate defects were the same missing line: "Open board"
// painted the user agent's #0000EE (1.92:1 on the floodlit surface), it was 19px
// tall instead of the 44px its rule specifies, and the un-wrapped board URL
// scrolled the whole page sideways at 320px.
import "./auction.css";
import "./plan/plan.css";

export const metadata = { title: "Auction" };

/**
 * The header used to key off "an auction row exists" — so a COMPLETED auction
 * and a SCHEDULED one both wore the LIVE pill, the gold "Go live" button and
 * the title "Live auction", while the truth (SCHEDULED / COMPLETED) sat some
 * 1,500px further down the same page. Everything above the fold is now keyed
 * off the status itself.
 */
const TITLE_OF: Record<string, string> = {
  scheduled: "Auction setup",
  live: "Live auction",
  paused: "Auction paused",
  completed: "Auction results",
  reconciled: "Auction settled",
  abandoned: "Auction abandoned",
};

// Labels are the status words themselves (capitalized in CSS): the pill is
// also the page's one machine-readable status, `auction-status`.
const PILL_OF: Record<string, { label: string; tone: KitTone }> = {
  scheduled: { label: "scheduled", tone: "neutral" },
  live: { label: "live", tone: "green" },
  paused: { label: "paused", tone: "amber" },
  completed: { label: "completed", tone: "green" },
  reconciled: { label: "settled", tone: "green" },
  abandoned: { label: "abandoned", tone: "red" },
};

export default async function AuctionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // See /seasons: `auction/spectate` next door is public, so no gate layout.
  await requireOnboarded();
  const [dashboard, auctioneers, appointments, table, practice] = await Promise.all([
    auctionDashboard(slug),
    auctioneerPanelView(slug),
    // Captains & icons still to be told — null unless this viewer may set them.
    appointmentsPanelView(slug),
    // How the squads are doing since the night (census 18) — the same read as
    // the Table tab, so the two cannot disagree.
    standingsView(slug),
    // The practice auction (0101) — the season's managers only, before the night.
    practiceCardView(slug),
  ]);
  if (dashboard === null) {
    notFound();
  }
  const status = dashboard.view?.auction.status ?? null;
  const title = status === null ? null : (TITLE_OF[status] ?? null);
  const pill = status === null ? null : (PILL_OF[status] ?? null);
  // "Go live" leads to a room that is actually open. Before that there is
  // nothing to watch, and after it there is nothing to bid on.
  const inProgress = status === "live" || status === "paused";
  // 0110: declared in Season details — the night happens somewhere else, so
  // there is no room to set up here, only results to type in.
  const imported =
    dashboard.competition.auctionSource === "imported" &&
    (status === null || status === "abandoned");
  // A season run offline types its results in HERE: the Auction tab used to
  // say "go to the Teams tab", a dead end on the one tab named for the job
  // (founder, 2026-10-06). The same list as Teams → "Type results in one list".
  const resultsDesk =
    imported && dashboard.viewer.canManage ? await teamsWorkspaceView(slug) : null;
  const typing =
    resultsDesk !== null &&
    resultsDesk.handEntry === "open" &&
    resultsDesk.viewer.canSeeRoster &&
    resultsDesk.teams.length > 0
      ? resultsDesk
      : null;
  const rows = table?.standings.rows ?? [];
  const standing = rows.some((row) => row.played > 0)
    ? Object.fromEntries(
        rows.map((row, index) => [
          row.teamId,
          { position: index + 1, points: row.points, played: row.played },
        ]),
      )
    : undefined;
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          {/* An auction renames the surface — the tab still says "Auction",
              the title says what is happening on it, which is not always
              "live". */}
          {title !== null ? <PageTitle title={title} /> : null}
          {/* Before an auction exists every control here is absent, and the
              empty header drew a stray rule and a blank band at the top. */}
          {status !== null ? (
            <header className="auc-head">
              {pill !== null ? (
                <span className="auc-status">
                  <Pill tone={pill.tone} dot testId="auction-status">
                    {pill.label}
                  </Pill>
                </span>
              ) : null}
              <div className="auc-head-actions">
                <span className="date-row">
                  {inProgress ? (
                    <ButtonLink
                      href={`/seasons/${slug}/auction/live`}
                      variant="secondary"
                      size="sm"
                      data-testid="open-live"
                    >
                      <IconPlay size={16} />
                      Go live
                    </ButtonLink>
                  ) : null}
                  {status !== "completed" &&
                  status !== "reconciled" &&
                  status !== "abandoned" &&
                  dashboard.viewer.canConduct ? (
                    <ButtonLink
                      href={`/seasons/${slug}/auction/cockpit`}
                      variant="secondary"
                      size="sm"
                      data-testid="open-cockpit"
                    >
                      <IconGavel size={16} />
                      Cockpit
                    </ButtonLink>
                  ) : null}
                  {/* WR-1: the owner's private plan. Shown only to someone who holds a
                    team in this auction, and only while planning is switched on —
                    `planView` 404s for everyone else, so the door must not exist for
                    them either. */}
                  {dashboard.viewer.planAvailable ? (
                    <ButtonLink
                      href={`/seasons/${slug}/auction/plan`}
                      variant="secondary"
                      size="sm"
                      data-testid="open-plan"
                    >
                      <IconUser size={16} />
                      My plan
                    </ButtonLink>
                  ) : null}
                  {/* "Review the night" and "Share results" used to sit here AND
                    in the After-the-auction card below, gated identically — so a
                    finished night showed each door twice. The card (with its
                    icons, notes and the pending dot) is now their one home. */}
                </span>
              </div>
            </header>
          ) : null}
          {practice !== null && status === "scheduled" ? (
            <PracticeCard slug={slug} card={practice} />
          ) : null}
          {/* 0105: before any auction, the other road — it already happened. */}
          {(status === null || status === "abandoned") &&
          !imported &&
          dashboard.viewer.canManage ? (
            <p className="auc-hand-hint" data-testid="auction-hand-hint">
              Auction already held outside the app?{" "}
              <Link href={`/seasons/${slug}/teams`}>Add the results on the Teams tab</Link> to get
              posters and team cards.
            </p>
          ) : null}
          {/* A night set up here but run somewhere else: hand entry opens once
              the scheduled auction is aborted (an aborted auction is no
              auction — team-workspace.ts), and this is the only place that
              says so. */}
          {status === "scheduled" && dashboard.viewer.canManage ? (
            <p className="auc-hand-hint" data-testid="auction-hand-hint-scheduled">
              Held the auction outside the app instead? Abort this auction at the bottom of the
              page, then{" "}
              <Link href={`/seasons/${slug}/teams`}>add the results on the Teams tab</Link>.
            </p>
          ) : null}
          {/* Posters exist before the hammer too (the season poster and each
              team's "meet the squad"), but every door to them used to open
              only after a finished night. */}
          {(status === null || status === "scheduled" || status === "abandoned") &&
          !imported &&
          dashboard.viewer.canPoster ? (
            <p className="auc-hand-hint" data-testid="auction-posters-door">
              <Link href={`/seasons/${slug}/posters`}>Make posters</Link> — the season poster and
              each team&apos;s squad, ready to share before the auction.
            </p>
          ) : null}
          {typing !== null ? (
            <>
              <ResultsSheet
                slug={slug}
                teams={typing.teams.map((team) => ({
                  id: team.id,
                  name: team.name,
                  color: team.color,
                }))}
                roleLabels={Object.fromEntries(typing.roles.map((role) => [role.key, role.label]))}
                heading="Auction results"
              />
              <PublishByHand slug={slug} teams={typing.teams} imported inList />
              {dashboard.viewer.canPoster ? (
                <p className="auc-hand-hint" data-testid="auction-posters-door">
                  <Link href={`/seasons/${slug}/posters`}>Make posters</Link> — squad posters and
                  player cards update as you type the results in.
                </p>
              ) : null}
            </>
          ) : imported ? (
            <SectionCard
              icon={<IconGavel />}
              title="Auction held outside DesiAuction"
              description="Add each team's players and prices on the Teams tab. The public squad pages show them as you go; publish when every team is complete to finish the season's results. To run the auction here instead, change it in Season details."
              data-testid="auction-imported"
            >
              <span className="date-row">
                <ButtonLink href={`/seasons/${slug}/teams`} size="sm">
                  <IconUser size={16} />
                  Add results on the Teams tab
                </ButtonLink>
              </span>
            </SectionCard>
          ) : dashboard.view?.auction.enteredByHand === true ? (
            /* No room ran, so there is no bidding to review — just what was
               typed in, and where it is used. */
            <SectionCard
              icon={<IconGavel />}
              title="Results entered by hand"
              description={`This auction was held outside the app. ${String(dashboard.view.lotStats.sold)} player${dashboard.view.lotStats.sold === 1 ? "" : "s"} bought with a price, ${String(dashboard.view.lotStats.unsold)} unsold. The squads are final.`}
              data-testid="auction-by-hand"
            >
              <span className="date-row">
                <ButtonLink href={`/seasons/${slug}/teams`} variant="secondary" size="sm">
                  <IconUser size={16} />
                  See the teams
                </ButtonLink>
                {dashboard.viewer.canPoster ? (
                  <ButtonLink href={`/seasons/${slug}/posters`} size="sm">
                    Make posters
                  </ButtonLink>
                ) : null}
              </span>
            </SectionCard>
          ) : (
            <AuctionPanel
              slug={slug}
              dashboard={dashboard}
              appointments={appointments}
              {...(standing !== undefined ? { standing } : {})}
              auctioneersSlot={
                auctioneers !== null ? (
                  <AuctioneerPanel key="auctioneers" slug={slug} view={auctioneers} />
                ) : null
              }
            />
          )}
        </div>
      </main>
    </ToastProvider>
  );
}
