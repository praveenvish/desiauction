"use client";

import {
  Button,
  buttonClassName,
  CardGrid,
  Dialog,
  EmptyState,
  Field,
  HeroBanner,
  IconArrowRight,
  IconBall,
  IconBat,
  IconCalendar,
  IconCheckCircle,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconGlobe,
  IconInfo,
  IconLock,
  IconPin,
  IconRefresh,
  IconShieldCheck,
  IconStarOutline,
  IconTile,
  IconTrophy,
  IconUser,
  IconUsers,
  type JourneyStep,
  JourneyStepper,
  type KitTone,
  Notice,
  Pill,
  PlayerImage,
  SectionCard,
  Select,
  useNoPhotoStyle,
  useToast,
  VisuallyHidden,
  type NoPhotoStyle,
} from "@desiauction/ui";
import { ENTRY_CATEGORIES, entryCategoryLabel, roleOptions } from "@desiauction/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { roleLabeller } from "../../../lib/role-label";
import { useMoney } from "../../../components/money-unit";
import { exactINR } from "../../../lib/inr";

import {
  advanceCompetitionAction,
  cloneCompetitionAction,
  setCompetitionVisibilityAction,
  setNoPhotoStyleAction,
  setSquadListingAction,
  updateCompetitionDetailsAction,
  type DetailsField,
  type SeasonOverviewView,
} from "../../../server/competition/actions";
import { formatDate } from "../../../lib/format-date";
import { track } from "../../../lib/telemetry";
import { TeamCrest } from "./_tabs/team-crest";
import { SeasonImageCard } from "./season-image-card";
import { ShareRegistration } from "./registrations/share-registration";
import { release } from "../../../lib/release";

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
interface Onward {
  href: string;
  label: string;
  title: string;
  body?: string;
  /** Quieter doors beside the one gold action — never a second primary. */
  also?: { href: string; label: string; testId: string }[];
}

function nextDestination(
  slug: string,
  auctionStatus: string | null,
  canSettle: boolean,
  points: boolean,
  fixtureCount: number,
  /** Matches whose day passed with no result (census 9). */
  dueMatches = 0,
): Onward | { locked: true } {
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
    // A points season (0091) has no books, but the hammer is NOT the end of it:
    // the squads still have matches to play. This used to say "See the squads"
    // under a "Season complete" card while the step bar said Fixtures was next
    // and not one match existed — the page contradicting itself one line apart.
    // So the onward step is the schedule, with the two things an organizer does
    // for the players in between (squad sheets, posters) as quiet doors.
    const also = [
      { href: `/seasons/${slug}/teams`, label: "Send squad sheets", testId: "next-squad-sheets" },
      { href: `/seasons/${slug}/posters`, label: "Make posters", testId: "next-posters" },
    ];
    // A result owed from an earlier day is the season's first job: home and
    // the tournaments page said "3 matches need a result" while this page led
    // with "Open the schedule" (census 9).
    if (dueMatches > 0) {
      return {
        href: `/seasons/${slug}/fixtures`,
        label: "Enter results",
        title: `${String(dueMatches)} ${dueMatches === 1 ? "match needs" : "matches need"} a result.`,
        body:
          dueMatches === 1
            ? "Its day has passed and nobody has entered the score yet."
            : "Their days have passed and nobody has entered the scores yet.",
        also,
      };
    }
    return fixtureCount === 0
      ? {
          href: `/seasons/${slug}/fixtures`,
          label: "Schedule matches",
          title: "Squads are set. Tell your players, then schedule the matches.",
          body: "It was played for points, so there is nothing to settle.",
          also,
        }
      : {
          href: `/seasons/${slug}/fixtures`,
          label: "Open the schedule",
          title: "Matches are on the schedule. The season wraps up when the last one is played.",
          body: "It was played for points, so there is nothing to settle.",
          also,
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

const STEP_LABELS = ["Setup", "Teams", "Registration", "Auction", "Matches", "Settlement"];

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
    // MATCHES is done when they have been played, not when a schedule exists:
    // "Fixtures ✓" on a season three matches into seven read as over (census
    // 2026-09-28). The rung fills as they are played (see the journey label).
    view.fixtureCount > 0 && view.fixturesOpen === 0,
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
  // "Schedule" — the tab's own name for this surface (nav.ts seasonTabs).
  return { href: `/seasons/${slug}/fixtures`, label: "Schedule" };
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
// One calm tone for every role: the marks tell the roles apart, and four
// tints (red, gold, purple, blue) said nothing but "template".
const ROLE_MARK: Record<string, { icon: ReactNode; tone: KitTone }> = {
  batter: { icon: <IconBat />, tone: "gold" },
  bowler: { icon: <IconBall />, tone: "gold" },
  // The outline star: the solid one was the only filled mark among four
  // outline glyphs (review r2, r3).
  all_rounder: { icon: <IconStarOutline />, tone: "gold" },
  wicket_keeper: { icon: <IconShieldCheck />, tone: "gold" },
};
const OTHER_ROLE_MARK = { icon: <IconUser />, tone: "gold" as KitTone };

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** A share as words: a real but tiny spend reads "<1%", never a false "0%". */
function shareLabel(part: number, pct: number): string {
  return part > 0 && pct === 0 ? "<1%" : `${String(pct)}%`;
}

/** The next step's band inside the hero: what, why, and the buttons. */
function NextBand({
  testId,
  title,
  body,
  link,
  actions,
}: {
  testId: string;
  title: ReactNode;
  body?: ReactNode;
  link?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="ov-next" data-testid={testId}>
      <div className="ov-next-text">
        <p className="ov-next-title">{title}</p>
        {body !== undefined && body !== null ? <p className="ov-next-body">{body}</p> : null}
        {link ?? null}
      </div>
      {actions !== undefined && actions !== null ? (
        <div className="ov-next-actions">{actions}</div>
      ) : null}
    </div>
  );
}

/** One figure in the strip under the hero. */
function Figure({
  value,
  label,
  hint,
  href,
  tone,
  testId,
}: {
  value: ReactNode;
  label: string;
  hint?: string;
  href?: string | undefined;
  tone?: "warm";
  testId: string;
}) {
  const body = (
    <>
      <span className="ov-figure-value">{value}</span>
      <span className="ov-figure-label">{label}</span>
      {hint !== undefined ? <span className="ov-figure-hint">{hint}</span> : null}
    </>
  );
  return (
    <li className="ov-figure" data-tone={tone} data-testid={testId}>
      {href !== undefined ? (
        <Link href={href} className="ov-figure-link">
          {body}
        </Link>
      ) : (
        <span className="ov-figure-body">{body}</span>
      )}
    </li>
  );
}

export function OverviewPanel({
  view,
  slug,
  pass,
  now,
  finale,
  mineTeamIds = [],
  yours,
  liveMatches = 0,
  dueMatches = 0,
}: {
  view: SeasonOverviewView;
  /** The owner's own team this season, drawn by the page (owners only). */
  yours?: ReactNode;
  /** Matches being played right now (today's — never one left open from an earlier day). */
  liveMatches?: number;
  /** Matches whose day passed with no result. */
  dueMatches?: number;
  slug: string;
  /** Name the champion, once every match is done (champion-card.tsx), drawn by the page. */
  finale?: ReactNode;
  /** What is happening now (the matches and the table), drawn by the page. */
  now?: ReactNode;
  /** Teams the viewer owns in this season — marked "Your team" in the list. */
  mineTeamIds?: readonly string[];
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
  const onward = nextDestination(
    slug,
    view.auctionStatus,
    view.viewer.canSettle,
    points,
    view.fixtureCount,
    dueMatches,
  );
  const locked = "locked" in onward;
  const cleared = clearedRungs(view);
  const activeIndex = cleared.indexOf(false);
  const auctionDone = cleared[3] === true;
  // The enum has no `completed` value (that is a migration), but the fact is
  // derivable: the auction is over and the books are discharged.
  //
  // A points season has no books, so its last rung is the matches: it is over
  // when there were fixtures and every one of them has been played (or called
  // off). It used to be "finished at the hammer", which put "Season complete"
  // and a gold "Run it again" on a season whose squads had not played a ball.
  const fixturesDone = view.fixtureCount > 0 && view.fixturesOpen === 0;
  const finished =
    auctionDone && (points ? fixturesDone : view.settlement !== null && view.settlement.discharged);
  const missing = missingForRegistration(view.competition);
  const secondary = secondaryAction(view, slug, finished);
  const canPublish = view.publishBlockers.length === 0;
  const isPublic = view.competition.visibility === "public";
  const previewable = isPublic || status === "registration_open";

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
    const result = await release(
      advanceCompetitionAction(slug, step.to as SeasonOverviewView["competition"]["status"]),
      () => {
        setBusy(false);
      },
    );
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
    const result = await release(cloneCompetitionAction(slug), () => {
      setBusy(false);
    });
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
    const result = await release(setCompetitionVisibilityAction(slug, visibility), () => {
      setBusy(false);
    });
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

  // SEO-1 Phase 5: the organizer's "list squads in search" switch.
  const [squadBusy, setSquadBusy] = useState(false);
  const setSquadListing = async (listed: boolean) => {
    setSquadBusy(true);
    const result = await release(setSquadListingAction(slug, listed), () => {
      setSquadBusy(false);
    });
    if (result.ok) {
      toast({
        title: listed ? "Squads can be listed in search" : "Squads taken out of search",
        tone: "success",
      });
      router.refresh();
    } else {
      toast({ title: result.error ?? "Could not update.", tone: "danger" });
    }
  };

  // 0107: how a player with no photo is drawn — the season's own choice,
  // read from the layout's provider so the row and every face agree.
  const noPhotoStyle = useNoPhotoStyle();
  const [noPhotoBusy, setNoPhotoBusy] = useState<NoPhotoStyle | null>(null);
  const chooseNoPhotoStyle = async (style: NoPhotoStyle) => {
    if (style === noPhotoStyle) {
      return;
    }
    setNoPhotoBusy(style);
    const result = await release(setNoPhotoStyleAction(slug, style), () => {
      setNoPhotoBusy(null);
    });
    if (result.ok) {
      toast({
        title:
          style === "silhouette"
            ? "Players without a photo now show the player silhouette"
            : "Players without a photo now show their initials",
        tone: "success",
      });
      router.refresh();
    } else {
      toast({ title: result.error ?? "Could not update.", tone: "danger" });
    }
  };

  // SEO-1 Phase 7: the embed snippet — the card in an iframe, and a plain link
  // after it. The link is the backlink; a link inside the frame is ours.
  const copyEmbedCode = async () => {
    const origin = window.location.origin;
    const name = view.competition.name
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    const code = [
      `<iframe src="${origin}/embed/${slug}" title="${name} on DesiAuction" width="100%" height="210" style="border:0;max-width:480px" loading="lazy"></iframe>`,
      `<p><a href="${origin}/c/${slug}">${name} — player auction on DesiAuction</a></p>`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(code);
      toast({ title: "Embed code copied — paste it into your website", tone: "success" });
    } catch {
      toast({ title: "Couldn't copy the embed code.", tone: "danger" });
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

  // Past the hammer the competition status is still `registration_closed` —
  // the enum stops there (DA-10) — so the pill reads the auction instead of
  // announcing a registration step that is two steps behind the season.
  const statusPill = finished
    ? { tone: "green" as KitTone, icon: <IconTrophy /> }
    : auctionDone
      ? { tone: "green" as KitTone, icon: <IconCheckCircle /> }
      : (STATUS_PILL[status] ?? { tone: "neutral" as KitTone, icon: <IconCalendar /> });
  // Once a match has been played (or is being played) the season is ON — the
  // pill said "auction done" three matches in (census 2026-09-28).
  const matchesPlayed = view.fixtureCount - view.fixturesOpen;
  const seasonOn = auctionDone && view.fixtureCount > 0 && (matchesPlayed > 0 || liveMatches > 0);
  const statusText = finished
    ? "completed"
    : seasonOn
      ? "season on"
      : auctionDone
        ? "auction done"
        : status.replace(/_/g, " ");
  // A team owner after the auction: the pool figures and the pool-by-role card
  // were the organizer's working view, stale for the owner; their own team
  // stands in their place.
  const ownerView = mineTeamIds.length > 0 && !view.viewer.canManage && auctionDone;

  const journey: JourneyStep[] = steps.map((label, index) => {
    const state = cleared[index] === true ? "done" : index === activeIndex ? "current" : "upcoming";
    const href = stepHref(index, slug, view);
    const counted =
      index === 4 && state === "current" && view.fixtureCount > 0
        ? `${label} · ${String(matchesPlayed)} of ${String(view.fixtureCount)}`
        : label;
    return {
      key: label,
      // The mark is decorative, so the state is said in words as well.
      label: (
        <>
          {counted}
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
        className="ov-next-link"
        data-testid="open-readiness"
      >
        Check readiness
        <IconArrowRight size={14} aria-hidden />
      </Link>
    ) : null;
  const glass = buttonClassName({ variant: "secondary" }, "ov-hero-btn");

  let nextNotice: ReactNode = null;
  if (view.viewer.canManage && !finished) {
    if (step !== null) {
      const copy = NEXT_COPY[status];
      // While registration is open with people waiting, reviewing them IS the
      // next step; closing registration is the gate after it, so it steps back.
      const reviewFirst = status === "registration_open" && view.pendingPlayers > 0;
      nextNotice = (
        <NextBand
          testId="next-step"
          title={
            reviewFirst
              ? `${String(view.pendingPlayers)} ${view.pendingPlayers === 1 ? "player is" : "players are"} waiting for your review`
              : (copy?.title ?? "")
          }
          body={copy?.body}
          link={readinessLink}
          actions={
            <>
              <Button
                ref={advanceRef}
                onClick={() => void advance()}
                loading={busy}
                data-testid="advance-status"
                variant={reviewFirst ? "secondary" : "primary"}
                {...(reviewFirst ? { className: "ov-hero-btn", "data-tone": "glass" } : {})}
              >
                {step.label}
                {reviewFirst ? null : <IconArrowRight size={16} />}
              </Button>
              {reviewFirst ? (
                <Link
                  href={`/seasons/${slug}/registrations`}
                  className={buttonClassName({ variant: "primary" })}
                  data-testid="next-review"
                >
                  Review {view.pendingPlayers}{" "}
                  {view.pendingPlayers === 1 ? "registration" : "registrations"}
                  <IconArrowRight size={16} />
                </Link>
              ) : null}
            </>
          }
        />
      );
    } else if (status === "registration_closed" && !locked) {
      nextNotice = (
        <NextBand
          testId="next-step"
          title={onward.title}
          body={onward.body}
          link={readinessLink}
          actions={
            <>
              {/* "Run it again" belongs to a season that is actually over (the
                  Retrospective); offering it mid-season beside the real next
                  step made starting afresh look like the thing to do. */}
              {(onward.also ?? []).map((door) => (
                <Link
                  key={door.href}
                  href={door.href}
                  className={glass}
                  data-tone="glass"
                  data-testid={door.testId}
                >
                  {door.label}
                </Link>
              ))}
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
        />
      );
    } else if (status === "registration_closed" && locked) {
      nextNotice = (
        <NextBand
          testId="settlement-locked"
          title={`The auction is done. Settling it needs money authority for ${
            view.orgName === "" ? "this club" : view.orgName
          } — a separate grant from running the season.`}
          body="Ask an owner of the club to give you one under Money & roles."
          actions={runAgainButton(false)}
        />
      );
    }
  }

  // Someone who cannot run the season gets no next-step banner. A blue
  // "Auction done — fixtures are next." used to sit here, under a hero that
  // already says AUCTION DONE in its pill and "Fixtures · Step 5 of 5" on its
  // rail: one state, said three times.

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
                {statusText}
              </Pill>
              {view.auctionLive ? (
                <Pill tone="red" dot>
                  Auction live
                </Pill>
              ) : null}
              {liveMatches > 0 ? (
                <Pill tone="red" dot testId="matches-live">
                  Match day · {liveMatches} live
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
              {/* The band below the road carries the next step; this door is for
                  whoever gets no band (a team owner, a finished season), so the
                  page never offers the same move twice. */}
              {nextNotice === null || finished ? (
                <Link
                  href={secondary.href}
                  className={buttonClassName({ variant: "secondary" }, "ov-hero-btn")}
                  data-tone="glass"
                  data-testid="season-secondary"
                >
                  {secondary.label}
                </Link>
              ) : null}
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
          // The season's road rides the hero's bottom edge (it was a strip of
          // its own under the hero, repeating the hero's status pill).
          footer={
            <div ref={journeyRef}>
              <VisuallyHidden>
                <p data-testid="lifecycle-summary">
                  {activeIndex === -1
                    ? `All ${steps.length === 5 ? "five" : "six"} steps complete`
                    : `Step ${String(activeIndex + 1)} of ${String(steps.length)} · ${
                        steps[activeIndex] ?? ""
                      }`}
                </p>
              </VisuallyHidden>
              <JourneyStepper variant="rail" steps={journey} linkComponent={Link} />
              {/* THE ONE NEXT STEP, inside the hero (2026-09-27). It was a gold
                  banner under the hero repeating the hero's own button, above a
                  stat tile saying it a third time. */}
              {finished ? null : nextNotice}
            </div>
          }
        />
      </div>

      <div className="ov-journey" data-testid="lifecycle-panel">
        {finale}
        {finished ? (
          <Retrospective view={view} slug={slug} runAgain={runAgainButton(true)} />
        ) : null}
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

      {ownerView ? yours : null}

      {ownerView ? null : (
        <>
          {/* The figures, one strip (they were four tiles the height of a card).
          Before an auction there is no purse and no lot, so those two wait. */}
          <ul className="ov-figures" data-testid="season-figures">
            <Figure
              value={view.approvedPlayers}
              label={view.approvedPlayers === 1 ? "approved player" : "approved players"}
              {...(approvedHint !== undefined ? { hint: approvedHint } : {})}
              href={view.viewer.canReview ? `/seasons/${slug}/registrations` : undefined}
              testId="overview-approved"
            />
            {view.auctionStatus === null && view.pendingPlayers > 0 ? (
              <Figure
                value={view.pendingPlayers}
                label="waiting for your review"
                tone="warm"
                href={`/seasons/${slug}/registrations`}
                testId="pending-tile"
              />
            ) : null}
            <Figure
              value={view.teamCount}
              label={view.teamCount === 1 ? "team" : "teams"}
              href={`/seasons/${slug}/teams`}
              testId="overview-teams"
            />
            {view.auctionStatus !== null && view.purseCommitted !== undefined ? (
              <Figure
                value={
                  points ? money.exact(view.purseCommitted) : money.compact(view.purseCommitted)
                }
                label="purse committed"
                {...(view.pursePct !== undefined && view.pursePct !== null
                  ? { hint: `${shareLabel(view.purseCommitted, view.pursePct)} of the total purse` }
                  : {})}
                testId="overview-purse"
              />
            ) : null}
            {view.auctionStatus !== null ? (
              <Figure
                value={`${String(view.lotsSold)}/${String(view.lotsTotal)}`}
                label="lots sold"
                hint={`${String(lotsPct)}% of the pool`}
                testId="overview-lots"
              />
            ) : null}
          </ul>
        </>
      )}

      {now}

      {ownerView ? null : (
        <div className="ov-grid">
          <CardGrid>
            <SectionCard
              title="Teams"
              data-testid="team-spend-card"
              action={
                <Link className="ov-card-link" href={`/seasons/${slug}/teams`}>
                  All teams
                  <IconArrowRight size={16} />
                </Link>
              }
            >
              {view.topTeams.length === 0 ? (
                <EmptyState
                  size="compact"
                  icon={<IconUsers />}
                  title="No teams yet"
                  description="The auction issues one paddle per team, so this is the first thing to build."
                  {...(view.viewer.canManage
                    ? {
                        action: (
                          <Link
                            href={`/seasons/${slug}/teams`}
                            className={buttonClassName({ variant: "secondary", size: "sm" })}
                            data-testid="empty-add-teams"
                          >
                            Add teams
                          </Link>
                        ),
                      }
                    : {})}
                />
              ) : (
                <ul className="ov-rows">
                  {view.topTeams.slice(0, 5).map((team) => {
                    const spent = team.spend !== undefined && view.lotsSold > 0;
                    return (
                      <li key={team.teamId} className="ov-team">
                        {/* The same crest every other tab draws — its logo, or two
                          initials — rather than a one-letter tile of its own. */}
                        <span className="ov-team-tile" aria-hidden>
                          <TeamCrest
                            name={team.name}
                            short={team.shortName}
                            color={team.color}
                            logoUrl={team.logoUrl}
                          />
                        </span>
                        <span className="ov-team-name">
                          {team.name}
                          {mineTeamIds.includes(team.teamId) ? (
                            <span className="ov-team-yours">Your team</span>
                          ) : null}
                        </span>
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
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>

            <SectionCard
              // Every approved player, pre-signed ones included — so not the
              // auction "pool" (the registrations desk's 37 of 43), which the
              // two cards disagreed about (census 8).
              title="Players by role"
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
                <EmptyState
                  size="compact"
                  icon={<IconUsers />}
                  title="No approved players yet"
                  description={
                    status === "registration_open"
                      ? "Share the registration link — every entry lands in the Registrations tab for you to approve."
                      : "Players enter through the registration link once you open registration."
                  }
                  {...(view.viewer.canReview &&
                  (status === "registration_open" || view.pendingPlayers > 0)
                    ? {
                        action: (
                          <>
                            {status === "registration_open" ? (
                              <ShareRegistration
                                slug={slug}
                                open
                                seasonName={view.competition.name}
                              />
                            ) : null}
                            {view.pendingPlayers > 0 ? (
                              <Link
                                href={`/seasons/${slug}/registrations`}
                                className={buttonClassName({ variant: "secondary", size: "sm" })}
                                data-testid="empty-review-registrations"
                              >
                                Review {view.pendingPlayers} waiting
                              </Link>
                            ) : null}
                          </>
                        ),
                      }
                    : {})}
                />
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
      )}

      {/* A reader who cannot run the season (a team owner, a member) is not
          told about publishing, copy-links and listing state — that is the
          organizer's control panel. They get the one useful thing in it: the
          door to the public page, when there is one. */}
      {!view.viewer.canManage && isPublic && view.platformHold === null ? (
        <p className="ov-public-strip" data-testid="visibility-row">
          <IconGlobe size={20} aria-hidden />
          <span>
            <strong>The season&apos;s public page is live.</strong> Anyone with the link can follow
            the squads and results.
          </span>
          <Link href={`/c/${slug}`} data-testid="open-public-page">
            View public page
            <IconArrowRight size={16} />
          </Link>
        </p>
      ) : null}

      {/* HOW THE SEASON LOOKS (2026-09-27): the logo, the cover and the public
          page were three half-page cards of explanation and the pass a fourth —
          the whole bottom half of the overview was setup chores. Now each is one
          row that says whether it is done, with the one act beside it. */}
      {view.viewer.canManage ? (
        <SectionCard title="How the season looks" className="ov-looks-card" flush>
          <ul className="ov-looks">
            <SeasonImageCard
              slug={slug}
              competitionId={view.competition.id}
              competitionName={view.competition.name}
              slot="logo"
              currentUrl={view.logoUrl}
            />
            <SeasonImageCard
              slug={slug}
              competitionId={view.competition.id}
              competitionName={view.competition.name}
              slot="cover"
              currentUrl={view.coverUrl}
            />
            <li
              className="ov-look"
              data-set={isPublic ? "" : undefined}
              data-testid="visibility-row"
            >
              <span className="ov-look-thumb" aria-hidden>
                <IconGlobe size={18} />
              </span>
              <span className="ov-look-text">
                <strong>
                  Public page{" "}
                  {view.platformHold !== null ? (
                    <Pill tone="red" testId="platform-hold-badge">
                      Taken down
                    </Pill>
                  ) : (
                    <Pill tone={isPublic ? "green" : "neutral"} dot={isPublic}>
                      {isPublic ? "Live" : "Not listed"}
                    </Pill>
                  )}
                </strong>
                <span>
                  {view.platformHold !== null ? (
                    "DesiAuction has taken this season’s public page down. Your season, registrations and auction are untouched — only the public page is gone."
                  ) : (
                    <>
                      <span className="ov-url-text">/c/{slug}</span>
                      {isPublic
                        ? " · listed publicly — anyone can see it and share it."
                        : " · publishing puts it on the directory for players and spectators."}
                    </>
                  )}
                </span>
                {!canPublish && !isPublic ? (
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
              </span>
              <span className="ov-look-actions">
                {isPublic && view.platformHold === null ? (
                  <button
                    type="button"
                    className="ov-icon-btn"
                    aria-label="Copy the public page link"
                    onClick={() => void copyPublicLink()}
                  >
                    <IconCopy size={18} />
                  </button>
                ) : null}
                {previewable && view.platformHold === null ? (
                  <Link
                    className={buttonClassName({ variant: "ghost", size: "sm" })}
                    href={`/c/${slug}`}
                    data-testid="open-public-page"
                  >
                    {isPublic ? "View" : "Preview"}
                  </Link>
                ) : null}
                <Button
                  ref={publishRef}
                  size="sm"
                  variant={isPublic ? "ghost" : "secondary"}
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
              </span>
            </li>
            {isPublic && view.platformHold === null && view.squadListing !== null ? (
              <li
                className="ov-look"
                data-set={view.squadListing.decision.indexable ? "" : undefined}
                data-testid="squad-listing-row"
              >
                <span className="ov-look-thumb" aria-hidden>
                  <IconUsers size={18} />
                </span>
                <span className="ov-look-text">
                  <strong>
                    Squads in search{" "}
                    <Pill
                      tone={view.squadListing.decision.indexable ? "green" : "neutral"}
                      dot={view.squadListing.decision.indexable}
                    >
                      {view.squadListing.decision.indexable ? "Listed" : "Not listed"}
                    </Pill>
                  </strong>
                  <span data-testid="squad-listing-status">
                    {view.squadListing.decision.indexable
                      ? "Search engines can find each team’s squad page, with its players’ names."
                      : view.squadListing.decision.reason === "off"
                        ? "Squad pages are shared by link only. Turn this on to let search engines list them."
                        : view.squadListing.decision.reason === "no_players"
                          ? "On. Squads are listed once players are approved and every one of them is a known adult."
                          : `On, but not listed: ${String(view.squadListing.decision.blocking)} approved ${view.squadListing.decision.blocking === 1 ? "player has" : "players have"} no date of birth or ${view.squadListing.decision.blocking === 1 ? "is" : "are"} under 18. Squads are listed only when every player is a known adult.`}
                  </span>
                </span>
                <span className="ov-look-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={squadBusy}
                    data-testid="toggle-squad-listing"
                    onClick={() => void setSquadListing(!view.squadListing?.optedIn)}
                  >
                    {view.squadListing.optedIn ? "Turn off" : "Turn on"}
                  </Button>
                </span>
              </li>
            ) : null}
            <li className="ov-look" data-testid="no-photo-row">
              <span className="ov-look-thumb" aria-hidden>
                <PlayerImage name="Player" seed="no-photo-preview" size="sm" decorative />
              </span>
              <span className="ov-look-text">
                <strong>Players without a photo</strong>
                <span>
                  {noPhotoStyle === "silhouette"
                    ? "Show a player silhouette — on every page, poster and share card."
                    : "Show their initials — on every page, poster and share card."}
                </span>
              </span>
              <span className="ov-look-actions" role="group" aria-label="Players without a photo">
                <Button
                  size="sm"
                  variant={noPhotoStyle === "initials" ? "secondary" : "ghost"}
                  aria-pressed={noPhotoStyle === "initials"}
                  loading={noPhotoBusy === "initials"}
                  disabled={noPhotoBusy !== null}
                  data-testid="no-photo-initials"
                  onClick={() => void chooseNoPhotoStyle("initials")}
                >
                  Initials
                </Button>
                <Button
                  size="sm"
                  variant={noPhotoStyle === "silhouette" ? "secondary" : "ghost"}
                  aria-pressed={noPhotoStyle === "silhouette"}
                  loading={noPhotoBusy === "silhouette"}
                  disabled={noPhotoBusy !== null}
                  data-testid="no-photo-silhouette"
                  onClick={() => void chooseNoPhotoStyle("silhouette")}
                >
                  Silhouette
                </Button>
              </span>
            </li>
            {isPublic && view.platformHold === null ? (
              <li className="ov-look" data-testid="embed-row">
                <span className="ov-look-thumb" aria-hidden>
                  <IconGlobe size={18} />
                </span>
                <span className="ov-look-text">
                  <strong>Embed on your website</strong>
                  <span>
                    A small card of this season for your club&apos;s own site, with a link back to
                    the public page.
                  </span>
                </span>
                <span className="ov-look-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="copy-embed-code"
                    onClick={() => void copyEmbedCode()}
                  >
                    <IconCopy size={16} />
                    Copy embed code
                  </Button>
                </span>
              </li>
            ) : null}
          </ul>
          {pass}
        </SectionCard>
      ) : null}

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
          // 0110: fixed while a real auction stands; an aborted one frees it.
          sourceLocked={view.auctionStatus !== null && view.auctionStatus !== "abandoned"}
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
  sourceLocked,
  onClose,
  onSaved,
}: {
  open: boolean;
  slug: string;
  competition: SeasonOverviewView["competition"];
  unitLocked: boolean;
  sourceLocked: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(competition.name);
  const [location, setLocation] = useState(competition.location ?? "");
  const [startsOn, setStartsOn] = useState(competition.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(competition.endsOn ?? "");
  const [entryCategory, setEntryCategory] = useState<string>(competition.entryCategory);
  const [auctionUnit, setAuctionUnit] = useState<string>(competition.auctionUnit);
  const [auctionSource, setAuctionSource] = useState<string>(competition.auctionSource);
  const [error, setError] = useState<{ field: DetailsField; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  const errorFor = (field: DetailsField): { error: string } | Record<string, never> =>
    error !== null && error.field === field ? { error: error.message } : {};

  const save = async () => {
    setPending(true);
    const result = await release(
      updateCompetitionDetailsAction(slug, {
        name,
        location,
        startsOn,
        endsOn,
        entryCategory,
        ...(unitLocked ? {} : { auctionUnit }),
        ...(sourceLocked ? {} : { auctionSource }),
      }),
      () => {
        setPending(false);
      },
    );
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
        {/* 0110: where the auction happens. Imported seasons type their
            results in on the Teams tab and show them publicly as they go. */}
        <Select
          label="Auction"
          name="season-auction-source"
          value={auctionSource}
          disabled={sourceLocked}
          onChange={(event) => {
            setAuctionSource(event.target.value);
          }}
          help={
            sourceLocked
              ? "Fixed — this season already has an auction."
              : "Imported: add each team's players on the Teams tab. Public squad pages show them as you go."
          }
          data-testid="season-auction-source"
          {...errorFor("auctionSource")}
        >
          <option value="app">Run live on DesiAuction</option>
          <option value="imported">Held elsewhere — import the results</option>
        </Select>
      </div>
    </Dialog>
  );
}
