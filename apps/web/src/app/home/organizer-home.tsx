import {
  ButtonLink,
  CardGrid,
  EmptyState,
  IconAlert,
  IconArrowRight,
  IconBolt,
  IconCalendar,
  IconCheck,
  IconCheckCircle,
  IconChevronRight,
  IconFileCheck,
  IconGavel,
  IconPlus,
  IconRupee,
  IconTile,
  IconTrophy,
  IconUser,
  IconUsers,
  IconWallet,
  type JourneyStep,
  JourneyStepper,
  Money,
  Pill,
  PlayerImage,
  SectionCard,
  StatCard,
  StatGrid,
  VisuallyHidden,
} from "@desiauction/ui";
import type { GrantLike } from "@desiauction/core";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import { FormDialog } from "../../components/form-dialog";
import { monogram } from "../../components/season-hero/season-hero";
import { roleLabeller } from "../../lib/role-label";
import { compactINR, ledgerINR } from "../../lib/inr";
import { cardAmount, moneyFormat } from "../../lib/money";
import { auctionDashboard } from "../../server/auction/actions";
import { competitionsView, seasonOverviewView } from "../../server/competition/actions";
import { competitionAllows } from "../../server/competition/authz";
import { appointmentsPanelView } from "../../server/competition/appointment-actions";
import { organizerScheduleView } from "../../server/competition/fixture-actions";
import { homeDashboard } from "../../server/home/dashboard";
import { grantsOfPerson } from "../../server/request-cache";
import { rolesOf } from "../../server/roles/roles";
import type { HomeDashboardData } from "../../server/home/dashboard";
import { CreateOrgForm } from "../orgs/create-org-form";
import { CreateTournamentForm } from "../tournaments/create-tournament-form";
import { dateRange } from "../tournaments/season-card";
import { seasonJourney } from "../tournaments/season-journey";
import { ClubHero } from "./club-hero";
import { activityLabel, activityStyle, ago, groupActivity } from "./home-activity";
import { seasonBadge } from "./home-parts";
import { HomeShortcuts } from "./home-shortcuts";
import type { NextStep } from "./next-step";
import { NextStepBanner } from "./next-step-banner";
import "./home.css";
import { dateTile } from "../../lib/format-date";
import { formatCount } from "../../lib/plural";

/**
 * A season's facts on one line — "1 Aug – 31 Oct 2026 · Mumbai · ₹2L
 * collected" — where a narrow column may wrap BETWEEN facts but never inside
 * one, so a date range never breaks across three lines.
 */
function Facts({ parts, className }: { parts: string[]; className?: string }) {
  return (
    <span className={className}>
      {parts.map((part, index) => (
        <Fragment key={part}>
          {/* The dot rides with the fact BEFORE it, so a wrapped line never
              starts with one. */}
          <span className="home-fact">
            {part}
            {index < parts.length - 1 ? " ·" : null}
          </span>
          {index < parts.length - 1 ? " " : null}
        </Fragment>
      ))}
    </span>
  );
}

interface AttentionRow {
  key: string;
  label: string;
  detail: string;
  href: string;
  /** The button's words, when the destination alone would name the wrong act. */
  verb?: string;
}

const ATTENTION_SCAN_LIMIT = 8;

/**
 * What this one season is waiting on, or null if it is waiting on nothing.
 *
 * `draft` and `setup` used to be skipped outright: the scan only looked at
 * `registration_open` and `registration_closed`, so a season that had not
 * opened its doors could never produce a row — and 100% of new organizers are
 * in exactly that state. The panel whose entire job is to say what to do next
 * told the people who most needed telling that there was nothing to do. The
 * setup states are now scanned, and they need no database read at all: the
 * per-season team and registration counts already came back with the dashboard.
 */
async function attentionFor(
  competition: { id: string; orgId: string; slug: string; name: string; status: string },
  dash: HomeDashboardData,
  held: readonly GrantLike[],
): Promise<AttentionRow | AttentionRow[] | null> {
  if (competition.status === "registration_open") {
    // The count came back with the dashboard's grouped read, and the reviewer
    // check is the desk's own rule over this render's grants — this used to
    // load the season's whole registrations dashboard for one number. Only a
    // reviewer is told there is reviewing to do (DA-35's partition, unchanged).
    const canReview = competitionAllows(
      held,
      { orgId: competition.orgId, competitionId: competition.id },
      "registration.review",
    );
    const submitted = dash.counts[competition.id]?.submitted ?? 0;
    if (canReview && submitted > 0) {
      return {
        key: `reg-${competition.id}`,
        label: `${String(submitted)} registration${submitted === 1 ? "" : "s"} to review`,
        detail: competition.name,
        href: `/seasons/${competition.slug}/registrations`,
      };
    }
    return null;
  }
  if (competition.status === "registration_closed") {
    const counts = dash.counts[competition.id];
    if (counts?.auctionDone === true) {
      // After the hammer the status column still reads `registration_closed`,
      // and this branch used to look only for an auction to CREATE — so an
      // organizer with fresh squads and not one match scheduled was told
      // "All clear". The two jobs left are the players' and the schedule's.
      if (
        !competitionAllows(
          held,
          { orgId: competition.orgId, competitionId: competition.id },
          "competition.manage",
        )
      ) {
        return null;
      }
      const rows: AttentionRow[] = [];
      const appointments = await appointmentsPanelView(competition.slug);
      if (appointments !== null && appointments.pending.length > 0) {
        rows.push({
          key: `announce-${competition.id}`,
          label: "Announce captains & icons",
          detail: `${competition.name} · ${String(appointments.pending.length)} not told yet`,
          href: `/seasons/${competition.slug}/teams`,
          verb: "Announce now",
        });
      }
      if (counts.fixtures === 0) {
        rows.push({
          key: `fixtures-${competition.id}`,
          label: "Squads are set — schedule the matches",
          detail: competition.name,
          href: `/seasons/${competition.slug}/fixtures`,
          verb: "Schedule matches",
        });
      }
      return rows;
    }
    const dashboard = await auctionDashboard(competition.slug);
    if (dashboard !== null && dashboard.viewer.canConduct && dashboard.view === null) {
      const blockers = dashboard.ready.checks.filter((check) => !check.pass).length;
      return {
        key: `auction-${competition.id}`,
        label:
          blockers > 0
            ? `Auction readiness: ${String(blockers)} blocker${blockers === 1 ? "" : "s"}`
            : "Ready — create the auction",
        detail: competition.name,
        href:
          blockers > 0
            ? `/seasons/${competition.slug}/readiness`
            : `/seasons/${competition.slug}/auction`,
      };
    }
    return null;
  }
  // draft / setup — the states the scan could not see.
  const counts = dash.counts[competition.id] ?? { teams: 0, registrations: 0 };
  if (counts.teams === 0) {
    return {
      key: `teams-${competition.id}`,
      label: "Add the teams that will bid",
      detail: competition.name,
      href: `/seasons/${competition.slug}/teams`,
    };
  }
  if (competition.status === "draft") {
    return {
      key: `setup-${competition.id}`,
      label: "Begin setup",
      detail: competition.name,
      href: `/seasons/${competition.slug}`,
    };
  }
  return {
    key: `open-${competition.id}`,
    label: `Open registration — ${String(counts.teams)} team${counts.teams === 1 ? "" : "s"} ready`,
    detail: competition.name,
    href: `/seasons/${competition.slug}`,
  };
}

/**
 * Every date on this page is an Indian tournament's date.
 *
 * `Date#getHours()` and a bare `toLocaleString` read the SERVER's zone. That is
 * correct on a laptop in Asia/Calcutta and wrong on every UTC host we would
 * actually deploy to — IST 17:00–22:30, which is the auction-night window this
 * console exists for, renders as "Good afternoon" under UTC. Pinning the zone
 * keeps the greeting and the fixture dates true wherever the server runs.
 */

/** Build a polyline `points` string for a 7-value series. */
function points(series: number[], max: number): string {
  const x0 = 44;
  const x1 = 452;
  const yTop = 16;
  const yBase = 132;
  const step = (x1 - x0) / 6;
  return series
    .map((value, index) => {
      const x = x0 + index * step;
      const y = yBase - (max === 0 ? 0 : (value / max) * (yBase - yTop));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * GATE FIRST, then stream — the pattern worked out in
 * `app/org/[slug]/settlement/page.tsx`.
 *
 * There is deliberately NO `loading.tsx` in this segment, and there must never
 * be one again. A route-level Suspense boundary sits ABOVE the page, so React
 * commits `200 OK` and starts streaming before either `redirect()` below ever
 * runs; the redirect then degrades to a client-side navigation carried inside a
 * 49KB body titled "Home · DesiAuction". Measured: anonymous `/home` answered
 * 200 while `/seasons`, `/orgs`, `/inbox` and `/money` all answered 307. This
 * is the THIRD time the trap has been hit here — the root `loading.tsx` in
 * PX-2, then `app/c/loading.tsx` in PX-10, now this one.
 *
 * The gate is cheap (one session read), so it costs nothing to run it before
 * the boundary. Everything expensive lives in `<HomeBody>` behind an IN-PAGE
 * `<Suspense>`, which streams exactly as the old `loading.tsx` did — but under
 * a status code that has already been decided.
/** The season /home leads with when the URL names none. */
const IN_FLIGHT = new Set(["setup", "registration_open", "registration_closed"]);

/**
 * THE ORGANIZER'S HOME.
 *
 * The MARKUP is the founder's 2026-09-19 redesign (club hero, journey stepper,
 * stat cards, section cards). The STRUCTURE is RN-1's: this renders only for
 * somebody holding `org:owner` or `org:staff`, chosen upstream by
 * `home-router.ts`, and it loads only what an organizer needs.
 *
 * Those arrived on branches that never saw each other — the redesign restyled
 * the old single-file /home, which had `manages ?` woven through it for five
 * roles at once. Keeping the paint meant throwing the conditionals away: the
 * router already answered the question they were asking, and a branch that can
 * no longer be false is a lie about what this page is for.
 */
export async function OrganizerHome({
  personId,
  focusSlug,
  nextStepFor,
}: {
  personId: string;
  /** `?season=` — the hero's switcher writes it; anything unknown is ignored. */
  focusSlug: string | null;
  /** The router owns the one next step, across every role this person holds. */
  nextStepFor: (input: {
    managedLive: { competitionSlug: string; competitionName: string } | null;
    attention: AttentionRow[];
  }) => NextStep | null;
}) {
  const [view, schedule, dash, roles] = await Promise.all([
    competitionsView(),
    organizerScheduleView(),
    homeDashboard(),
    rolesOf(personId),
  ]);
  /*
   * WHO IS READING (launch polish, Phase 2). The organizer dashboard below —
   * hero, journey, figures, attention, seasons, activity — is for people who
   * MANAGE a club. A team owner, a plain member and a player used to get it
   * too, with an offer to create tournaments they had no power to create.
   */
  const managedOrgs = new Set(roles.organizes.map((club) => club.orgId));
  // The night in progress leads the page (managers only).
  const liveRow = dash.auctions.find((auction) => auction.status === "live") ?? null;
  // The live panel owns the live auction, so the list lists only the rest.
  const otherAuctions = dash.auctions.filter((auction) => auction.auctionId !== liveRow?.auctionId);
  const lastDone = dash.doneAuctions[0];

  /*
   * THE SEASON IN FOCUS — what the club hero, the journey row and the four
   * figures describe. The switcher's choice when it names one of this person's
   * managed seasons; otherwise the live night, then the newest season still in
   * flight, then the newest of all (the list is newest-created first).
   */
  const managedSeasons = view.competitions.filter((competition) =>
    managedOrgs.has(competition.orgId),
  );
  const focus =
    managedSeasons.find((competition) => competition.slug === focusSlug) ??
    managedSeasons.find((competition) => competition.slug === liveRow?.competitionSlug) ??
    managedSeasons.find(
      (competition) =>
        IN_FLIGHT.has(competition.status) &&
        dash.top.find((row) => row.slug === competition.slug)?.settlement !== "settled",
    ) ??
    managedSeasons[0];

  // The scan used to be a sequential loop of composite reads; one batch now,
  // with the live board and the focus season's overview riding along.
  // Only managers are asked what is waiting on them.
  const scanned = view.competitions.slice(0, ATTENTION_SCAN_LIMIT);
  const [liveBoard, focusOverview, scannedRows] = await Promise.all([
    liveRow === null
      ? Promise.resolve(null)
      : auctionDashboard(liveRow.competitionSlug).then((board) => board?.overview ?? null),
    focus === undefined ? Promise.resolve(null) : seasonOverviewView(focus.slug),
    grantsOfPerson(personId).then((held) =>
      Promise.all(scanned.map((competition) => attentionFor(competition, dash, held))),
    ),
  ]);
  const attention = scannedRows.flat().filter((row): row is AttentionRow => row !== null);
  const unscanned = view.competitions.length - scanned.length;

  const seasonNeedingTeams =
    view.competitions.find((competition) => (dash.counts[competition.id]?.teams ?? 0) === 0) ??
    view.competitions[0];
  const seasonToOpen =
    view.competitions.find((competition) => competition.status !== "registration_open") ??
    view.competitions[0];

  const totalTeams = Object.values(dash.counts).reduce((sum, row) => sum + row.teams, 0);
  const rungs: SetupRung[] = [
    {
      key: "org",
      title: "Create your club",
      blurb: "The organization that owns your tournaments.",
      done: view.orgs.length > 0,
      cta: (
        <FormDialog
          title="New club"
          triggerLabel="Create your club"
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
  // The ladder retires when the LAST rung is done — rungs can complete out of
  // order (a one-off season leaves the tournament rung open forever).
  const currentRung = rungs.findIndex((rung) => !rung.done);
  // An ORGANIZER's first-run guide. A brand-new account chooses a path first
  // (the next-step card); a player or a member never climbs it.
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

  /* ---- which panels have earned their space ------------------------------ */
  const moneyTotal =
    dash.money.collectedPaise + dash.money.outstandingPaise + dash.money.waivedPaise;
  // One capture is not a trend: a lone payment drew six flat days and a spike.
  const chartDays = [...dash.money.thisWeek, ...dash.money.lastWeek].filter(
    (value) => value > 0,
  ).length;
  // The next step leads the attention card with the first thing waiting; the
  const chartMax = Math.max(...dash.money.thisWeek, ...dash.money.lastWeek, 0);
  const showChart = chartDays >= 2;
  // The next step leads the attention card with the first thing waiting; the
  // rows under it list only what comes after it.
  const restAttention = nextStep?.key === "organizer-attention" ? attention.slice(1) : attention;
  const attentionCount = restAttention.length + (nextStep !== null ? 1 : 0);
  const showMoney = moneyTotal > 0;
  const showSeasons = dash.top.length > 0;
  const showAuctions = otherAuctions.length > 0 || (!laddering && liveRow === null);
  const showEvents = schedule.length > 0 || !laddering;
  const showActivity = dash.activity.length > 0;

  // Done when no lot is left to call — an unsold or withdrawn lot is called
  // too, so `sold === total` stayed false all night the moment one went unsold.
  const liveDone = liveRow !== null && liveRow.lotsTotal > 0 && liveRow.lotsRemaining === 0;
  const allSold = liveDone && liveRow.lotsSold === liveRow.lotsTotal;

  const bySlug = new Map(view.competitions.map((competition) => [competition.slug, competition]));
  const seasonFacts = (slug: string): string[] => {
    const competition = bySlug.get(slug);
    if (competition === undefined) return [];
    return [dateRange(competition.startsOn, competition.endsOn), competition.location].filter(
      (part): part is string => part !== null,
    );
  };
  const seasonMeta = (slug: string): string | null => {
    const parts = seasonFacts(slug);
    return parts.length === 0 ? null : parts.join(" · ");
  };

  // Offered to people who MANAGE a club, in the clubs they manage — the same
  // gate as the top bar's "+ New tournament".
  const creatableOrgs = view.orgs.filter((org) => managedOrgs.has(org.id));
  const createCard =
    creatableOrgs.length > 0 ? (
      <FormDialog
        title="New tournament"
        triggerAsLink
        triggerClassName="home-create-card"
        triggerTestId="home-create-tournament-card"
        triggerLabel={
          <>
            <span className="home-create-plus" aria-hidden>
              <IconPlus size={20} />
            </span>
            <span className="home-create-text">
              <strong>Create a new tournament</strong>
              <span>Start a new season and build your next story.</span>
            </span>
          </>
        }
      >
        <CreateTournamentForm orgs={creatableOrgs} />
      </FormDialog>
    ) : undefined;

  const shortcuts = (
    <HomeShortcuts
      competitions={view.competitions.map((competition) => {
        const meta = seasonMeta(competition.slug);
        return {
          slug: competition.slug,
          name: competition.name,
          orgName: competition.orgName,
          ...(meta !== null ? { meta } : {}),
        };
      })}
      {...(createCard !== undefined ? { createCard } : {})}
    />
  );

  /* ---- the focus season: journey + figures ------------------------------- */
  const focusBase = focus === undefined ? "" : `/seasons/${focus.slug}`;
  const journey =
    focusOverview === null
      ? null
      : seasonJourney(
          {
            status: focusOverview.competition.status,
            teams: focusOverview.teamCount,
            registrations: focusOverview.approvedPlayers + focusOverview.pendingPlayers,
            auctionStatus: focusOverview.auctionStatus,
            settlement: focusOverview.settlement?.status ?? null,
            auctionUnit: focusOverview.competition.auctionUnit,
            fixtures: focusOverview.fixtureCount,
          },
          // The same five rungs /tournaments and the season overview draw
          // (round 2: /home folded Teams into "Set up" and drew four).
          { withTeams: true },
        );
  // With several seasons, each stage also says how many of them sit there —
  // the portfolio figures the old lifecycle strip carried.
  const stageCount: Record<string, number> = {
    setup: dash.stages.setup.competitions,
    registration: dash.stages.registration.competitions,
    auction: dash.stages.auction.competitions,
    settlement: dash.stages.settlement.competitions,
  };
  const journeyHref: Record<string, string | undefined> = {
    setup: focusBase,
    teams: `${focusBase}/teams`,
    registration: `${focusBase}/registrations`,
    auction: `${focusBase}/auction`,
    // The Money tab 404s without `settlement.view`: no link beats a dead end.
    settlement: focusOverview?.viewer.canSettle === true ? `${focusBase}/money` : undefined,
    fixtures: `${focusBase}/fixtures`,
  };
  const journeyIcon: Record<string, ReactNode> = {
    setup: <IconTrophy size={14} />,
    teams: <IconUsers size={14} />,
    registration: <IconFileCheck size={14} />,
    auction: <IconGavel size={14} />,
    settlement: <IconRupee size={14} />,
    fixtures: <IconCalendar size={14} />,
  };
  const lotsPct =
    focusOverview === null || focusOverview.lotsTotal === 0
      ? 0
      : Math.round((focusOverview.lotsSold / focusOverview.lotsTotal) * 100);

  const attentionCard = (
    <SectionCard
      data-testid="attention-queue"
      className="home-attention"
      icon={<IconAlert />}
      concept={attentionCount > 0 ? "alert" : "done"}
      title="Needs attention"
      action={
        attentionCount > 0 ? (
          <span className="home-count" aria-live="polite">
            {attentionCount}
            <VisuallyHidden>
              {" "}
              item{attentionCount === 1 ? "" : "s"} needing attention
            </VisuallyHidden>
          </span>
        ) : undefined
      }
    >
      {nextStep !== null ? <NextStepBanner step={nextStep} embedded /> : null}
      {restAttention.length > 0 ? (
        <ul className="home-list">
          {restAttention.map((row) => (
            <li key={row.key}>
              <Link href={row.href} className="home-row-link">
                <IconTile icon={<IconBolt />} concept="alert" size="sm" />
                <span className="home-row-text">
                  <strong>{row.label}</strong>
                  <span>{row.detail}</span>
                </span>
                <IconChevronRight size={18} className="home-row-go" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {nextStep === null && restAttention.length === 0 ? (
        <div className="home-clear">
          <IconTile icon={<IconCheckCircle />} concept="done" size="lg" />
          <span className="home-row-text">
            <strong>All clear — nothing is waiting on you.</strong>
            <span>You&apos;re all caught up.</span>
          </span>
        </div>
      ) : null}
      {/* The scan stops at eight and says so, so a portfolio of twenty never
          reads as "these eight are all there is". */}
      {unscanned > 0 ? (
        <p className="home-scan-note">
          Checked the {ATTENTION_SCAN_LIMIT} most recent of {view.competitions.length} seasons.{" "}
          <Link href="/tournaments?view=seasons">See every season</Link>
        </p>
      ) : null}
    </SectionCard>
  );

  return (
    <>
      {laddering ? <SetupLadder rungs={rungs} current={currentRung} /> : null}

      {/* ---- the night in progress: nothing outranks a live auction ---- */}
      {liveRow !== null ? (
        <section
          className={`home-live${liveDone ? " home-live--done" : ""}`}
          aria-labelledby="home-live-name"
          data-testid="home-live"
        >
          <div className="home-live-body">
            <p className="home-live-kicker">
              {/* Every lot has gone: "live" is the wrong word, closing out is. */}
              <span className="home-live-badge">
                {liveDone ? null : <i aria-hidden />}
                {liveDone ? (allSold ? "ALL LOTS SOLD" : "EVERY LOT CALLED") : "LIVE NOW"}
              </span>
            </p>
            <h2 id="home-live-name" className="home-live-name">
              {liveRow.competitionName}
            </h2>
            <dl className="home-live-facts">
              {liveBoard?.onBlock !== null && liveBoard?.onBlock !== undefined ? (
                <div>
                  <dt>On the block</dt>
                  <dd className="home-live-player">
                    <PlayerImage
                      name={liveBoard.onBlock.playerName ?? `Lot ${liveBoard.onBlock.lotNumber}`}
                      seed={liveBoard.onBlock.registrationId}
                      src={liveBoard.onBlock.photoUrl}
                      size="xs"
                      shape="round"
                      decorative
                    />
                    <span>
                      {liveBoard.onBlock.playerName ?? `Lot ${liveBoard.onBlock.lotNumber}`}
                      <span className="home-live-role">
                        {" · "}
                        {roleLabeller(liveBoard.roles)(liveBoard.onBlock.role)}
                      </span>
                    </span>
                  </dd>
                </div>
              ) : null}
              {liveBoard?.onBlock?.currentBid != null ? (
                <div>
                  <dt>Top bid</dt>
                  <dd className="home-live-bid">
                    {moneyFormat(liveRow.auctionUnit).ledger(liveBoard.onBlock.currentBid)}
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
                <dd>{cardAmount(liveRow.auctionUnit, liveRow.spendPaise)}</dd>
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

      {/* ---- the club hero with its road along the bottom edge, then its
           four figures. The journey used to be a strip of its own under the
           hero, repeating the hero's own status (~86px). ---- */}
      {focusOverview !== null ? (
        <ClubHero
          overview={focusOverview}
          seasonsInClub={
            view.competitions.filter(
              (competition) => competition.orgId === focusOverview.competition.orgId,
            ).length
          }
          switchable={managedSeasons.map((competition) => ({
            slug: competition.slug,
            name: competition.name,
          }))}
          {...(journey !== null
            ? {
                footer: (
                  <JourneyStepper
                    variant="rail"
                    label={`${focusOverview.competition.name} progress`}
                    linkComponent={Link}
                    steps={journey.map((step): JourneyStep => {
                      const href = journeyHref[step.key];
                      // Zero is left unsaid: a "0" beside a completed step reads as a fault.
                      const many = view.competitions.length > 1 && (stageCount[step.key] ?? 0) > 0;
                      const item: JourneyStep = {
                        key: step.key,
                        label: (
                          <>
                            {step.label}
                            {many ? (
                              <span className="home-journey-count">
                                {stageCount[step.key] ?? 0}
                                <VisuallyHidden>
                                  {" "}
                                  of your seasons {(stageCount[step.key] ?? 0) === 1
                                    ? "is"
                                    : "are"}{" "}
                                  here
                                </VisuallyHidden>
                              </span>
                            ) : null}
                          </>
                        ),
                        state: step.state,
                        hint: step.hint,
                        icon: journeyIcon[step.key],
                      };
                      // ONE LINK PER DESTINATION (round 3B): the road is a
                      // read-out; only the step you are on is a door. Done
                      // steps' pages are the figure tiles right under it.
                      return href === undefined || step.state !== "current"
                        ? item
                        : { ...item, href };
                    })}
                  />
                ),
              }
            : {})}
        />
      ) : null}

      {focusOverview !== null ? (
        <StatGrid testId="home-figures">
          <StatCard
            icon={<IconUsers />}
            concept="teams"
            rolling
            value={formatCount(focusOverview.teamCount)}
            label="Teams"
            href={`${focusBase}/teams`}
            linkComponent={Link}
          />
          <StatCard
            icon={<IconUser />}
            concept="players"
            rolling
            value={formatCount(focusOverview.approvedPlayers)}
            label="Players"
            hint={
              focusOverview.pendingPlayers > 0
                ? `${formatCount(focusOverview.pendingPlayers)} to review`
                : "In the auction pool"
            }
            href={`${focusBase}/registrations`}
            linkComponent={Link}
          />
          {/* Money-gated in the read: absent for a reader without money sight,
              who gets the season's fixtures in its place. */}
          {focusOverview.purseCommitted !== undefined ? (
            <StatCard
              icon={<IconWallet />}
              concept="money"
              rolling
              value={cardAmount(
                focusOverview.competition.auctionUnit,
                focusOverview.purseCommitted,
              )}
              label="Purse committed"
              {...(focusOverview.pursePct != null
                ? { hint: `${String(focusOverview.pursePct)}% of every purse` }
                : {})}
              // No door: "Lots sold" beside it opens the same auction page.
            />
          ) : (
            <StatCard
              icon={<IconCalendar />}
              concept="fixtures"
              rolling
              value={formatCount(focusOverview.fixtureCount)}
              label="Fixtures"
              href={`${focusBase}/fixtures`}
              linkComponent={Link}
            />
          )}
          <StatCard
            icon={<IconGavel />}
            concept="auction"
            rolling
            value={`${String(focusOverview.lotsSold)}/${String(focusOverview.lotsTotal)}`}
            label="Lots sold"
            hint={focusOverview.lotsTotal === 0 ? "No lots yet" : `${String(lotsPct)}%`}
            progress={lotsPct}
            href={`${focusBase}/auction`}
            linkComponent={Link}
          />
        </StatGrid>
      ) : null}

      <CardGrid weight="golden">
        {/* ================= LEFT ================= */}
        <div className="home-col">
          {!laddering ? attentionCard : null}

          {showSeasons ? (
            <SectionCard
              flush
              icon={<IconTrophy />}
              concept="season"
              title="Top seasons"
              action={
                <Link href="/tournaments?view=seasons" className="home-more">
                  View all
                  <IconArrowRight size={14} />
                </Link>
              }
            >
              {/* Two renderings, one visible at a time (see home.css): a
                    table where the COLUMN is wide enough for one, one row per
                    season where it is not. It used to switch on the viewport,
                    and this card sits in the narrow half of a two-column grid —
                    so a 1280 laptop squeezed the name to 164px and a 1024 one
                    pushed the table out of its card. */}
              <div className="home-table-wrap" data-testid="home-competitions">
                <table className="home-table">
                  <thead>
                    <tr>
                      <th>Season</th>
                      <th className="home-num">Teams</th>
                      <th className="home-num">Players</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dash.top.map((row) => {
                      const badge = seasonBadge(row);
                      const facts = [
                        ...seasonFacts(row.slug),
                        // rupees-always: the settlement books, which a points season never opens
                        ...(row.canSeeMoney ? [`${compactINR(row.collectedPaise)} collected`] : []),
                      ];
                      return (
                        <tr key={row.slug}>
                          <td>
                            <span className="home-tcell">
                              <span className="home-crest" aria-hidden>
                                {monogram(row.name)}
                              </span>
                              <span className="home-tcell-text">
                                <Link href={`/seasons/${row.slug}`}>{row.name}</Link>
                                {facts.length > 0 ? <Facts parts={facts} /> : null}
                              </span>
                            </span>
                          </td>
                          <td className="home-num home-mono">{row.teams}</td>
                          <td className="home-num home-mono">{row.registrations}</td>
                          <td>
                            <Pill tone={badge.tone}>{badge.label}</Pill>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <ul className="home-season-cards">
                  {dash.top.map((row) => {
                    const badge = seasonBadge(row);
                    return (
                      <li key={row.slug}>
                        <Link href={`/seasons/${row.slug}`} className="home-season-card">
                          <span className="home-crest" aria-hidden>
                            {monogram(row.name)}
                          </span>
                          <span className="home-season-main">
                            <strong className="home-season-name">{row.name}</strong>
                            <Facts
                              className="home-season-meta"
                              parts={[
                                `${String(row.teams)} team${row.teams === 1 ? "" : "s"}`,
                                `${String(row.registrations)} player${row.registrations === 1 ? "" : "s"}`,
                                ...seasonFacts(row.slug),
                                // The table's money column, carried over: the
                                // list is what a laptop shows now, so leaving it
                                // out would hide the figure from the very
                                // organizer it was for.
                                ...(row.canSeeMoney
                                  ? // rupees-always: the settlement books, which a points season never opens
                                    [`${compactINR(row.collectedPaise)} collected`]
                                  : []),
                              ]}
                            />
                          </span>
                          <Pill tone={badge.tone}>{badge.label}</Pill>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </SectionCard>
          ) : null}

          {showMoney ? (
            <SectionCard
              icon={<IconRupee />}
              concept="money"
              title="Money overview"
              action={
                showChart ? (
                  <span className="home-legend">
                    <span>
                      <i className="home-dot home-dot--accent" />
                      This week
                    </span>
                    <span>
                      <i className="home-dot home-dot--muted" />
                      Last week
                    </span>
                  </span>
                ) : undefined
              }
            >
              {showChart ? (
                <div className="home-chart-wrap">
                  {chartMax > 0 ? (
                    <span className="home-chart-peak">
                      Peak {/* rupees-always: settlement collections */ compactINR(chartMax)}/day
                    </span>
                  ) : null}
                  <svg
                    className="home-chart"
                    viewBox="0 0 470 156"
                    role="img"
                    aria-label="Money collected per day, this week versus last week"
                  >
                    <defs>
                      <linearGradient id="home-area" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="var(--accent)" stopOpacity="0.24" />
                        <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {[16, 45, 74, 103, 132].map((y) => (
                      <line
                        key={y}
                        x1="44"
                        y1={y}
                        x2="452"
                        y2={y}
                        stroke="var(--border-subtle)"
                        strokeWidth="1"
                      />
                    ))}
                    <polygon
                      fill="url(#home-area)"
                      points={`44,132 ${points(dash.money.thisWeek, chartMax)} 452,132`}
                    />
                    <polyline
                      fill="none"
                      stroke="var(--text-muted)"
                      strokeWidth="2"
                      strokeDasharray="4 5"
                      strokeLinecap="round"
                      points={points(dash.money.lastWeek, chartMax)}
                    />
                    <polyline
                      fill="none"
                      stroke="var(--accent-line)"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={points(dash.money.thisWeek, chartMax)}
                    />
                    {DAY_LABELS.map((label, index) => (
                      <text
                        key={label}
                        x={44 + index * ((452 - 44) / 6)}
                        y="150"
                        fill="var(--text-muted)"
                        fontSize="10"
                        textAnchor="middle"
                      >
                        {label}
                      </text>
                    ))}
                  </svg>
                  {/* A polyline says nothing to a screen reader. */}
                  <VisuallyHidden>
                    Collected per day this week:{" "}
                    {DAY_LABELS.map(
                      // rupees-always: the settlement books, which a points season never opens
                      (label, index) => `${label} ${compactINR(dash.money.thisWeek[index] ?? 0)}`,
                    ).join(", ")}
                    .
                  </VisuallyHidden>
                </div>
              ) : null}
              <div className="home-money">
                <MoneyCell href={dash.moneyHref} label="Collected" tone="remaining">
                  {/* rupees-always: the settlement books, which a points season never opens */}
                  {ledgerINR(dash.money.collectedPaise)}
                </MoneyCell>
                <MoneyCell href={dash.moneyHref} label="Outstanding" tone="frozen">
                  {/* rupees-always: the settlement books, which a points season never opens */}
                  {ledgerINR(dash.money.outstandingPaise)}
                </MoneyCell>
                <MoneyCell href={dash.moneyHref} label="Waived" tone="spent">
                  {/* rupees-always: the settlement books, which a points season never opens */}
                  {ledgerINR(dash.money.waivedPaise)}
                </MoneyCell>
              </div>
            </SectionCard>
          ) : null}

          {shortcuts}
        </div>

        {/* ================= RIGHT ================= */}
        <div className="home-col">
          {showAuctions ? (
            <SectionCard
              icon={<IconGavel />}
              concept="auction"
              title="Active auctions"
              action={
                // The cross-season auctions index, which this card is a slice
                // of — not the seasons list, which answers a different question.
                <Link href="/auctions" className="home-more">
                  View all
                  <IconArrowRight size={14} />
                </Link>
              }
            >
              {otherAuctions.length === 0 && liveRow === null && lastDone !== undefined ? (
                // An auction that finished is news, not an empty state: "No
                // auction running yet. Set up auction" was being said to an
                // organizer whose night had ended an hour earlier.
                <PanelEmpty
                  icon={<IconGavel />}
                  title={`${lastDone.competitionName}'s auction is done`}
                  text={`${String(lastDone.lotsSold)} of ${String(lastDone.lotsTotal)} sold. Every squad and every price is on the results page.`}
                  ctaHref={`/seasons/${lastDone.competitionSlug}/auction`}
                  ctaLabel="See results"
                />
              ) : otherAuctions.length === 0 ? (
                <PanelEmpty
                  icon={<IconGavel />}
                  title={liveRow === null ? "No auction running yet." : "Nothing else scheduled."}
                  text={
                    liveRow === null
                      ? "Set one up to start the action."
                      : "The live night is above; plan the next one here."
                  }
                  ctaHref={
                    seasonToOpen === undefined
                      ? "/tournaments?view=seasons"
                      : `/seasons/${seasonToOpen.slug}/auction`
                  }
                  ctaLabel={liveRow === null ? "Set up auction" : "Plan the next one"}
                />
              ) : (
                <ul className="home-list">
                  {otherAuctions.map((auction) => {
                    const pct =
                      auction.lotsTotal === 0
                        ? 0
                        : Math.round((auction.lotsSold / auction.lotsTotal) * 100);
                    return (
                      <li key={auction.auctionId}>
                        <Link
                          href={`/seasons/${auction.competitionSlug}/auction`}
                          className="home-row-link home-auction"
                        >
                          <span className="home-crest" aria-hidden>
                            {monogram(auction.competitionName)}
                          </span>
                          <span className="home-row-text">
                            <strong>{auction.competitionName}</strong>
                            <span>
                              Spend {cardAmount(auction.auctionUnit, auction.spendPaise)} · Lots{" "}
                              {auction.lotsSold}/{auction.lotsTotal}
                            </span>
                            <span className="home-progress" aria-hidden>
                              <i style={{ width: `${String(pct)}%` }} />
                            </span>
                          </span>
                          {auction.status === "live" ? (
                            <Pill tone="red" dot>
                              Live
                            </Pill>
                          ) : (
                            <Pill tone="blue">Scheduled</Pill>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>
          ) : null}

          {showEvents ? (
            <SectionCard icon={<IconCalendar />} concept="fixtures" title="Upcoming events">
              {schedule.length === 0 ? (
                <PanelEmpty
                  icon={<IconCalendar />}
                  title="No fixtures scheduled."
                  text="Create a match schedule to keep your community engaged."
                  ctaHref={
                    seasonToOpen === undefined
                      ? "/tournaments?view=seasons"
                      : `/seasons/${seasonToOpen.slug}/fixtures`
                  }
                  ctaLabel="Set up the schedule"
                />
              ) : (
                <ul className="home-list">
                  {schedule.slice(0, 5).map((fixture) => {
                    const when = fixture.kickoffAt !== null ? new Date(fixture.kickoffAt) : null;
                    return (
                      <li key={fixture.id}>
                        <Link
                          href={`/seasons/${fixture.competitionSlug}/fixtures`}
                          className="home-row-link"
                        >
                          <span className="home-date">
                            <b>{when !== null ? dateTile(when).day.padStart(2, "0") : "--"}</b>
                            <span>
                              {when !== null ? dateTile(when).month.toUpperCase() : "TBD"}
                            </span>
                          </span>
                          <span className="home-row-text">
                            <strong>
                              {fixture.homeTeamName} vs {fixture.awayTeamName}
                            </strong>
                            <span>{fixture.competitionName}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>
          ) : null}

          {showActivity ? (
            <SectionCard
              icon={<IconBolt />}
              concept="activity"
              title="Recent activity"
              action={
                <Link href="/inbox" className="home-more">
                  View all
                  <IconArrowRight size={14} />
                </Link>
              }
            >
              <ul className="home-list">
                {groupActivity(dash.activity).map(({ row, times }) => {
                  const style = activityStyle(row.action);
                  return (
                    <li key={row.id} className="home-feed">
                      <IconTile icon={style.icon} tone={style.tone} size="sm" />
                      <span className="home-row-text">
                        <strong>
                          {row.action === "finops.summary"
                            ? `${String(row.count)} finance ${row.count === 1 ? "update" : "updates"}`
                            : activityLabel(row.action)}
                          {times > 1 ? <span className="home-feed-times"> ×{times}</span> : null}
                        </strong>
                        {/* Which season the event belongs to — six anonymous
                              "Paddle granted" lines answer nothing without it. */}
                        {row.scope !== null ? <span>{row.scope}</span> : null}
                      </span>
                      <span className="home-time">{ago(row.at)}</span>
                    </li>
                  );
                })}
              </ul>
            </SectionCard>
          ) : null}
        </div>
      </CardGrid>
    </>
  );
}

/** An empty panel should still sell the next move, not just report nothing. */
function PanelEmpty({
  icon,
  title,
  text,
  ctaHref,
  ctaLabel,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <EmptyState
      size="compact"
      icon={icon}
      title={title.replace(/\.$/, "")}
      description={text}
      action={
        <ButtonLink href={ctaHref} variant="secondary" size="sm">
          {ctaLabel}
        </ButtonLink>
      }
    />
  );
}

/**
 * A money figure, linked only where the link goes somewhere real.
 *
 * All three cells pointed at `/money`, which answers "This area is being built
 * during the beta" — so a panel showing ₹2,00,000 of genuinely settled money
 * was three dead ends. Where no single season owns the total (or the reader may
 * not open its books) the cell is plain text: no link beats a link to an
 * apology.
 */
function MoneyCell({
  href,
  label,
  tone,
  children,
}: {
  href: string | null;
  label: string;
  tone: "remaining" | "frozen" | "spent";
  children: string;
}) {
  const inner = (
    <>
      <span className="home-money-label">{label}</span>
      <Money tone={tone}>{children}</Money>
    </>
  );
  return href === null ? (
    <div className="home-money-cell home-money-cell--flat">{inner}</div>
  ) : (
    <Link href={href} className="home-money-cell">
      {inner}
    </Link>
  );
}

interface SetupRung {
  key: string;
  title: string;
  blurb: string;
  done: boolean;
  cta: ReactNode;
}

/**
 * The five rungs between signing up and an auction pool, with exactly one live
 * CTA — the one the reader is actually on.
 *
 * It is a ladder rather than a checklist because the order is real: you cannot
 * add teams to a season that does not exist. Completed rungs stay visible so
 * the reader can see how far along they are and what is still ahead; the
 * lifecycle strip below then shows what happens AFTER all five.
 */
function SetupLadder({ rungs, current }: { rungs: SetupRung[]; current: number }) {
  return (
    <section
      className="home-ladder"
      aria-labelledby="home-ladder-title"
      data-testid="home-setup-ladder"
    >
      <div className="home-ladder-head">
        <h2 id="home-ladder-title">Set up your first auction night</h2>
        <p>
          Step {current + 1} of {rungs.length}
        </p>
      </div>
      <ol className="home-ladder-steps">
        {rungs.map((rung, index) => {
          const state = rung.done ? "done" : index === current ? "now" : "todo";
          return (
            <li key={rung.key} className={`home-rung home-rung--${state}`}>
              <span className="home-rung-mark" aria-hidden>
                {rung.done ? <IconCheck size={14} /> : index + 1}
              </span>
              <span className="home-rung-text">
                <strong>
                  <VisuallyHidden>
                    {state === "done" ? "Done: " : state === "now" ? "Next: " : "Later: "}
                  </VisuallyHidden>
                  {rung.title}
                </strong>
                <span>{rung.blurb}</span>
              </span>
              {index === current ? <span className="home-rung-cta">{rung.cta}</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
