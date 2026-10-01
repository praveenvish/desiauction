import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { currentSession } from "../../../server/auth/actions";
import { requireOnboarded } from "../../../server/auth/onboarding-gate";
import { rolesOf } from "../../../server/roles/roles";
import { seasonOverviewView } from "../../../server/competition/actions";
import { seasonPass } from "../../../server/competition/pass";
import {
  finaleView,
  scheduleView,
  standingsView,
} from "../../../server/competition/fixture-actions";
import { nowWallClock } from "../../../server/competition/fixtures";
import { ChampionCard } from "./champion-card";
import { SeasonNow } from "./season-now";
import { YourTeam } from "./your-team";
import { teamSeason } from "../../../server/player/career";
import { awaitsResult } from "./_tabs/fixture-status";
import { istCalendarDate } from "../../../lib/format-date";
import { CreatedToast } from "./created-toast";
import { OverviewPanel } from "./overview-panel";
import { SeasonPassCard } from "./season-pass";
import "../seasons.css";
import "./_tabs/tabs.css";
import "./overview.css";

export const metadata = { title: "Season" };

export default async function CompetitionHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // See /seasons: the public children under [slug] rule out a gate layout here.
  await requireOnboarded();
  const session = await currentSession();
  const [view, pass, roles] = await Promise.all([
    seasonOverviewView(slug),
    seasonPass(slug),
    session === null ? null : rolesOf(session.personId),
  ]);
  // The viewer's own team(s) here, marked in the Teams list the way /teams
  // marks "Your team" (review r2, r3). Identity only — no new figures.
  const mineTeamIds = (roles?.owns ?? [])
    .filter((team) => team.competitionSlug === slug)
    .map((team) => team.teamId);
  if (view === null) {
    // Non-members and unknown slugs are indistinguishable (tenancy, IP-2 pattern).
    notFound();
  }
  // Once matches exist, the overview shows what is on and who is top — read
  // from the same views the Schedule and Table tabs render.
  // The owner's own team, once the room has run: `teamSeason` takes a team id
  // the SERVER resolved from the session's roles, never one from the request.
  const ownTeam = view.topTeams.find((team) => mineTeamIds.includes(team.teamId));
  const auctionOver = view.auctionStatus === "completed" || view.auctionStatus === "reconciled";
  const today = istCalendarDate();
  const [schedule, standings, ownSeason] = await Promise.all([
    view.fixtureCount > 0 ? scheduleView(slug, {}) : null,
    view.fixtureCount > 0 ? standingsView(slug) : null,
    ownTeam !== undefined && auctionOver && !view.viewer.canManage
      ? teamSeason(ownTeam.teamId, today)
      : null,
  ]);
  // Live is today's: a match left open from an earlier day awaits a result.
  const liveMatches =
    schedule?.rows.filter((row) => row.status === "in_progress" && !awaitsResult(row, today))
      .length ?? 0;
  const dueMatches = schedule?.rows.filter((row) => awaitsResult(row, today)).length ?? 0;
  // Name the champion (PR12): for the people who run the season, once every
  // match is done — or to show who was named.
  const finale =
    view.viewer.canManage && view.fixtureCount > 0 && view.fixturesOpen === 0
      ? await finaleView(slug)
      : null;
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
            mineTeamIds={mineTeamIds}
            liveMatches={liveMatches}
            dueMatches={dueMatches}
            {...(ownTeam !== undefined
              ? {
                  yours: (
                    <YourTeam
                      slug={slug}
                      team={{
                        id: ownTeam.teamId,
                        name: ownTeam.name,
                        shortName: ownTeam.shortName,
                        color: ownTeam.color,
                      }}
                      season={ownSeason}
                      today={today}
                    />
                  ),
                }
              : {})}
            {...(finale === null ? {} : { finale: <ChampionCard slug={slug} state={finale} /> })}
            now={
              view.fixtureCount > 0 ? (
                <SeasonNow
                  slug={slug}
                  schedule={schedule}
                  standings={standings}
                  now={nowWallClock()}
                  mine={mineTeamIds}
                />
              ) : null
            }
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
