import { ButtonLink, IconArrowRight } from "@desiauction/ui";
import Link from "next/link";
import { Fragment } from "react";

import { FormDialog } from "../../components/form-dialog";
import { roleLabeller } from "../../lib/role-label";
import { auctionDashboard } from "../../server/auction/actions";
import { competitionsView } from "../../server/competition/actions";
import { organizerScheduleView } from "../../server/competition/fixture-actions";
import { homeDashboard } from "../../server/home/dashboard";
import { CreateOrgForm } from "../orgs/create-org-form";
import { CreateTournamentForm } from "../tournaments/create-tournament-form";
import { HomeShortcuts } from "./home-shortcuts";
import type { NextStep } from "./next-step";
import { NextStepBanner } from "./next-step-banner";
import { OrganizerPanels } from "./organizer-panels";
import {
  ATTENTION_SCAN_LIMIT,
  SetupLadder,
  attentionFor,
  lifecycleFor,
  rupees,
  rupeesShort,
  type AttentionRow,
  type SetupRung,
} from "./organizer-parts";

/**
 * THE ORGANIZER'S HOME — the club's whole operation on one screen.
 *
 * This is the dashboard /home used to hand to everybody, including the team
 * owners and players who could not act on a single figure in it. It is now
 * rendered only for people who hold `org:owner` or `org:staff` somewhere, and
 * it loads its own data: before RN-1 Phase 3 a player's visit ran the season
 * scan, the money roll-up and the activity feed to render none of them.
 *
 * Its one job (RN-1 §0): unblock the next thing. Everything above the fold is
 * either the night in progress or what is waiting on this person.
 */

export async function OrganizerHome({
  nextStepFor,
}: {
  /** The router owns the one next step, across every role this person holds. */
  nextStepFor: (input: {
    managedLive: { competitionSlug: string; competitionName: string } | null;
    attention: AttentionRow[];
  }) => NextStep | null;
}) {
  const [view, schedule, dash] = await Promise.all([
    competitionsView(),
    organizerScheduleView(),
    homeDashboard(),
  ]);

  const liveRow = dash.auctions.find((auction) => auction.status === "live") ?? null;
  const otherAuctions = dash.auctions.filter((auction) => auction.auctionId !== liveRow?.auctionId);

  const scanned = view.competitions.slice(0, ATTENTION_SCAN_LIMIT);
  const [liveBoard, scannedRows] = await Promise.all([
    liveRow === null
      ? Promise.resolve(null)
      : auctionDashboard(liveRow.competitionSlug).then((board) => board?.overview ?? null),
    Promise.all(scanned.map((competition) => attentionFor(competition, dash))),
  ]);
  const attention = scannedRows.filter((row): row is AttentionRow => row !== null);
  const unscanned = view.competitions.length - scanned.length;

  const chartMax = Math.max(...dash.money.thisWeek, ...dash.money.lastWeek, 0);

  const totalTeams = Object.values(dash.counts).reduce((sum, row) => sum + row.teams, 0);
  const seasonNeedingTeams =
    view.competitions.find((competition) => (dash.counts[competition.id]?.teams ?? 0) === 0) ??
    view.competitions[0];
  const seasonToOpen =
    view.competitions.find((competition) => competition.status !== "registration_open") ??
    view.competitions[0];

  const rungs: SetupRung[] = [
    {
      key: "org",
      title: "Create your club",
      blurb: "The organization that owns your tournaments.",
      done: view.orgs.length > 0,
      cta: (
        <FormDialog
          title="New organization"
          triggerLabel="Create your organization"
          size="touch"
          triggerTestId="home-create-org"
        >
          <CreateOrgForm />
        </FormDialog>
      ),
    },
    {
      key: "tournament",
      title: "Name your tournament",
      blurb: "The recurring competition — your league, not one edition of it.",
      done: dash.tournaments > 0,
      cta: (
        <FormDialog
          title="New tournament"
          triggerLabel="Create a tournament"
          size="touch"
          triggerTestId="home-ladder-tournament"
        >
          <CreateTournamentForm orgs={view.orgs} />
        </FormDialog>
      ),
    },
    {
      key: "season",
      title: "Add this year's season",
      blurb: "The edition that actually runs, with its own dates and teams.",
      done: dash.stats.competitions > 0,
      cta: (
        <ButtonLink href="/tournaments" size="touch">
          Add a season
        </ButtonLink>
      ),
    },
    {
      key: "teams",
      title: "Add the teams that will bid",
      blurb: "Auction night needs at least two teams holding paddles.",
      done: totalTeams > 0,
      cta:
        seasonNeedingTeams === undefined ? null : (
          <ButtonLink href={`/seasons/${seasonNeedingTeams.slug}/teams`} size="touch">
            Add teams
          </ButtonLink>
        ),
    },
    {
      key: "registrations",
      title: "Open registration",
      blurb: "Players sign up, you approve them, and they become the auction pool.",
      done: dash.stats.registrations > 0,
      cta:
        seasonToOpen === undefined ? null : (
          <ButtonLink href={`/seasons/${seasonToOpen.slug}`} size="touch">
            Open registration
          </ButtonLink>
        ),
    },
  ];
  const currentRung = rungs.findIndex((rung) => !rung.done);
  const laddering = currentRung !== -1 && !(rungs[rungs.length - 1]?.done ?? false);

  const nextStep = laddering
    ? null
    : nextStepFor({
        managedLive:
          liveRow !== null
            ? { competitionSlug: liveRow.competitionSlug, competitionName: liveRow.competitionName }
            : null,
        attention,
      });

  const moneyTotal =
    dash.money.collectedPaise + dash.money.outstandingPaise + dash.money.waivedPaise;
  const chartDays = [...dash.money.thisWeek, ...dash.money.lastWeek].filter(
    (value) => value > 0,
  ).length;
  const showChart = chartDays >= 2;
  const restAttention = nextStep?.key === "organizer-attention" ? attention.slice(1) : attention;
  const showAttention = !laddering && (nextStep === null || restAttention.length > 0);
  const showMoney = moneyTotal > 0;
  const showSeasons = dash.top.length > 0;
  const showAuctions = otherAuctions.length > 0 || (!laddering && liveRow === null);
  const showEvents = schedule.length > 0 || !laddering;
  const showActivity = dash.activity.length > 0;
  const showLeft = showAttention || showMoney || showSeasons;
  const showRight = showAuctions || showEvents || showActivity;
  const liveDone =
    liveRow !== null && liveRow.lotsTotal > 0 && liveRow.lotsSold === liveRow.lotsTotal;

  return (
    <>
      {laddering ? <SetupLadder rungs={rungs} current={currentRung} /> : null}
      {nextStep !== null ? <NextStepBanner step={nextStep} /> : null}
      {/* ---- the night in progress: nothing outranks a live auction ---- */}
      {liveRow !== null ? (
        <section
          className={`home-live${liveDone ? " home-live--done" : ""}`}
          aria-labelledby="home-live-name"
          data-testid="home-live"
        >
          <div className="home-live-body">
            <p className="home-live-kicker">
              {/* Every lot has gone. The hero still said LIVE NOW over a
                      100% progress bar with one CTA into the room, which is the
                      one state where "live" is the wrong word: the bidding is
                      over and what is left is closing it out. */}
              <span className="home-live-badge">
                {liveDone ? null : <i aria-hidden />}
                {liveDone ? "ALL LOTS SOLD" : "LIVE NOW"}
              </span>
            </p>
            <h2 id="home-live-name" className="home-live-name">
              {liveRow.competitionName}
            </h2>
            <dl className="home-live-facts">
              {liveBoard?.onBlock !== null && liveBoard?.onBlock !== undefined ? (
                <div>
                  <dt>On the block</dt>
                  <dd>
                    {liveBoard.onBlock.playerName ?? `Lot ${liveBoard.onBlock.lotNumber}`}
                    <span className="home-live-role">
                      {" · "}
                      {roleLabeller(liveBoard.roles)(liveBoard.onBlock.role)}
                    </span>
                  </dd>
                </div>
              ) : null}
              {liveBoard?.onBlock?.currentBid != null ? (
                <div>
                  <dt>Top bid</dt>
                  <dd className="home-live-bid">
                    {rupees(liveBoard.onBlock.currentBid)}
                    {liveBoard.onBlock.leadingTeamName !== null ? (
                      <span className="home-live-team">
                        {" · "}
                        {liveBoard.onBlock.leadingTeamName}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Spend</dt>
                <dd>{rupeesShort(liveRow.spendPaise)}</dd>
              </div>
              <div>
                <dt>Lots sold</dt>
                <dd className="home-mono">
                  {liveRow.lotsSold} / {liveRow.lotsTotal}
                </dd>
              </div>
            </dl>
            <span
              className="home-live-bar"
              aria-hidden
              data-sold={liveRow.lotsSold}
              data-total={liveRow.lotsTotal}
            >
              <i
                style={{
                  width: `${String(liveRow.lotsTotal === 0 ? 0 : Math.round((liveRow.lotsSold / liveRow.lotsTotal) * 100))}%`,
                }}
              />
            </span>
          </div>
          <ButtonLink
            href={`/seasons/${liveRow.competitionSlug}/auction/live`}
            data-testid="home-enter-room"
          >
            {liveDone ? "Close out the auction" : "Enter auction room"}
            <IconArrowRight size={16} className="icon-trail" />
          </ButtonLink>
        </section>
      ) : null}

      {/* ---- lifecycle: what the platform does, and where your work sits ---- */}
      {/* The chevrons are ITEMS in this row, not decoration pinned to a
            step's edge. Pinned, they sat on the column boundary — which is
            flush against the next stage's icon and nowhere near the middle of
            the whitespace. As items they take an equal share of the free
            space, so each one lands midway between the stages it joins.

            It renders in the empty state too, greyed, as a MAP. It is the best
            teaching device on the screen — the whole product in one row — and
            it used to appear only once the reader already understood the
            model. */}
      <section
        className={`home-flow${laddering ? " home-flow--map" : ""}`}
        aria-label="Season lifecycle"
      >
        {lifecycleFor(dash).map((stage, index) => {
          const count = stage.count;
          return (
            <Fragment key={stage.key}>
              {index > 0 ? <span className="home-step-sep" aria-hidden /> : null}
              <Link
                href={stage.href}
                className={`home-step${count > 0 ? " home-step--on" : ""}`}
                style={{ ["--step" as string]: String(index + 1) }}
              >
                <span className={`home-ic home-ic--${stage.tone} home-ic--sm`}>{stage.icon}</span>
                <span className="home-step-text">
                  <span className="home-step-head">
                    <span className="home-step-name">{stage.name}</span>
                    <span className="home-step-count">{count}</span>
                  </span>
                  <span className="home-step-blurb">{stage.detail}</span>
                </span>
              </Link>
            </Fragment>
          );
        })}
      </section>

      <OrganizerPanels
        dash={dash}
        view={view}
        schedule={schedule}
        restAttention={restAttention}
        unscanned={unscanned}
        chartMax={chartMax}
        showChart={showChart}
        showLeft={showLeft}
        showRight={showRight}
        showAttention={showAttention}
        showMoney={showMoney}
        showSeasons={showSeasons}
        showAuctions={showAuctions}
        showEvents={showEvents}
        showActivity={showActivity}
        otherAuctions={otherAuctions}
        liveRow={liveRow}
        seasonToOpen={seasonToOpen}
      />

      {/* A member who manages nothing still belongs to a club: its seasons,
            as plain doors, without the organizer's figures or offers. */}
      <HomeShortcuts
        competitions={view.competitions.map((competition) => ({
          slug: competition.slug,
          name: competition.name,
          orgName: competition.orgName,
        }))}
      />
    </>
  );
}
