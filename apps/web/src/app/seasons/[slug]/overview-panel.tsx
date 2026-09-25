"use client";

import {
  Button,
  CardGrid,
  Dialog,
  Field,
  HeroBanner,
  IconArrowRight,
  IconBall,
  IconBat,
  IconCalendar,
  IconCheckCircle,
  IconClock,
  IconCopy,
  IconExternal,
  IconEye,
  IconEyeOff,
  IconInfo,
  IconLayers,
  IconLock,
  IconPin,
  IconRefresh,
  IconShieldCheck,
  IconStar,
  IconTile,
  IconTrophy,
  IconUser,
  IconUsers,
  IconWallet,
  JourneyStepper,
  Notice,
  Pill,
  SectionCard,
  Select,
  StatCard,
  StatGrid,
  VisuallyHidden,
  buttonClassName,
  useToast,
  type JourneyStep,
  type KitTone,
} from "@desiauction/ui";
import { ENTRY_CATEGORIES, entryCategoryLabel, roleOptions } from "@desiauction/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { roleLabeller } from "../../../lib/role-label";
import { useMoney } from "../../../components/money-unit";
import { exactINR } from "../../../lib/inr";

import {
  advanceCompetitionAction,
  cloneCompetitionAction,
  setCompetitionVisibilityAction,
  updateCompetitionDetailsAction,
  type DetailsField,
  type SeasonOverviewView,
} from "../../../server/competition/actions";
import { formatDate } from "../../../lib/format-date";
import { track } from "../../../lib/telemetry";
import { SeasonImageCard } from "./season-image-card";
import { ShareRegistration } from "./registrations/share-registration";

/**
 * The Season Workspace overview (founder mockup 1, 2026-09-19).
 *
 * A dashboard, not a desk: everything here READS. The work — adding teams,
 * triaging registrations, running the auction — lives in the tabs above, which
 * are full workspaces of their own. The exceptions earn their place because
 * they are statements about the season as a whole rather than about any one
 * tab: advancing the lifecycle (the next-step banner under the journey, which
 * IS the lifecycle), editing the season's own identity — its details, crest and
 * cover photo — and publishing the public page.
 *
 * Top to bottom: the hero (cover photo, status, where and when), the six-step
 * journey with the one next step under it, four figures, who is spending and
 * what the pool holds, then the season's public face.
 */

// The lifecycle's next gate (doc 44's one-gate-at-a-time).
const NEXT_STEP: Record<string, { to: string; label: string } | null> = {
  draft: { to: "setup", label: "Begin setup" },
  setup: { to: "registration_open", label: "Open registration" },
  registration_open: { to: "registration_closed", label: "Close registration" },
  // DA-10: registration_closed is the LAST competition status — the lifecycle
  // continues in the auction, which has its own machine. Offering only
  // "Reopen registration" here made the single forward-looking control on the
  // page point backwards for the whole second half of the season.
  registration_closed: null,
};

/** What the banner says while a competition gate is next. */
const NEXT_COPY: Record<string, { title: string; body: string }> = {
  draft: {
    title: "Start setting this season up.",
    body: "Setup is where the teams come in. Registration opens after that.",
  },
  setup: {
    title: "Next: open registration.",
    body: "Players sign up through the registration link; every entry lands in Registrations for you to approve.",
  },
  registration_open: {
    title: "Registration is open.",
    body: "Close it when the pool is ready — the auction is built from the approved players.",
  },
};

/** What just happened, said out loud — every advance used to be silent (DA-16). */
const ADVANCE_ANNOUNCEMENT: Record<string, string> = {
  setup: "Setup begun. Add your teams next.",
  registration_open: "Registration is open. Share the link to recruit players.",
  registration_closed: "Registration closed. The auction is next.",
};

/**
 * Where the season actually goes next once intake is shut (DA-10).
 *
 * `canSettle` is the gate on the last two rungs and it is not optional. The
 * settlement desk is `settlement.view`, which by design is NOT implied by
 * `org:owner` or by `competition.manage` — the capability partition keeps money
 * powers an explicit act of trust. Where the door is locked the banner says who
 * holds the key instead of pointing at it.
 */
function nextDestination(
  slug: string,
  auctionStatus: string | null,
  canSettle: boolean,
  points: boolean,
): { href: string; label: string; title: string } | { locked: true } {
  if (auctionStatus === null) {
    return {
      href: `/seasons/${slug}/auction`,
      label: "Create the auction",
      title: "Registration is closed. The auction is next.",
    };
  }
  if (auctionStatus === "scheduled") {
    return {
      href: `/seasons/${slug}/auction`,
      label: "Open the auction",
      title: "The auction is set up. Open it when the room is ready.",
    };
  }
  if (auctionStatus === "live" || auctionStatus === "paused") {
    return {
      href: `/seasons/${slug}/auction/cockpit`,
      label: "Enter the auction room",
      title:
        auctionStatus === "live" ? "The auction is live." : "The auction is paused mid-session.",
    };
  }
  if (points) {
    // A points season (0091) ends at the hammer: there is no money to settle,
    // so the onward step is the squads the night produced.
    return {
      href: `/seasons/${slug}/teams`,
      label: "See the squads",
      title: "The auction is done. It was played for points — nothing to settle.",
    };
  }
  if (!canSettle) {
    return { locked: true };
  }
  if (auctionStatus === "completed") {
    return {
      href: `/seasons/${slug}/money`,
      label: "Open settlement",
      title: "The auction is done. Settle the money next.",
    };
  }
  return {
    href: `/seasons/${slug}/money`,
    label: "Review settlement",
    title: "The season's books are being settled.",
  };
}

const STEP_LABELS = ["Setup", "Teams", "Registration", "Auction", "Fixtures", "Settlement"];

/** A points season (0091) has no Settlement rung — nothing is ever owed. */
function stepLabels(view: SeasonOverviewView): readonly string[] {
  return view.competition.auctionUnit === "points" ? STEP_LABELS.slice(0, 5) : STEP_LABELS;
}

/**
 * The six gates, every one of them derived from data this season actually
 * holds (DA-09): Fixtures reads the season's fixture count, Settlement reads
 * the settlement case's own discharge — the same fold the money desk renders.
 * The order is the lifecycle's, not the tab strip's.
 */
function clearedRungs(view: SeasonOverviewView): boolean[] {
  const status = view.competition.status;
  return [
    status !== "draft",
    view.teamCount > 0,
    status === "registration_closed",
    view.auctionStatus === "completed" || view.auctionStatus === "reconciled",
    view.fixtureCount > 0,
    ...(view.competition.auctionUnit === "points"
      ? []
      : [view.settlement !== null && view.settlement.discharged]),
  ];
}

/** Where each rung's work happens — linked only for someone who may go there. */
function stepHref(index: number, slug: string, view: SeasonOverviewView): string | undefined {
  const base = `/seasons/${slug}`;
  if (index === 5) {
    return view.viewer.canSettle ? `${base}/money` : undefined;
  }
  if (!view.viewer.canManage) {
    return undefined;
  }
  return [
    undefined,
    `${base}/teams`,
    `${base}/registrations`,
    `${base}/auction`,
    `${base}/fixtures`,
  ][index];
}

// The top bar's grammar (product-shell SEASON_STATUS), so the two pills agree.
const STATUS_PILL: Record<string, { tone: KitTone; icon: ReactNode }> = {
  draft: { tone: "neutral", icon: <IconCalendar /> },
  setup: { tone: "neutral", icon: <IconCalendar /> },
  registration_open: { tone: "green", icon: <IconCheckCircle /> },
  registration_closed: { tone: "amber", icon: <IconLock /> },
};

/** When: the one fact a season is most often looked up for. */
function seasonDates(view: SeasonOverviewView): string {
  const { startsOn, endsOn } = view.competition;
  return startsOn !== null && endsOn !== null
    ? `${formatDate(startsOn)} – ${formatDate(endsOn)}`
    : startsOn !== null
      ? `From ${formatDate(startsOn)}`
      : endsOn !== null
        ? `Until ${formatDate(endsOn)}`
        : "Dates not set";
}

/** The hero's second action, following the state instead of ignoring it. */
function secondaryAction(
  view: SeasonOverviewView,
  slug: string,
  finished: boolean,
): { href: string; label: string } {
  if (finished) {
    return view.viewer.canSeeMoney && view.competition.auctionUnit === "inr"
      ? { href: `/seasons/${slug}/money`, label: "View results" }
      : { href: `/seasons/${slug}/teams`, label: "View squads" };
  }
  if (view.teamCount === 0) {
    return { href: `/seasons/${slug}/teams`, label: "Add teams" };
  }
  if (view.pendingPlayers > 0) {
    return {
      href: `/seasons/${slug}/registrations`,
      label: `Review ${String(view.pendingPlayers)} ${view.pendingPlayers === 1 ? "registration" : "registrations"}`,
    };
  }
  if (view.competition.status === "registration_closed" && view.auctionStatus === null) {
    return { href: `/seasons/${slug}/auction`, label: "Set up the auction" };
  }
  return { href: `/seasons/${slug}/fixtures`, label: "Fixtures" };
}

/** What is still missing before this season may open registration (DA-11). */
function missingForRegistration(competition: SeasonOverviewView["competition"]): string[] {
  const missing: string[] = [];
  if (competition.name.trim().length < 3) {
    missing.push("a name");
  }
  if (competition.startsOn === null || competition.endsOn === null) {
    missing.push("dates");
  }
  if (competition.location === null || competition.location.trim() === "") {
    missing.push("a location");
  }
  return missing;
}

/**
 * A role's mark in the pool card: the bat and the ball for cricket's roles,
 * and a plain person for every other sport's — a football pool drawn with
 * cricket kit would be the multi-sport defect again, in pictures.
 */
const ROLE_MARK: Record<string, { icon: ReactNode; tone: KitTone }> = {
  batter: { icon: <IconBat />, tone: "amber" },
  bowler: { icon: <IconBall />, tone: "red" },
  all_rounder: { icon: <IconStar />, tone: "purple" },
  wicket_keeper: { icon: <IconShieldCheck />, tone: "blue" },
};
const OTHER_ROLE_MARK = { icon: <IconUser />, tone: "neutral" as KitTone };

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** A share as words: a real but tiny spend reads "<1%", never a false "0%". */
function shareLabel(part: number, pct: number): string {
  return part > 0 && pct === 0 ? "<1%" : `${String(pct)}%`;
}

/** The first letter a team is known by, for its colour tile. */
function teamInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "•";
}

export function OverviewPanel({
  view,
  slug,
  pass,
}: {
  view: SeasonOverviewView;
  slug: string;
  /** The season pass card, laid into the page's last row. */
  pass?: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  // The season's own roles: named through the season's sport pack, so a
  // football season's pool does not read in cricket's words.
  const labelOf = useMemo(
    () => roleLabeller(roleOptions(view.competition.sport)),
    [view.competition.sport],
  );
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // DA-16: the control that started the work takes focus back when the work is
  // done — once it is no longer `disabled` by its own loading state, which is
  // why this is an effect and not a call at the end of the handler.
  const advanceRef = useRef<HTMLButtonElement>(null);
  const publishRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef<"advance" | "publish" | null>(null);
  const journeyRef = useRef<HTMLDivElement>(null);

  const status = view.competition.status;
  const step = NEXT_STEP[status] ?? null;
  const points = view.competition.auctionUnit === "points";
  const money = useMoney();
  const steps = stepLabels(view);
  const onward = nextDestination(slug, view.auctionStatus, view.viewer.canSettle, points);
  const locked = "locked" in onward;
  const cleared = clearedRungs(view);
  const activeIndex = cleared.indexOf(false);
  const auctionDone = cleared[3] === true;
  // The enum has no `completed` value (that is a migration), but the fact is
  // derivable: the auction is over and the books are discharged.
  // A points season is finished at the hammer: there are no books to discharge.
  const finished =
    auctionDone && (points || (view.settlement !== null && view.settlement.discharged));
  const missing = missingForRegistration(view.competition);
  const secondary = secondaryAction(view, slug, finished);
  const canPublish = view.publishBlockers.length === 0;
  const isPublic = view.competition.visibility === "public";
  const previewable = isPublic || status === "registration_open";
  // ONE gold action per screen: the next step when there is one; otherwise the
  // public page's own (the mockup's "View public page"), or "Run it again" on a
  // finished season.
  const nextIsPrimary =
    view.viewer.canManage &&
    !finished &&
    (step !== null || (status === "registration_closed" && !locked));
  const publicIsPrimary = !nextIsPrimary && !finished;

  useEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    if (pendingFocus === null || busy) {
      return;
    }
    (pendingFocus === "advance" ? advanceRef.current : publishRef.current)?.focus();
    pendingFocusRef.current = null;
  }, [busy, status, view.competition.visibility]);

  // On a phone the journey scrolls sideways and opened on "Setup · Teams" —
  // the two steps longest behind you. Bring the step you are on into view.
  useEffect(() => {
    const rail = journeyRef.current?.querySelector("ol");
    const here = rail?.querySelector('[aria-current="step"]') ?? rail?.lastElementChild;
    if (rail === null || rail === undefined || !(here instanceof HTMLElement)) {
      return;
    }
    if (rail.scrollWidth > rail.clientWidth) {
      rail.scrollLeft += here.getBoundingClientRect().left - rail.getBoundingClientRect().left - 8;
    }
  }, [activeIndex]);

  const advance = async () => {
    if (step === null) {
      return;
    }
    setBusy(true);
    const result = await advanceCompetitionAction(
      slug,
      step.to as SeasonOverviewView["competition"]["status"],
    );
    setBusy(false);
    if (result.ok) {
      setBlocked(false);
      toast({ title: ADVANCE_ANNOUNCEMENT[step.to] ?? "Season updated.", tone: "success" });
      router.refresh();
      pendingFocusRef.current = "advance";
    } else if (result.needsDetails === true) {
      // Naming three fields the product gave no way to set was the whole of
      // DA-11. The refusal now carries its own repair.
      setBlocked(true);
      pendingFocusRef.current = "advance";
    } else {
      toast({ title: result.error ?? "Could not advance.", tone: "danger" });
    }
  };

  // Retention ("run it again"): clone this season into a fresh draft and drop
  // the organizer into next season's setup.
  const runItAgain = async () => {
    setBusy(true);
    const result = await cloneCompetitionAction(slug);
    setBusy(false);
    if (result.ok && result.slug !== undefined) {
      track("competition.cloned");
      toast({ title: "New draft created from this season.", tone: "success" });
      router.push(`/seasons/${result.slug}`);
    } else {
      toast({ title: result.error ?? "Could not duplicate.", tone: "danger" });
    }
  };

  const setVisibility = async (visibility: "private" | "public") => {
    setBusy(true);
    const result = await setCompetitionVisibilityAction(slug, visibility);
    setBusy(false);
    setPublishOpen(false);
    if (result.ok) {
      toast({
        title: visibility === "public" ? "Public page published" : "Public page unpublished",
        tone: "success",
      });
      router.refresh();
      pendingFocusRef.current = "publish";
    } else {
      toast({ title: result.error ?? "Could not update.", tone: "danger" });
    }
  };

  const copyPublicLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/c/${slug}`);
      toast({ title: "Public page link copied", tone: "success" });
    } catch {
      toast({ title: "Couldn't copy — select the address and copy it.", tone: "danger" });
    }
  };

  const statusPill = finished
    ? { tone: "green" as KitTone, icon: <IconTrophy /> }
    : (STATUS_PILL[status] ?? { tone: "neutral" as KitTone, icon: <IconCalendar /> });

  const journey: JourneyStep[] = steps.map((label, index) => {
    const state = cleared[index] === true ? "done" : index === activeIndex ? "current" : "upcoming";
    const href = stepHref(index, slug, view);
    return {
      key: label,
      // The mark is decorative, so the state is said in words as well.
      label: (
        <>
          {label}
          <VisuallyHidden>
            {state === "done" ? " — done" : state === "current" ? " — in progress" : " — to do"}
          </VisuallyHidden>
        </>
      ),
      state,
      ...(href !== undefined ? { href } : {}),
    };
  });

  const runAgainButton = (primary: boolean) =>
    view.viewer.canManage ? (
      <Button
        variant={primary ? "primary" : "secondary"}
        loading={busy}
        data-testid="run-it-again"
        onClick={() => void runItAgain()}
      >
        <IconRefresh size={16} />
        Run it again
      </Button>
    ) : null;

  const readinessLink =
    view.viewer.canManage && (view.auctionStatus === null || view.auctionStatus === "scheduled") ? (
      <Link
        href={`/seasons/${slug}/readiness`}
        className={buttonClassName({ variant: "secondary" })}
        data-testid="open-readiness"
      >
        Review readiness
      </Link>
    ) : null;

  let nextNotice: ReactNode = null;
  if (view.viewer.canManage && !finished) {
    if (step !== null) {
      const copy = NEXT_COPY[status];
      nextNotice = (
        <Notice
          tone="info"
          icon={<IconInfo size={20} />}
          title={
            status === "registration_open" && view.pendingPlayers > 0
              ? `Registration is open — ${String(view.pendingPlayers)} waiting for your review.`
              : copy?.title
          }
          action={
            <>
              {readinessLink}
              <Button
                ref={advanceRef}
                onClick={() => void advance()}
                loading={busy}
                data-testid="advance-status"
              >
                {step.label}
                <IconArrowRight size={16} />
              </Button>
            </>
          }
          testId="next-step"
        >
          {copy?.body}
        </Notice>
      );
    } else if (status === "registration_closed" && !locked) {
      nextNotice = (
        <Notice
          tone="info"
          icon={<IconInfo size={20} />}
          title={onward.title}
          action={
            <>
              {readinessLink}
              {runAgainButton(false)}
              <Link
                href={onward.href}
                className={buttonClassName({ variant: "primary" })}
                data-testid="advance-status"
              >
                {onward.label}
                <IconArrowRight size={16} />
              </Link>
            </>
          }
          testId="next-step"
        />
      );
    } else if (status === "registration_closed" && locked) {
      nextNotice = (
        <Notice
          tone="warning"
          icon={<IconInfo size={20} />}
          title={`The auction is done. Settling it needs money authority for ${
            view.orgName === "" ? "this club" : view.orgName
          } — a separate grant from running the season.`}
          action={runAgainButton(false)}
          testId="settlement-locked"
        >
          Ask an owner of the club to give you one under Money &amp; roles.
        </Notice>
      );
    }
  }

  // The figures. Before an auction exists there is no purse and there are no
  // lots — two cards of zeroes about a thing that has not been created — so the
  // review queue takes their place.
  const approvedHint =
    view.pendingPlayers > 0 && view.auctionStatus !== null
      ? `${String(view.pendingPlayers)} awaiting review`
      : undefined;
  const lotsPct = percent(view.lotsSold, view.lotsTotal);

  return (
    <>
      <div className="ov-hero">
        <HeroBanner
          image={view.coverUrl}
          headingLevel={1}
          testId="season-hero"
          eyebrow={
            <span className="ov-hero-pills">
              <Pill tone={statusPill.tone} icon={statusPill.icon} testId="competition-status">
                {finished ? "completed" : status.replace(/_/g, " ")}
              </Pill>
              {view.auctionLive ? (
                <Pill tone="red" dot>
                  Auction live
                </Pill>
              ) : null}
            </span>
          }
          // The season's name is the page's one <h1>: the shell's page head
          // stands down on this route (page.tsx) and the hero carries it.
          title={<span data-testid="competition-name">{view.competition.name}</span>}
          meta={[
            <span key="when" className="ov-hero-fact" data-testid="season-meta">
              <IconCalendar />
              {seasonDates(view)}
            </span>,
            ...(view.competition.location !== null && view.competition.location !== ""
              ? [
                  <span key="where" className="ov-hero-fact">
                    <IconPin />
                    {view.competition.location}
                  </span>,
                ]
              : []),
            ...(view.orgName !== ""
              ? [
                  <Link
                    key="club"
                    href={`/org/${view.orgSlug}`}
                    className="ov-hero-fact ov-hero-club"
                  >
                    <IconUsers />
                    {view.orgName}
                  </Link>,
                ]
              : []),
          ]}
          actions={
            <>
              {view.viewer.canManage ? (
                <Button
                  variant="secondary"
                  className="ov-hero-btn"
                  data-tone="glass"
                  data-testid="open-season-settings"
                  onClick={() => {
                    setSettingsOpen(true);
                  }}
                >
                  Season details
                </Button>
              ) : null}
              <Link
                href={secondary.href}
                className={buttonClassName({ variant: "secondary" }, "ov-hero-btn")}
                data-tone="solid"
                data-testid="season-secondary"
              >
                {secondary.label}
              </Link>
              {view.auctionLive ? (
                <Link
                  href={`/seasons/${slug}/auction/live`}
                  className={buttonClassName({ variant: "secondary" }, "ov-hero-btn")}
                  data-tone="solid"
                >
                  Go to live auction
                  <IconArrowRight size={16} />
                </Link>
              ) : null}
            </>
          }
        />
      </div>

      <div className="ov-journey" data-testid="lifecycle-panel" ref={journeyRef}>
        <VisuallyHidden>
          <p data-testid="lifecycle-summary">
            {activeIndex === -1
              ? `All ${steps.length === 5 ? "five" : "six"} steps complete`
              : `Step ${String(activeIndex + 1)} of ${String(steps.length)} · ${
                  steps[activeIndex] ?? ""
                }`}
          </p>
        </VisuallyHidden>
        <JourneyStepper steps={journey} linkComponent={Link} />
        {finished ? (
          <Retrospective view={view} slug={slug} runAgain={runAgainButton(true)} />
        ) : (
          nextNotice
        )}
        {blocked && missing.length > 0 ? (
          <Notice
            tone="danger"
            icon={<IconInfo size={20} />}
            title={`This season still needs ${missing
              .join(", ")
              .replace(/, ([^,]*)$/, " and $1")} before registration can open.`}
            action={
              <Button
                variant="secondary"
                data-testid="open-season-settings-guard"
                onClick={() => {
                  setSettingsOpen(true);
                }}
              >
                {missing.includes("dates") ? "Add dates" : "Edit season details"}
              </Button>
            }
            testId="advance-blocked"
          />
        ) : null}
      </div>

      <StatGrid testId="season-figures">
        <StatCard
          icon={<IconUser />}
          tone="green"
          value={view.approvedPlayers}
          label="Approved players"
          {...(approvedHint !== undefined
            ? { hint: approvedHint, href: `/seasons/${slug}/registrations` }
            : {})}
          linkComponent={Link}
          testId="overview-approved"
        />
        {view.auctionStatus === null && view.pendingPlayers > 0 ? (
          <StatCard
            icon={<IconClock />}
            tone="amber"
            value={view.pendingPlayers}
            label="Awaiting your review"
            href={`/seasons/${slug}/registrations`}
            linkComponent={Link}
            testId="pending-tile"
          />
        ) : null}
        <StatCard
          icon={<IconUsers />}
          tone="red"
          value={view.teamCount}
          label={view.teamCount === 1 ? "Team" : "Teams"}
          testId="overview-teams"
        />
        {view.auctionStatus !== null && view.purseCommitted !== undefined ? (
          <StatCard
            icon={<IconWallet />}
            tone="amber"
            value={money.compact(view.purseCommitted)}
            label="Purse committed"
            {...(view.pursePct !== undefined && view.pursePct !== null
              ? { hint: `${shareLabel(view.purseCommitted, view.pursePct)} of the total purse` }
              : {})}
            testId="overview-purse"
          />
        ) : null}
        {view.auctionStatus !== null ? (
          <StatCard
            icon={<IconLayers />}
            tone="green"
            value={
              <>
                {view.lotsSold}
                <span className="ov-stat-of">/{view.lotsTotal}</span>
              </>
            }
            label="Lots sold"
            hint={`${String(lotsPct)}% of the pool`}
            progress={lotsPct}
            testId="overview-lots"
          />
        ) : null}
      </StatGrid>

      <div className="ov-grid">
        <CardGrid>
          <SectionCard
            title={view.lotsSold > 0 && view.viewer.canSeeMoney ? "Top teams by spend" : "Teams"}
            data-testid="team-spend-card"
            action={
              <Link className="ov-card-link" href={`/seasons/${slug}/teams`}>
                All teams
                <IconArrowRight size={16} />
              </Link>
            }
          >
            {view.topTeams.length === 0 ? (
              <div className="ov-empty">
                <p>
                  No teams yet. The auction issues one paddle per team, so this is the first thing
                  to build.
                </p>
                {view.viewer.canManage ? (
                  <Link
                    href={`/seasons/${slug}/teams`}
                    className={buttonClassName({ variant: "secondary" })}
                    data-testid="empty-add-teams"
                  >
                    Add teams
                  </Link>
                ) : null}
              </div>
            ) : (
              <ul className="ov-rows">
                {view.topTeams.slice(0, 5).map((team) => {
                  const spent = team.spend !== undefined && view.lotsSold > 0;
                  const pct =
                    team.spend !== undefined && team.purse !== undefined
                      ? percent(team.spend, team.purse)
                      : null;
                  return (
                    <li
                      key={team.teamId}
                      className="ov-team"
                      style={
                        team.color !== null
                          ? ({ "--team": team.color } as CSSProperties)
                          : undefined
                      }
                    >
                      <span className="ov-team-tile" aria-hidden>
                        {teamInitial(team.name)}
                      </span>
                      <span className="ov-team-name">{team.name}</span>
                      <span className="ov-team-figs">
                        {team.squadMax !== undefined && team.squadMax !== null ? (
                          <span>
                            <VisuallyHidden>Squad </VisuallyHidden>
                            {team.squad}/{team.squadMax}
                          </span>
                        ) : (
                          <span>
                            {team.squad} {team.squad === 1 ? "player" : "players"}
                          </span>
                        )}
                        {/* Before a hammer has fallen every team has spent ₹0, and
                          a column of "₹0" is furniture, not a reading. */}
                        {spent ? <span>{money.exact(team.spend ?? 0)}</span> : null}
                        {spent && pct !== null ? (
                          <span className="ov-team-pct">
                            {shareLabel(team.spend ?? 0, pct)}
                            <VisuallyHidden> of the purse</VisuallyHidden>
                          </span>
                        ) : null}
                      </span>
                      {spent && pct !== null && (team.spend ?? 0) > 0 ? (
                        <span className="ov-bar ov-team-bar" aria-hidden>
                          <span className="ov-bar-fill" style={{ width: `${String(pct)}%` }} />
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Pool by role"
            data-testid="pool-card"
            {...(view.viewer.canReview && view.poolByRole.length > 0
              ? {
                  action: (
                    <Link className="ov-card-link" href={`/seasons/${slug}/registrations`}>
                      View all
                      <IconArrowRight size={16} />
                    </Link>
                  ),
                }
              : {})}
          >
            {view.poolByRole.length === 0 ? (
              <div className="ov-empty">
                <p>
                  No approved players yet.{" "}
                  {status === "registration_open"
                    ? "Share the registration link — every entry lands in the Registrations tab for you to approve."
                    : "Players enter through the registration link once you open registration."}
                </p>
                {view.viewer.canReview && status === "registration_open" ? (
                  <ShareRegistration slug={slug} open seasonName={view.competition.name} />
                ) : null}
                {view.viewer.canReview && view.pendingPlayers > 0 ? (
                  <Link
                    href={`/seasons/${slug}/registrations`}
                    className={buttonClassName({ variant: "secondary" })}
                    data-testid="empty-review-registrations"
                  >
                    Review {view.pendingPlayers} waiting
                  </Link>
                ) : null}
              </div>
            ) : (
              <ul className="ov-rows">
                {view.poolByRole.map((entry) => {
                  const mark = (entry.role !== null ? ROLE_MARK[entry.role] : undefined) ?? {
                    ...OTHER_ROLE_MARK,
                  };
                  return (
                    <li key={entry.role ?? "none"} className="ov-role" data-tone={mark.tone}>
                      <IconTile icon={mark.icon} tone={mark.tone} />
                      <span className="ov-role-name">{labelOf(entry.role)}</span>
                      <span className="ov-role-count">{entry.count}</span>
                      <span className="ov-bar ov-role-bar" aria-hidden>
                        <span
                          className="ov-bar-fill"
                          style={{
                            width: `${String(percent(entry.count, view.poolByRole[0]?.count ?? 1))}%`,
                          }}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </CardGrid>
      </div>

      <div className="ov-grid">
        <CardGrid>
          {/* The season's own mark. It sits beside the public page because this
            is the mark that page puts on the internet. */}
          {view.viewer.canManage ? (
            <SeasonImageCard
              slug={slug}
              competitionId={view.competition.id}
              competitionName={view.competition.name}
              slot="logo"
              currentUrl={view.logoUrl}
            />
          ) : null}

          {/* DA-12: publishing has a block of its own, not a ghost button in the
            footer of a card about something else. */}
          <SectionCard
            title="Public page"
            data-testid="visibility-row"
            action={
              view.platformHold !== null ? (
                <Pill tone="red" testId="platform-hold-badge">
                  Taken down
                </Pill>
              ) : (
                <Pill tone={isPublic ? "green" : "neutral"} dot={isPublic}>
                  {isPublic ? "LIVE" : "Not listed"}
                </Pill>
              )
            }
          >
            <div className="ov-public">
              {previewable && view.platformHold === null ? (
                <div className="ov-url-row">
                  <span className="ov-url">
                    <span className="ov-url-text">/c/{slug}</span>
                    {isPublic ? (
                      <button
                        type="button"
                        className="ov-icon-btn"
                        aria-label="Copy the public page link"
                        onClick={() => void copyPublicLink()}
                      >
                        <IconCopy size={18} />
                      </button>
                    ) : null}
                  </span>
                  <a
                    className="ov-icon-btn ov-icon-btn-boxed"
                    href={`/c/${slug}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open the public page in a new tab"
                  >
                    <IconExternal size={18} />
                  </a>
                </div>
              ) : null}
              <p className="ov-muted">
                {view.platformHold !== null
                  ? "DesiAuction has taken this season’s public page down. Your season, registrations and auction are untouched — only the public page is gone."
                  : isPublic
                    ? "This season is listed publicly — anyone can see it and share it."
                    : "Publishing puts this season on the public directory, where players and spectators can find it."}
              </p>
              {view.viewer.canManage && !canPublish && !isPublic ? (
                <ul className="season-blockers" data-testid="publish-blockers">
                  {view.publishBlockers.map((blocker) => (
                    <li key={blocker.code} className="season-blocker">
                      <span>{blocker.message}</span>
                      {blocker.code === "dates" || blocker.code === "location" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          data-testid={`fix-${blocker.code}`}
                          onClick={() => {
                            setSettingsOpen(true);
                          }}
                        >
                          {blocker.code === "dates" ? "Add dates" : "Add location"}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="ov-public-actions">
                {previewable ? (
                  <Link
                    className={buttonClassName({
                      variant: publicIsPrimary && isPublic ? "primary" : "secondary",
                    })}
                    href={`/c/${slug}`}
                    data-testid="open-public-page"
                  >
                    {isPublic ? "View public page" : "Preview the public page"}
                    <IconArrowRight size={16} />
                  </Link>
                ) : null}
                {view.viewer.canManage ? (
                  <Button
                    ref={publishRef}
                    variant={!isPublic && publicIsPrimary ? "primary" : "secondary"}
                    loading={busy}
                    disabled={!canPublish && !isPublic}
                    data-testid="toggle-visibility"
                    onClick={() => {
                      if (isPublic) {
                        void setVisibility("private");
                      } else {
                        setPublishOpen(true);
                      }
                    }}
                  >
                    {isPublic ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                    {isPublic ? "Unpublish" : "Publish"}
                  </Button>
                ) : null}
              </div>
            </div>
          </SectionCard>

          {/* One grid for the season's public face, so a reader who cannot
              manage the season sees the public page and the pass side by side
              rather than two half-empty rows. */}
          {view.viewer.canManage ? (
            <SeasonImageCard
              slug={slug}
              competitionId={view.competition.id}
              competitionName={view.competition.name}
              slot="cover"
              currentUrl={view.coverUrl}
            />
          ) : null}
          {pass}
        </CardGrid>
      </div>

      <Dialog
        open={publishOpen}
        onClose={() => {
          setPublishOpen(false);
        }}
        title="Publish this season?"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setPublishOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              loading={busy}
              data-testid="confirm-publish"
              onClick={() => void setVisibility("public")}
            >
              Publish
            </Button>
          </>
        }
      >
        <div className="season-confirm">
          <p>Anyone on the internet will be able to see, at /c/{slug}:</p>
          <ul>
            <li>{view.competition.name}</li>
            <li>{view.competition.location ?? "No location set"}</li>
            <li>{seasonDates(view)}</li>
            <li>
              {view.teamCount} {view.teamCount === 1 ? "team" : "teams"} and {view.approvedPlayers}{" "}
              approved {view.approvedPlayers === 1 ? "player" : "players"}
            </li>
          </ul>
          {previewable ? (
            <p>
              <Link className="season-inline-link" href={`/c/${slug}`} target="_blank">
                Preview it first
                <IconArrowRight size={16} className="icon-trail" />
              </Link>
            </p>
          ) : null}
          <p className="competitions-hint">You can unpublish at any time.</p>
        </div>
      </Dialog>

      {view.viewer.canManage ? (
        <SeasonSettingsDialog
          open={settingsOpen}
          slug={slug}
          competition={view.competition}
          // 0091: the unit is fixed once an auction exists (its purse was
          // typed in it). The server refuses too; this only says so first.
          unitLocked={view.auctionStatus !== null}
          onClose={() => {
            setSettingsOpen(false);
          }}
          onSaved={() => {
            setSettingsOpen(false);
            setBlocked(false);
            toast({ title: "Season details saved", tone: "success" });
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * What is true about this season's money, for THIS reader.
 *
 * Two rules, in order. Nothing is claimed about the books that the settlement
 * case does not itself say — `settled`/`closed` are statuses, not the result of
 * `outstanding === 0`. And nothing is said about the books at all to someone
 * who may not open them: a viewer without money sight is told the auction is
 * done, which is true, and nothing further.
 */
function retroLine(view: SeasonOverviewView): string {
  const settlement = view.settlement;
  if (!view.viewer.canSeeMoney) {
    return "This season is over: the auction is done.";
  }
  if (view.competition.auctionUnit === "points") {
    return "This season is over: the auction is done. It was played for points, so there is nothing to settle.";
  }
  if (settlement === null) {
    return "This season is over: the auction is done. No settlement case has been opened for it yet.";
  }
  switch (settlement.status) {
    case "closed":
      return "This season is over: the auction is done, the books are settled and the case is closed.";
    case "settled":
      return "This season is over: the auction is done and the books are settled. The case has not been closed yet.";
    case "discrepant":
      return "This season is over, but its books are frozen: the auction log no longer matches what the settlement case pinned.";
    case "settling":
      return settlement.outstanding !== undefined && settlement.outstanding > 0
        ? "This season is over: the auction is done, but the books are still being settled and money is still owed."
        : "This season is over: the auction is done and everything owed has come in, but the books have not been settled yet.";
    default:
      return "This season is over: the auction is done, and its settlement case is still being worked through.";
  }
}

/**
 * A season that is over (DA-14). A half-finished checklist is the wrong shape
 * for something with no next step: what an organizer wants from a finished
 * season is what happened, and the offer to run it again.
 */
function Retrospective({
  view,
  slug,
  runAgain,
}: {
  view: SeasonOverviewView;
  slug: string;
  runAgain: ReactNode;
}) {
  const settlement = view.settlement;
  return (
    <SectionCard
      title="Season complete"
      icon={<IconTrophy />}
      tone="green"
      className="ov-retro"
      description={
        // The state is the hero's pill; this line says what it means — read
        // from the case, and silent about books this viewer may not open.
        <span data-testid="season-completed">{retroLine(view)}</span>
      }
    >
      <div className="ov-retro-body">
        {settlement?.collected !== undefined || settlement?.outstanding !== undefined ? (
          <dl className="ov-retro-figures">
            {settlement.collected !== undefined ? (
              <div>
                <dt>Collected</dt>
                {/* rupees-always: the settlement books, which a points season never opens */}
                <dd data-testid="retro-collected">{exactINR(settlement.collected)}</dd>
              </div>
            ) : null}
            {settlement.outstanding !== undefined ? (
              <div>
                <dt>Outstanding</dt>
                {/* rupees-always: the settlement books, which a points season never opens */}
                <dd data-testid="retro-outstanding">{exactINR(settlement.outstanding)}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <div className="ov-retro-actions">
          {/* The record of the night, not the readiness gates: a finished
              season's gates describe an auction that already happened. */}
          <Link
            href={`/seasons/${slug}/auction/replay`}
            className={buttonClassName({ variant: "secondary" })}
            data-testid="open-replay"
          >
            Replay the auction
          </Link>
          {runAgain}
        </div>
      </div>
    </SectionCard>
  );
}

/**
 * DA-11: the season settings form. Name, dates and location were write-once —
 * three fields the lifecycle guard demands and no screen could reach.
 */
function SeasonSettingsDialog({
  open,
  slug,
  competition,
  unitLocked,
  onClose,
  onSaved,
}: {
  open: boolean;
  slug: string;
  competition: SeasonOverviewView["competition"];
  unitLocked: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(competition.name);
  const [location, setLocation] = useState(competition.location ?? "");
  const [startsOn, setStartsOn] = useState(competition.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(competition.endsOn ?? "");
  const [entryCategory, setEntryCategory] = useState<string>(competition.entryCategory);
  const [auctionUnit, setAuctionUnit] = useState<string>(competition.auctionUnit);
  const [error, setError] = useState<{ field: DetailsField; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  const errorFor = (field: DetailsField): { error: string } | Record<string, never> =>
    error !== null && error.field === field ? { error: error.message } : {};

  const save = async () => {
    setPending(true);
    const result = await updateCompetitionDetailsAction(slug, {
      name,
      location,
      startsOn,
      endsOn,
      entryCategory,
      ...(unitLocked ? {} : { auctionUnit }),
    });
    setPending(false);
    if (result.ok) {
      setError(null);
      onSaved();
    } else {
      setError({ field: result.field ?? "form", message: result.error ?? "Could not save." });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Season details"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} data-testid="save-season-details" onClick={() => void save()}>
            Save details
          </Button>
        </>
      }
    >
      <div className="season-settings-form">
        {error !== null && error.field === "form" ? (
          <p className="season-guard" role="alert">
            {error.message}
          </p>
        ) : null}
        <Field
          label="Season name"
          name="season-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          {...errorFor("name")}
        />
        <Field
          label="Location"
          name="season-location"
          placeholder="e.g. Malad, Mumbai"
          value={location}
          onChange={(event) => {
            setLocation(event.target.value);
          }}
          {...errorFor("location")}
        />
        <div className="date-row">
          <Field
            label="Starts on"
            name="season-starts-on"
            type="date"
            value={startsOn}
            onChange={(event) => {
              setStartsOn(event.target.value);
            }}
            {...errorFor("startsOn")}
          />
          <Field
            label="Ends on"
            name="season-ends-on"
            type="date"
            value={endsOn}
            onChange={(event) => {
              setEndsOn(event.target.value);
            }}
            {...errorFor("endsOn")}
          />
        </div>
        {/* PI-1: who the season is for. Read by the register gate and the
            public terminology; enforcement lives in core's eligibility engine. */}
        <Select
          label="Entry category"
          name="season-entry-category"
          value={entryCategory}
          onChange={(event) => {
            setEntryCategory(event.target.value);
          }}
          help="Open takes everyone. A gendered category is checked at self-registration; you can still add anyone directly."
          data-testid="season-entry-category"
        >
          {ENTRY_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {entryCategoryLabel(category)}
            </option>
          ))}
        </Select>
        {/* 0091: rupees or points. Decides how every purse and price reads,
            and whether the season has books to settle at all. */}
        <Select
          label="Auction currency"
          name="season-auction-unit"
          value={auctionUnit}
          disabled={unitLocked}
          onChange={(event) => {
            setAuctionUnit(event.target.value);
          }}
          help={
            unitLocked
              ? "Fixed — the auction was created in this currency."
              : "Points: purses and bids are points and nothing is owed or settled."
          }
          data-testid="season-auction-unit"
          {...errorFor("auctionUnit")}
        >
          {/* rupees-always: names the rupee unit itself */}
          <option value="inr">Rupees (₹) — real money</option>
          <option value="points">Points — no money changes hands</option>
        </Select>
      </div>
    </Dialog>
  );
}
