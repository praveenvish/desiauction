import { formatPaiseINR, paise, roleLabelIn, sportPackFor } from "@desiauction/core";
import {
  ButtonLink,
  CardGrid,
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
  JourneyStepper,
  LoadingState,
  Money,
  Notice,
  Pill,
  PlayerImage,
  SectionCard,
  StatCard,
  StatGrid,
  VisuallyHidden,
  type JourneyStep,
  type KitTone,
} from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { FormDialog } from "../../components/form-dialog";
import { monogram } from "../../components/season-hero/season-hero";
import { PageTitle } from "../../components/shell/page-title";
import { roleLabeller } from "../../lib/role-label";
import { auctionDashboard } from "../../server/auction/actions";
import { currentSession } from "../../server/auth/actions";
import {
  competitionsView,
  registrationDashboard,
  seasonOverviewView,
} from "../../server/competition/actions";
import { organizerScheduleView } from "../../server/competition/fixture-actions";
import { myRegistrations } from "../../server/competition/public";
import { homeDashboard } from "../../server/home/dashboard";
import { hasPlayerProfile, profileCompletenessFor } from "../../server/player/profile";
import { currentTeam, rolesOf } from "../../server/roles/roles";
import type { HomeDashboardData } from "../../server/home/dashboard";
import { CreateOrgForm } from "../orgs/create-org-form";
import { CreateTournamentForm } from "../tournaments/create-tournament-form";
import { dateRange } from "../tournaments/season-card";
import { seasonJourney } from "../tournaments/season-journey";
import { ClubHero } from "./club-hero";
import { activityLabel, activityStyle, ago } from "./home-activity";
import { HomeShortcuts } from "./home-shortcuts";
import { chooseNextStep } from "./next-step";
import { NextStepBanner } from "./next-step-banner";
import { OwnerSection } from "./owner-section";
import "./home.css";

export const metadata = { title: "Home · DesiAuction" };

type Tone = KitTone;

const REG_TONE: Record<string, Tone> = {
  submitted: "blue",
  approved: "green",
  waitlisted: "amber",
  rejected: "red",
  withdrawn: "neutral",
  draft: "neutral",
};

function statusTone(status: string): Tone {
  switch (status) {
    // The console's one colour grammar — see STATUS_TONE in season-card.
    case "registration_open":
      return "blue";
    case "registration_closed":
      return "amber";
    default:
      return "neutral";
  }
}

/**
 * Compact label so the status column never truncates in a narrow panel.
 *
 * "Open"/"Closed" were shorter still, and wrong twice over: "Closed" told a
 * reader the SEASON had ended when only registration had (auction night is
 * next), and a settled season carried the same word as one mid-lifecycle.
 * These abbreviate the vocabulary /tournaments uses rather than invent one.
 */
function statusLabel(status: string): string {
  switch (status) {
    case "registration_open":
      return "Reg open";
    case "registration_closed":
      return "Reg closed";
    case "setup":
      return "Setup";
    case "draft":
      return "Draft";
    default:
      return status.replace(/_/g, " ");
  }
}

/**
 * The one badge a season row shows. Whether the books are settled is the
 * settlement CASE's answer and outranks the competition status — the same
 * precedence the lifecycle rail below already applies.
 */
function seasonBadge(row: { status: string; settlement: "settling" | "settled" | null }): {
  label: string;
  tone: Tone;
} {
  if (row.settlement === "settled") {
    return { label: "Settled", tone: "green" };
  }
  if (row.settlement === "settling") {
    return { label: "Settling", tone: "amber" };
  }
  return { label: statusLabel(row.status), tone: statusTone(row.status) };
}

interface AttentionRow {
  key: string;
  label: string;
  detail: string;
  href: string;
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
  competition: { id: string; slug: string; name: string; status: string },
  dash: HomeDashboardData,
): Promise<AttentionRow | null> {
  if (competition.status === "registration_open") {
    const dashboard = await registrationDashboard(competition.slug, {});
    // DA-35: `stats` is now absent for a viewer who cannot review — the same
    // condition `canReview` already expressed, now carried by the type.
    const stats = dashboard?.stats;
    if (stats !== undefined && stats.submitted > 0) {
      return {
        key: `reg-${competition.id}`,
        label: `${String(stats.submitted)} registration${stats.submitted === 1 ? "" : "s"} to review`,
        detail: competition.name,
        href: `/seasons/${competition.slug}/registrations`,
      };
    }
    return null;
  }
  if (competition.status === "registration_closed") {
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

function rupees(value: number): string {
  return formatPaiseINR(paise(value));
}

/**
 * Compact INR for tiles: ₹48,000 / ₹1.2L / ₹2.4Cr.
 *
 * There is no "K" rung. The Indian numbering system groups at thousand, lakh
 * and crore, and its written short forms are L and Cr — "₹48K" is a scale
 * borrowed from a different system, sitting one step below "lakh" in the same
 * sentence. Below a lakh the number is simply grouped the Indian way (48,000),
 * which is both correct and shorter to read than an abbreviation.
 */
function rupeesShort(value: number): string {
  const r = value / 100;
  if (r >= 10_000_000) return `₹${(r / 10_000_000).toFixed(r % 10_000_000 === 0 ? 0 : 2)}Cr`;
  if (r >= 100_000) return `₹${(r / 100_000).toFixed(r % 100_000 === 0 ? 0 : 1)}L`;
  return `₹${Math.round(r).toLocaleString("en-IN")}`;
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
const IST = "Asia/Kolkata";
const IST_HOUR = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST,
  hour: "2-digit",
  hourCycle: "h23",
});
const IST_DAY = new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "2-digit" });
const IST_MONTH = new Intl.DateTimeFormat("en-IN", { timeZone: IST, month: "short" });

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
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [session, params] = await Promise.all([currentSession(), searchParams]);
  if (session === null) {
    redirect("/login?next=/home");
  }
  if (session.name === null || session.name.trim() === "") {
    redirect("/onboarding");
  }
  return (
    <main className="home">
      <Suspense fallback={<LoadingState variant="page" />}>
        <HomeBody
          personId={session.personId}
          name={session.name}
          focusSlug={typeof params.season === "string" ? params.season : null}
        />
      </Suspense>
    </main>
  );
}

/** The season /home leads with when the URL names none. */
const IN_FLIGHT = new Set(["setup", "registration_open", "registration_closed"]);

async function HomeBody({
  personId,
  name,
  focusSlug,
}: {
  personId: string;
  name: string;
  /** `?season=` — the hero's switcher writes it; anything unknown is ignored. */
  focusSlug: string | null;
}) {
  const [view, schedule, registrationsMine, dash, hasProfile, completeness, roles] =
    await Promise.all([
      competitionsView(),
      organizerScheduleView(),
      myRegistrations(personId),
      homeDashboard(),
      hasPlayerProfile(personId),
      profileCompletenessFor(personId),
      rolesOf(personId),
    ]);
  /*
   * WHO IS READING (launch polish, Phase 2). The organizer dashboard below —
   * hero, journey, figures, attention, seasons, activity — is for people who
   * MANAGE a club. A team owner, a plain member and a player used to get it
   * too, with an offer to create tournaments they had no power to create.
   */
  const manages = roles.organizes.length > 0;
  const managedOrgs = new Set(roles.organizes.map((club) => club.orgId));
  const brandNew =
    !manages &&
    roles.memberOf.length === 0 &&
    roles.owns.length === 0 &&
    roles.conducts.length === 0 &&
    !roles.plays;
  const team = currentTeam(roles);
  // PI-1: nudge only someone the platform can see IS a player (a registration
  // or a profile row); a pure organizer's home never asks for a bowling style.
  const showProfileNudge =
    (registrationsMine.length > 0 || hasProfile) && completeness.done < completeness.total;
  /*
   * The sport this person most recently registered in — the career link should
   * take them to a page with their record on it. The LAST row: `myRegistrations`
   * is ordered by start date ascending.
   */
  const careerPack = sportPackFor(registrationsMine[registrationsMine.length - 1]?.sport ?? null);
  const careerSport = careerPack.key;
  const careerSportLabel = careerPack.label.toLowerCase();

  // The night in progress leads the page (managers only).
  const liveRow = dash.auctions.find((auction) => auction.status === "live") ?? null;
  // The live panel owns the live auction, so the list lists only the rest.
  const otherAuctions = dash.auctions.filter((auction) => auction.auctionId !== liveRow?.auctionId);

  /*
   * THE SEASON IN FOCUS — what the club hero, the journey row and the four
   * figures describe. The switcher's choice when it names one of this person's
   * managed seasons; otherwise the live night, then the newest season still in
   * flight, then the newest of all (the list is newest-created first).
   */
  const managedSeasons = view.competitions.filter((competition) =>
    managedOrgs.has(competition.orgId),
  );
  const focus = !manages
    ? undefined
    : (managedSeasons.find((competition) => competition.slug === focusSlug) ??
      managedSeasons.find((competition) => competition.slug === liveRow?.competitionSlug) ??
      managedSeasons.find(
        (competition) =>
          IN_FLIGHT.has(competition.status) &&
          dash.top.find((row) => row.slug === competition.slug)?.settlement !== "settled",
      ) ??
      managedSeasons[0]);

  // The scan used to be a sequential loop of composite reads; one batch now,
  // with the live board and the focus season's overview riding along.
  // Only managers are asked what is waiting on them.
  const scanned = manages ? view.competitions.slice(0, ATTENTION_SCAN_LIMIT) : [];
  const [liveBoard, focusOverview, scannedRows] = await Promise.all([
    liveRow === null || !manages
      ? Promise.resolve(null)
      : auctionDashboard(liveRow.competitionSlug).then((board) => board?.overview ?? null),
    focus === undefined ? Promise.resolve(null) : seasonOverviewView(focus.slug),
    Promise.all(scanned.map((competition) => attentionFor(competition, dash))),
  ]);
  const attention = scannedRows.filter((row): row is AttentionRow => row !== null);
  const unscanned = view.competitions.length - scanned.length;

  const greeting = greetingFor(new Date(), name);
  const chartMax = Math.max(...dash.money.thisWeek, ...dash.money.lastWeek, 0);
  const openCount = view.competitions.filter(
    (competition) => competition.status === "registration_open",
  ).length;
  const liveCount = dash.auctions.filter((auction) => auction.status === "live").length;

  // Portfolio context belongs in the header line, not in a card of its own.
  const headline = manages
    ? [
        `${String(dash.stats.competitions)} season${dash.stats.competitions === 1 ? "" : "s"}`,
        ...(openCount > 0 ? [`${String(openCount)} accepting entries`] : []),
        ...(liveCount > 0 ? [`${String(liveCount)} auction live now`] : []),
      ].join(" · ")
    : [
        ...(team !== null ? [`Owner · ${team.teamName}`] : []),
        ...(roles.plays
          ? [
              `${String(registrationsMine.length)} season${registrationsMine.length === 1 ? "" : "s"} played`,
            ]
          : []),
        ...(roles.memberOf.length > 0 && team === null
          ? [`Member of ${roles.memberOf.map((club) => club.name).join(", ")}`]
          : []),
      ].join(" · ") || "Welcome";

  /* ---- where this organizer actually is ---------------------------------
   *
   * A club with nothing in it used to unfurl the whole analytics dashboard as
   * a skeleton of zeros. The five rungs below are derived from data already
   * loaded — no extra read — and the ladder owns the page until the last one
   * is done.
   */
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
  // The ladder retires when the LAST rung is done — rungs can complete out of
  // order (a one-off season leaves the tournament rung open forever).
  const currentRung = rungs.findIndex((rung) => !rung.done);
  // An ORGANIZER's first-run guide. A brand-new account chooses a path first
  // (the next-step card); a player or a member never climbs it.
  const laddering = manages && currentRung !== -1 && !(rungs[rungs.length - 1]?.done ?? false);

  const latest = registrationsMine[registrationsMine.length - 1] ?? null;
  const nextStep = laddering
    ? null
    : chooseNextStep({
        ownedTeam: team,
        managedLive:
          manages && liveRow !== null
            ? { competitionSlug: liveRow.competitionSlug, competitionName: liveRow.competitionName }
            : null,
        attention,
        latestEntry:
          latest === null
            ? null
            : { competitionName: latest.competitionName, status: latest.status },
        brandNew,
        conducting:
          roles.conducts.find(
            (row) => row.auctionStatus !== "completed" && row.auctionStatus !== "reconciled",
          ) ?? null,
      });

  /* ---- which panels have earned their space ------------------------------ */
  const moneyTotal =
    dash.money.collectedPaise + dash.money.outstandingPaise + dash.money.waivedPaise;
  // One capture is not a trend: a lone payment drew six flat days and a spike.
  const chartDays = [...dash.money.thisWeek, ...dash.money.lastWeek].filter(
    (value) => value > 0,
  ).length;
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

  const liveDone =
    liveRow !== null && liveRow.lotsTotal > 0 && liveRow.lotsSold === liveRow.lotsTotal;

  const bySlug = new Map(view.competitions.map((competition) => [competition.slug, competition]));
  const seasonMeta = (slug: string): string | null => {
    const competition = bySlug.get(slug);
    if (competition === undefined) return null;
    const parts = [
      dateRange(competition.startsOn, competition.endsOn),
      competition.location,
    ].filter((part): part is string => part !== null);
    return parts.length === 0 ? null : parts.join(" · ");
  };

  // Offered to people who MANAGE a club, in the clubs they manage — the same
  // gate as the top bar's "+ New tournament".
  const creatableOrgs = view.orgs.filter((org) => managedOrgs.has(org.id));
  const createCard =
    manages && creatableOrgs.length > 0 ? (
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
          },
          { withTeams: false },
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
    setup: `${focusBase}/teams`,
    registration: `${focusBase}/registrations`,
    auction: `${focusBase}/auction`,
    // The Money tab 404s without `settlement.view`: no link beats a dead end.
    settlement: focusOverview?.viewer.canSettle === true ? `${focusBase}/money` : undefined,
  };
  const journeyIcon: Record<string, ReactNode> = {
    setup: <IconTrophy size={14} />,
    registration: <IconFileCheck size={14} />,
    auction: <IconGavel size={14} />,
    settlement: <IconRupee size={14} />,
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
      tone={attentionCount > 0 ? "red" : "green"}
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
                <IconTile icon={<IconBolt />} tone="amber" size="sm" />
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
          <IconTile icon={<IconCheckCircle />} tone="green" size="lg" />
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
      {/* The greeting IS this surface's title and the portfolio line its lede;
          both ride the shell's bar, and so does "+ New tournament"
          (`app/@action/home`). */}
      <PageTitle title={greeting} subtitle={headline} />

      {laddering ? <SetupLadder rungs={rungs} current={currentRung} /> : null}
      {/* Everyone who does not run a club opens on their one next step. */}
      {!manages && nextStep !== null ? <NextStepBanner step={nextStep} /> : null}
      {!manages && team !== null ? <OwnerSection team={team} /> : null}

      {/* ---- the night in progress: nothing outranks a live auction ---- */}
      {manages && liveRow !== null ? (
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

      {/* ---- the club hero, its road and its four figures ---- */}
      {manages && focusOverview !== null ? (
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
        />
      ) : null}

      {manages && journey !== null ? (
        <div className="home-journey">
          <JourneyStepper
            label={`${focusOverview?.competition.name ?? "Season"} progress`}
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
                          of your seasons {(stageCount[step.key] ?? 0) === 1 ? "is" : "are"} here
                        </VisuallyHidden>
                      </span>
                    ) : null}
                  </>
                ),
                state: step.state,
                hint: step.hint,
                icon: journeyIcon[step.key],
              };
              return href === undefined ? item : { ...item, href };
            })}
          />
        </div>
      ) : null}

      {manages && focusOverview !== null ? (
        <StatGrid testId="home-figures">
          <StatCard
            icon={<IconUsers />}
            tone="green"
            value={focusOverview.teamCount.toLocaleString("en-IN")}
            label="Teams"
            href={`${focusBase}/teams`}
            linkComponent={Link}
          />
          <StatCard
            icon={<IconUser />}
            tone="blue"
            value={focusOverview.approvedPlayers.toLocaleString("en-IN")}
            label="Players"
            hint={
              focusOverview.pendingPlayers > 0
                ? `${focusOverview.pendingPlayers.toLocaleString("en-IN")} to review`
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
              tone="amber"
              value={rupeesShort(focusOverview.purseCommitted)}
              label="Purse committed"
              {...(focusOverview.pursePct != null
                ? { hint: `${String(focusOverview.pursePct)}% of every purse` }
                : {})}
              href={`${focusBase}/auction`}
              linkComponent={Link}
            />
          ) : (
            <StatCard
              icon={<IconCalendar />}
              tone="amber"
              value={focusOverview.fixtureCount.toLocaleString("en-IN")}
              label="Fixtures"
              href={`${focusBase}/fixtures`}
              linkComponent={Link}
            />
          )}
          <StatCard
            icon={<IconGavel />}
            tone="purple"
            value={`${String(focusOverview.lotsSold)}/${String(focusOverview.lotsTotal)}`}
            label="Lots sold"
            hint={focusOverview.lotsTotal === 0 ? "No lots yet" : `${String(lotsPct)}%`}
            progress={lotsPct}
            href={`${focusBase}/auction`}
            linkComponent={Link}
          />
        </StatGrid>
      ) : null}

      {manages && team !== null ? <OwnerSection team={team} /> : null}

      {manages ? (
        <CardGrid weight="wide-left">
          {/* ================= LEFT ================= */}
          <div className="home-col">
            {!laddering ? attentionCard : null}

            {showSeasons ? (
              <SectionCard
                flush
                icon={<IconTrophy />}
                tone="gold"
                title="Top seasons"
                action={
                  <Link href="/tournaments?view=seasons" className="home-more">
                    View all
                    <IconArrowRight size={14} />
                  </Link>
                }
              >
                {/* Two renderings, one visible at a time (see home.css): a
                    table on a laptop, one card per season on a phone — a fixed
                    table left the name 0px wide at 390. */}
                <div className="home-table-wrap" data-testid="home-competitions">
                  <table className="home-table">
                    <thead>
                      <tr>
                        <th>Season</th>
                        <th className="home-num">Teams</th>
                        <th className="home-num">Players</th>
                        <th>Status</th>
                        <th className="home-end">
                          <VisuallyHidden>Actions</VisuallyHidden>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {dash.top.map((row) => {
                        const badge = seasonBadge(row);
                        const meta = seasonMeta(row.slug);
                        return (
                          <tr key={row.slug}>
                            <td>
                              <span className="home-tcell">
                                <span className="home-crest" aria-hidden>
                                  {monogram(row.name)}
                                </span>
                                <span className="home-tcell-text">
                                  <Link href={`/seasons/${row.slug}`}>{row.name}</Link>
                                  {meta !== null || row.canSeeMoney ? (
                                    <span>
                                      {[
                                        meta,
                                        row.canSeeMoney
                                          ? `${rupeesShort(row.collectedPaise)} collected`
                                          : null,
                                      ]
                                        .filter((part) => part !== null)
                                        .join(" · ")}
                                    </span>
                                  ) : null}
                                </span>
                              </span>
                            </td>
                            <td className="home-num home-mono">{row.teams}</td>
                            <td className="home-num home-mono">{row.registrations}</td>
                            <td>
                              <Pill tone={badge.tone}>{badge.label}</Pill>
                            </td>
                            <td className="home-end">
                              <Link
                                href={`/seasons/${row.slug}`}
                                className="home-view"
                                aria-label={`View ${row.name}`}
                              >
                                View
                                <IconArrowRight size={14} />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <ul className="home-season-cards">
                    {dash.top.map((row) => {
                      const badge = seasonBadge(row);
                      const meta = seasonMeta(row.slug);
                      return (
                        <li key={row.slug}>
                          <Link href={`/seasons/${row.slug}`} className="home-season-card">
                            <span className="home-crest" aria-hidden>
                              {monogram(row.name)}
                            </span>
                            <span className="home-season-main">
                              <strong className="home-season-name">{row.name}</strong>
                              <span className="home-season-meta">
                                {[
                                  `${String(row.teams)} team${row.teams === 1 ? "" : "s"}`,
                                  `${String(row.registrations)} player${row.registrations === 1 ? "" : "s"}`,
                                  meta,
                                ]
                                  .filter((part) => part !== null)
                                  .join(" · ")}
                              </span>
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
                tone="blue"
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
                      <span className="home-chart-peak">Peak {rupeesShort(chartMax)}/day</span>
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
                        stroke="var(--accent)"
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
                        (label, index) =>
                          `${label} ${rupeesShort(dash.money.thisWeek[index] ?? 0)}`,
                      ).join(", ")}
                      .
                    </VisuallyHidden>
                  </div>
                ) : null}
                <div className="home-money">
                  <MoneyCell href={dash.moneyHref} label="Collected" tone="remaining">
                    {rupees(dash.money.collectedPaise)}
                  </MoneyCell>
                  <MoneyCell href={dash.moneyHref} label="Outstanding" tone="frozen">
                    {rupees(dash.money.outstandingPaise)}
                  </MoneyCell>
                  <MoneyCell href={dash.moneyHref} label="Waived" tone="spent">
                    {rupees(dash.money.waivedPaise)}
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
                tone="gold"
                title="Active auctions"
                action={
                  <Link href="/tournaments?view=seasons" className="home-more">
                    View all
                    <IconArrowRight size={14} />
                  </Link>
                }
              >
                {otherAuctions.length === 0 ? (
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
                                Spend {rupeesShort(auction.spendPaise)} · Lots {auction.lotsSold}/
                                {auction.lotsTotal}
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
              <SectionCard icon={<IconCalendar />} tone="blue" title="Upcoming events">
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
                    ctaLabel="Generate a schedule"
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
                              <b>{when !== null ? IST_DAY.format(when) : "--"}</b>
                              <span>
                                {when !== null ? IST_MONTH.format(when).toUpperCase() : "TBD"}
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
                tone="purple"
                title="Recent activity"
                action={
                  <Link href="/inbox" className="home-more">
                    View all
                    <IconArrowRight size={14} />
                  </Link>
                }
              >
                <ul className="home-list">
                  {dash.activity.map((row) => {
                    const style = activityStyle(row.action);
                    return (
                      <li key={row.id} className="home-feed">
                        <IconTile icon={style.icon} tone={style.tone} size="sm" />
                        <span className="home-row-text">
                          <strong>
                            {row.action === "finops.summary"
                              ? `${String(row.count)} finance ${row.count === 1 ? "update" : "updates"}`
                              : activityLabel(row.action)}
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
      ) : null}

      {/* A member who manages nothing still belongs to a club: its seasons,
          as plain doors, without the organizer's figures or offers. */}
      {!manages && view.competitions.length > 0 ? (
        <SectionCard
          icon={<IconTrophy />}
          tone="gold"
          title={`Seasons in your ${roles.memberOf.length === 1 ? "club" : "clubs"}`}
        >
          <ul className="home-list">
            {view.competitions.map((competition) => {
              const top = dash.top.find((row) => row.slug === competition.slug);
              const badge = seasonBadge({
                status: competition.status,
                settlement: top?.settlement ?? null,
              });
              const meta = seasonMeta(competition.slug);
              return (
                <li key={competition.id}>
                  <Link href={`/seasons/${competition.slug}`} className="home-row-link">
                    <span className="home-crest" aria-hidden>
                      {monogram(competition.name)}
                    </span>
                    <span className="home-row-text">
                      <strong>{competition.name}</strong>
                      <span>
                        {[competition.orgName, meta].filter((part) => part !== null).join(" · ")}
                      </span>
                    </span>
                    <Pill tone={badge.tone}>{badge.label}</Pill>
                  </Link>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      ) : null}

      {!manages ? shortcuts : null}

      {showProfileNudge ? (
        <Notice
          tone="info"
          icon={<IconUser size={20} />}
          testId="home-profile-nudge"
          title={`Complete your player profile — ${String(completeness.done)}/${String(completeness.total)}`}
          action={
            <ButtonLink href="/account" variant="secondary" size="sm">
              Finish it
            </ButtonLink>
          }
        >
          {completeness.missing.length === 1
            ? "One thing left"
            : `${String(completeness.missing.length)} things left`}{" "}
          — the next registration form starts filled in.
        </Notice>
      ) : null}

      {registrationsMine.length > 0 ? (
        <SectionCard
          data-testid="home-registrations"
          icon={<IconFileCheck />}
          tone="green"
          title="My registrations"
          action={
            /*
             * The career page of a sport this person ACTUALLY plays, taken from
             * their most recent registration — not "My cricket" for everyone.
             */
            <Link href={`/me/${careerSport}`} className="home-more" data-testid="home-career-link">
              My {careerSportLabel}
              <IconArrowRight size={14} />
            </Link>
          }
        >
          <ul className="home-list">
            {registrationsMine.map((registration) => (
              <li key={registration.registrationId} className="home-reg">
                <Link
                  href={`/seasons/${registration.competitionSlug}/register`}
                  className="home-row-link"
                >
                  <span className="home-crest" aria-hidden>
                    {monogram(registration.competitionName)}
                  </span>
                  <span className="home-row-text">
                    <strong>{registration.competitionName}</strong>
                    <span>
                      {registration.orgName} ·{" "}
                      {roleLabelIn(sportPackFor(registration.sport), registration.role)} ·{" "}
                      {registration.number}
                    </span>
                  </span>
                  <Pill tone={REG_TONE[registration.status] ?? "neutral"}>
                    {registration.status}
                  </Pill>
                </Link>
                {/* The player's own card — a sibling of the row link, never
                    nested in it, and offered only where a verdict exists. */}
                {registration.posterReady ? (
                  <Link
                    href={`/seasons/${registration.competitionSlug}/posters`}
                    className="home-own-poster"
                    data-testid="my-poster"
                  >
                    Get your card
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
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
    <div className="home-blank">
      <IconTile icon={icon} tone="gold" size="md" />
      <span className="home-row-text">
        <strong>{title}</strong>
        <span>{text}</span>
      </span>
      <ButtonLink href={ctaHref} variant="secondary" size="sm" className="home-blank-cta">
        {ctaLabel}
      </ButtonLink>
    </div>
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

function greetingFor(now: Date, name: string | null): string {
  const hour = Number(IST_HOUR.format(now));
  const daypart = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return name !== null && name.trim() !== "" ? `${daypart}, ${name.trim()}` : daypart;
}
