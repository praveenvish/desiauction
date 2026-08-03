import { formatPaiseINR, paise } from "@desiauction/core";
import {
  Badge,
  ButtonLink,
  Card,
  LoadingState,
  Money,
  SectionHeader,
  VisuallyHidden,
} from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Fragment, Suspense, type ReactNode } from "react";

import { FormDialog } from "../../components/form-dialog";
import { PageAction } from "../../components/shell/page-action";
import { PageTitle } from "../../components/shell/page-title";
import { auctionDashboard } from "../../server/auction/actions";
import { currentSession } from "../../server/auth/actions";
import { competitionsView, registrationDashboard } from "../../server/competition/actions";
import { organizerScheduleView } from "../../server/competition/fixture-actions";
import { myRegistrations } from "../../server/competition/public";
import { homeDashboard } from "../../server/home/dashboard";
import type { HomeDashboardData, HomeStages } from "../../server/home/dashboard";
import { CreateOrgForm } from "../orgs/create-org-form";
import { CreateTournamentForm } from "../tournaments/create-tournament-form";
import { HomeShortcuts } from "./home-shortcuts";
import "./home.css";

export const metadata = { title: "Home · DesiAuction" };

type Tone = "info" | "success" | "warning" | "danger" | "neutral";

const REG_TONE: Record<string, Tone> = {
  submitted: "info",
  approved: "success",
  waitlisted: "warning",
  rejected: "danger",
  withdrawn: "neutral",
  draft: "neutral",
};

function statusTone(status: string): Tone {
  switch (status) {
    case "setup":
      return "info";
    case "registration_open":
      return "success";
    case "registration_closed":
      return "warning";
    default:
      return "neutral";
  }
}

/** Compact label so the status column never truncates in a narrow panel. */
function statusLabel(status: string): string {
  switch (status) {
    case "registration_open":
      return "Open";
    case "registration_closed":
      return "Closed";
    case "setup":
      return "Setup";
    case "draft":
      return "Draft";
    default:
      return status.replace(/_/g, " ");
  }
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

/* ---- glyphs ------------------------------------------------------------- */
const G = {
  trophy: (
    <path
      d="M7 4h10v3a5 5 0 0 1-10 0V4ZM4 5H2v2a3 3 0 0 0 3 3M20 5h2v2a3 3 0 0 1-3 3M9 15h6v5H9z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  users: (
    <path
      d="M16 11a4 4 0 1 0-8 0M4 20a6 6 0 0 1 16 0"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  ),
  gavel: (
    <path
      d="M4 20 14 10M17 7l-3-3 4-1 3 3-1 4-3-3z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  rupee: (
    <path
      d="M7 6h9M7 10h9M13 6c3 0 4 4 0 4H9l6 8"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  chart: (
    <path
      d="m4 19 5-5 3 3 8-8M14 9h6v6"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  check: (
    <path
      d="m9 11 3 3L22 4M21 12v7H3V5h12"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  doc: (
    <path
      d="M6 3h9l5 5v13H6zM14 3v5h5M9 13h6M9 17h6"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  bolt: (
    <path
      d="M13 3 5 14h6l-1 7 8-11h-6z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  calendar: (
    <path
      d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
} as const;

function Glyph({ d }: { d: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      {d}
    </svg>
  );
}

/** An empty panel should still sell the next move, not just report nothing. */
function PanelEmpty({
  icon,
  text,
  ctaHref,
  ctaLabel,
}: {
  icon: ReactNode;
  text: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="home-blank">
      <span className="home-blank-ic" aria-hidden>
        {icon}
      </span>
      <p>{text}</p>
      {ctaHref !== undefined && ctaLabel !== undefined ? (
        <Link href={ctaHref} className="home-blank-cta">
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}

function monogram(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "—"
  );
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

/**
 * The feed is read by organizers, not operators, so the raw event name is the
 * wrong thing to print: "finops.PeriodClosed" is a fact about our ledger
 * machinery, not about their night. Known events get the sentence a human would
 * say; anything unmapped falls back to the mechanical transform below, with the
 * internal domain word translated so "Finops" never reaches a screen.
 */
const ACTIVITY_PHRASE: Record<string, string> = {
  "auction.BidAccepted": "Bid accepted",
  "auction.AuctionAborted": "Auction stopped",
  "auction.conduct": "Auction conducted",
  "competition.created": "Season created",
  "competition.cloned": "Season cloned",
  "finops.PeriodOpened": "Books opened",
  "finops.PeriodClosed": "Books closed",
  "finops.PeriodReopened": "Books reopened",
  "finops.DayAttested": "Day's books attested",
  "finops.ProfileDeclared": "Finance profile declared",
  "finops.dispatch": "Receipt delivered",
  "finops.document": "Document issued",
  // These four are what the ledger actually emits, and none of them were
  // mapped: the feed had never been read against real finance data, so they
  // fell through to the mechanical transform ("Finance certification derived"
  // came out of the fallback, not out of a decision).
  "finops.CertificationDerived": "Books certified",
  "finops.ExportRequested": "Export requested",
  "finops.ExportCompleted": "Export ready",
  "finops.SeriesOpened": "Numbering series opened",
  "finops.DocumentIssued": "Document issued",
  "finops.DispatchRequested": "Receipt queued",
  "finops.DispatchSent": "Receipt sent",
  "finops.DispatchConfirmed": "Receipt delivered",
  "competition.status_changed": "Season status changed",
  "registration.approved": "Registration approved",
  "registration.imported": "Registrations imported",
  "registration.added": "Player added",
  "registration.team_assigned": "Player assigned to a team",
  "tournament.created": "Tournament created",
  "team.coach_set": "Coach set",
  "venue.created": "Venue added",
  "ground.created": "Ground added",
  "invite.created": "Invitation sent",
  "invite.accepted": "Invitation accepted",
  "fixture.generated": "Fixtures generated",
  "fixture.schedule": "Fixtures scheduled",
  "fixture.publish": "Fixtures published",
  "auction.AuctionCreated": "Auction created",
  "auction.AuctionOpened": "Auction opened",
  "auction.AuctionClosed": "Auction closed",
  "auction.LotSold": "Lot sold",
  "auction.LotUnsold": "Lot went unsold",
  "auction.owner_join": "Team owner joined",
  "grant.issued": "Paddle granted",
  "grant.revoked": "Paddle revoked",
  "org.created": "Organization created",
  "payment.captured": "Payment received",
  "payment.failed": "Payment failed",
  "registration.submitted": "New registration",
  "registration.approve": "Registration approved",
  "registration.waitlist": "Registration waitlisted",
  "settlement.PaymentCaptured": "Payment received",
  "settlement.ObligationWaived": "Amount waived",
  "settlement.CaseClosed": "Settlement closed",
  "team.created": "Team added",
};

/** Internal domain words → what the organizer calls the same thing. */
const ACTIVITY_DOMAIN: Record<string, string> = {
  finops: "Finance",
  competition: "Season",
  grant: "Access",
  auth: "Sign-in",
  org: "Organization",
};

/** "grant.issued" -> "Paddle granted"; unmapped "x.YDone" -> "X y done". */
function activityLabel(action: string): string {
  const phrase = ACTIVITY_PHRASE[action];
  if (phrase !== undefined) return phrase;
  const parts = action.split(".");
  const domain = parts[0] ?? action;
  const tail = parts.slice(1).join(" ");
  const named = ACTIVITY_DOMAIN[domain] ?? domain.charAt(0).toUpperCase() + domain.slice(1);
  if (tail === "") return named;
  const words = tail
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]/g, " ")
    .toLowerCase();
  return `${named} ${words}`;
}

const ACTIVITY_STYLE: Record<string, { tone: string; icon: ReactNode }> = {
  auction: { tone: "gold", icon: <Glyph d={G.gavel} /> },
  registration: { tone: "green", icon: <Glyph d={G.check} /> },
  competition: { tone: "accent", icon: <Glyph d={G.trophy} /> },
  team: { tone: "info", icon: <Glyph d={G.users} /> },
  org: { tone: "info", icon: <Glyph d={G.users} /> },
  grant: { tone: "violet", icon: <Glyph d={G.users} /> },
  auth: { tone: "violet", icon: <Glyph d={G.users} /> },
  profile: { tone: "violet", icon: <Glyph d={G.users} /> },
  settlement: { tone: "info", icon: <Glyph d={G.rupee} /> },
  payment: { tone: "info", icon: <Glyph d={G.rupee} /> },
  finops: { tone: "teal", icon: <Glyph d={G.doc} /> },
};

function activityStyle(action: string): { tone: string; icon: ReactNode } {
  return (
    ACTIVITY_STYLE[action.split(".")[0] ?? ""] ?? { tone: "accent", icon: <Glyph d={G.bolt} /> }
  );
}

function ago(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  return `${String(Math.floor(hours / 24))}d`;
}

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
 * The platform in one row. Every tournament walks these four stages, so the
 * strip doubles as an explanation of what DesiAuction does and a read on where
 * this organiser's competitions actually are.
 *
 * Each stage carries the number that matters AT that stage. That is deliberate:
 * a separate grid of stat tiles sat directly under this strip and restated the
 * same facts in different units — "Auction night 0" over "Active auctions 0",
 * "Settlement 1" over "Collected", and a "Registrations" tile counting players
 * beside a "Registration" stage counting competitions. Nine cards, five facts.
 * The counts belong to the stages that own them.
 */
function lifecycleFor(dash: HomeDashboardData): {
  key: keyof HomeStages;
  name: string;
  count: number;
  detail: string;
  tone: string;
  icon: ReactNode;
  href: string;
}[] {
  const { setup, registration, auction, settlement } = dash.stages;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  return [
    {
      key: "setup",
      name: "Set up",
      count: setup.competitions,
      detail:
        setup.competitions === 0
          ? "Nothing in setup"
          : `${String(setup.teams)} ${plural(setup.teams, "team", "teams")} added`,
      tone: "info",
      icon: <Glyph d={G.trophy} />,
      href: "/tournaments?view=seasons",
    },
    {
      key: "registration",
      name: "Registration",
      count: registration.competitions,
      detail:
        registration.competitions === 0
          ? "Nobody taking entries"
          : `${registration.registered.toLocaleString("en-IN")} registered · ${registration.approved.toLocaleString("en-IN")} approved`,
      tone: "green",
      icon: <Glyph d={G.check} />,
      href: "/tournaments?view=seasons",
    },
    {
      key: "auction",
      name: "Auction night",
      count: auction.competitions,
      detail:
        auction.live > 0
          ? `${String(auction.live)} live right now`
          : auction.competitions === 0
            ? "Nothing at auction"
            : auction.bids > 0
              ? `${auction.bids.toLocaleString("en-IN")} ${plural(auction.bids, "bid", "bids")} placed`
              : "Ready to run",
      tone: "gold",
      icon: <Glyph d={G.gavel} />,
      href: "/tournaments?view=seasons",
    },
    {
      key: "settlement",
      name: "Settlement",
      count: settlement.competitions,
      /**
       * "settled" used to be derived from `outstanding === 0`. It is not the
       * same claim: a case with every rupee collected stays `settling` until
       * somebody settles it, so this rail told an organizer "₹2L collected ·
       * settled" while the Money tab correctly said COLLECTING. Settlement is a
       * case STATUS, and only the case may say it.
       *
       * The money words are also gated: without a settlement grant on the org
       * the figures fold to zero, and "₹0 collected" must not be reported as a
       * fact about books this person cannot open.
       */
      detail:
        settlement.competitions === 0
          ? "Nothing due yet"
          : settlement.visible === 0
            ? settlement.awaiting > 0
              ? "Settling"
              : "Settled"
            : settlement.outstandingPaise > 0
              ? `${rupeesShort(settlement.outstandingPaise)} still outstanding`
              : settlement.awaiting > 0
                ? `${rupeesShort(settlement.collectedPaise)} collected · not settled yet`
                : `${rupeesShort(settlement.collectedPaise)} collected · settled`,
      tone: "violet",
      icon: <Glyph d={G.rupee} />,
      // NOT /money. That surface renders "This area is being built during the
      // beta" and was pulled from the rail for it (nav.ts: "a primary
      // navigation item is a promise; this one led to an apology"). The rail
      // was cleaned and this page was not, so the stage holding real settled
      // money led to an apology. The season's own Money tab IS built —
      // `moneyHref` is it, when one season owns the total and this person may
      // open its books; otherwise the season list, which is also real.
      href: dash.moneyHref ?? "/tournaments?view=seasons",
    },
  ];
}

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
export default async function HomePage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/home");
  }
  if (session.name === null || session.name.trim() === "") {
    redirect("/onboarding");
  }
  return (
    <main className="home">
      <Suspense fallback={<LoadingState variant="page" />}>
        <HomeBody personId={session.personId} name={session.name} />
      </Suspense>
    </main>
  );
}

async function HomeBody({ personId, name }: { personId: string; name: string }) {
  const [view, schedule, registrationsMine, dash] = await Promise.all([
    competitionsView(),
    organizerScheduleView(),
    myRegistrations(personId),
    homeDashboard(),
  ]);

  // The night in progress leads the page. One extra read, and only when there
  // IS one: the hero needs what the list row could not say — who is on the
  // block, what the top bid is, and who is holding it.
  const liveRow = dash.auctions.find((auction) => auction.status === "live") ?? null;
  const liveBoard =
    liveRow === null ? null : ((await auctionDashboard(liveRow.competitionSlug))?.overview ?? null);

  // The hero owns the live auction, so the panel below lists only what the hero
  // is not already showing — the design's "no duplication" rule.
  const otherAuctions = dash.auctions.filter((auction) => auction.auctionId !== liveRow?.auctionId);

  // The scan used to be a sequential `for` loop doing up to eight composite
  // reads one after another — eight round-trip depths for work that has no
  // ordering between its items. `Promise.all` collapses it to one.
  const scanned = view.competitions.slice(0, ATTENTION_SCAN_LIMIT);
  const attention = (
    await Promise.all(scanned.map((competition) => attentionFor(competition, dash)))
  ).filter((row): row is AttentionRow => row !== null);
  const unscanned = view.competitions.length - scanned.length;

  const greeting = greetingFor(new Date(), name);
  const chartMax = Math.max(...dash.money.thisWeek, ...dash.money.lastWeek, 0);
  const openCount = view.competitions.filter(
    (competition) => competition.status === "registration_open",
  ).length;
  const liveCount = dash.auctions.filter((auction) => auction.status === "live").length;

  // Portfolio context belongs in the header line, not in a card of its own.
  const headline = [
    `${String(dash.stats.competitions)} season${dash.stats.competitions === 1 ? "" : "s"}`,
    ...(openCount > 0 ? [`${String(openCount)} accepting entries`] : []),
    ...(liveCount > 0 ? [`${String(liveCount)} auction live now`] : []),
  ].join(" · ");

  /* ---- where this organizer actually is ---------------------------------
   *
   * `isEmpty` was binary — orgs AND seasons AND registrations all zero — but
   * the journey has five rungs, and the instant a club existed the flag flipped
   * and the whole analytics dashboard unfurled: four lifecycle stages at 0, a
   * seven-day chart flat at ₹0, three ₹0 money cells, a "Top seasons" table
   * that was a bare header row over nothing, three empty panels, and "All clear
   * — nothing is waiting on you", at the moment 1 of 5 steps was done. That is
   * not a dashboard, it is a dashboard's skeleton, and it teaches nothing.
   *
   * Every rung below is derived from data already loaded — no extra read.
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
  // The ladder retires when the LAST rung is done — the first registrations
  // land — not when the first gap closes. Rungs can complete out of order: a
  // season may be a one-off, which leaves the tournament rung open forever, and
  // "first unfinished rung exists" would then keep the ladder on screen over a
  // mature account with a live auction behind it.
  const currentRung = rungs.findIndex((rung) => !rung.done);
  const laddering = currentRung !== -1 && !(rungs[rungs.length - 1]?.done ?? false);

  /* ---- which panels have earned their space ------------------------------
   *
   * An empty chart, an empty seasons table and three empty panels are noise,
   * not a dashboard. While the ladder is up it owns the "what next" question —
   * including the attention panel's, so the two never say the same thing twice.
   */
  const moneyTotal =
    dash.money.collectedPaise + dash.money.outstandingPaise + dash.money.waivedPaise;
  // One capture is not a trend: a lone payment drew six flat days and a spike,
  // which reads as a collapse followed by a recovery that never happened.
  const chartDays = [...dash.money.thisWeek, ...dash.money.lastWeek].filter(
    (value) => value > 0,
  ).length;
  const showChart = chartDays >= 2;
  const showAttention = !laddering;
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
      {/* The greeting IS this surface's title — the shell's derived "Home"
          gives way to it — and the portfolio line is its lede, so both ride the
          identity bar and the page opens on the work. */}
      <PageTitle title={greeting} subtitle={headline} />
      {view.orgs.length > 0 ? (
        <PageAction>
          {/* The page's ONE primary action, and it was 32px — at the width
              where 44 matters most. `touch` is the 44px rung the product
              standardised on. */}
          <FormDialog
            title="New tournament"
            triggerLabel="+ New tournament"
            size="touch"
            triggerTestId="home-new-tournament"
          >
            <CreateTournamentForm orgs={view.orgs} />
          </FormDialog>
        </PageAction>
      ) : null}

      {laddering ? <SetupLadder rungs={rungs} current={currentRung} /> : null}

      <>
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
                        {liveBoard.onBlock.role.replace(/_/g, " ")}
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
              {liveDone ? "Close out the auction →" : "Enter auction room →"}
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

        {showLeft || showRight ? (
          <div className={`home-main${showLeft && showRight ? "" : " home-main--single"}`}>
            {/* ================= LEFT ================= */}
            {showLeft ? (
              <div className="home-col">
                {showAttention ? (
                  <Card
                    data-testid="attention-queue"
                    className={attention.length > 0 ? "home-panel home-panel--alert" : "home-panel"}
                  >
                    <div className="home-head">
                      <SectionHeader title="Needs attention" />
                      {attention.length > 0 ? (
                        <span className="home-count" aria-live="polite">
                          {attention.length}
                          <VisuallyHidden>
                            {" "}
                            item{attention.length === 1 ? "" : "s"} needing attention
                          </VisuallyHidden>
                        </span>
                      ) : null}
                    </div>
                    {attention.length === 0 ? (
                      <PanelEmpty
                        icon={<Glyph d={G.check} />}
                        text="All clear — nothing is waiting on you."
                      />
                    ) : (
                      <ul className="home-list">
                        {attention.map((row) => (
                          <li key={row.key}>
                            <Link href={row.href} className="home-attn">
                              <span className="home-ic home-ic--warn home-ic--sm">
                                <Glyph d={G.bolt} />
                              </span>
                              <span className="home-attn-text">
                                <strong>{row.label}</strong>
                                <span>{row.detail}</span>
                              </span>
                              <span className="home-go" aria-hidden>
                                →
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    {/* The scan stops at eight and used to say so nowhere, so a
                    portfolio of twenty read as "these eight are all there is". */}
                    {unscanned > 0 ? (
                      <p className="home-scan-note">
                        <span>
                          Checked the {ATTENTION_SCAN_LIMIT} most recent of{" "}
                          {view.competitions.length} seasons.
                        </span>
                        <Link href="/tournaments?view=seasons" className="home-blank-cta">
                          See every season
                        </Link>
                      </p>
                    ) : null}
                  </Card>
                ) : null}

                {showMoney ? (
                  <Card className="home-panel">
                    <div className="home-head">
                      <SectionHeader title="Money overview" />
                      {showChart ? (
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
                      ) : null}
                    </div>
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
                        {/* The chart is the only place these seven numbers exist, and
                      a polyline says nothing to a screen reader. */}
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
                  </Card>
                ) : null}

                {showSeasons ? (
                  <Card className="home-panel home-panel--flush">
                    <div className="home-head home-head--pad">
                      <SectionHeader title="Top seasons" />
                      <Link href="/tournaments?view=seasons" className="home-more">
                        View all
                      </Link>
                    </div>
                    {/* Two renderings, one visible at a time (see home.css).
                    `table-layout: fixed` plus three pinned numeric columns left
                    the season name 0px wide on every phone — 262px of a 316px
                    row was spoken for before the name got a pixel — and
                    `overflow-x: auto` could never rescue it because a
                    `width: 100%` fixed table cannot exceed its wrapper. Below
                    640px the rows become cards with the name first and full
                    width; a horizontally scrolling table would have been the
                    lesser fix and a worse phone. */}
                    <div className="home-table-wrap" data-testid="home-competitions">
                      <table className="home-table">
                        <thead>
                          <tr>
                            <th>Season</th>
                            <th className="home-num">Teams</th>
                            <th className="home-num">Players</th>
                            <th className="home-num">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dash.top.map((row) => (
                            <tr key={row.slug}>
                              <td>
                                <Link href={`/seasons/${row.slug}`} className="home-tcell">
                                  <span className="home-crest home-crest--sm" aria-hidden>
                                    {monogram(row.name)}
                                  </span>
                                  <span className="home-tcell-text">
                                    <strong>{row.name}</strong>
                                    <span>{rupeesShort(row.collectedPaise)} collected</span>
                                  </span>
                                </Link>
                              </td>
                              <td className="home-num home-mono">{row.teams}</td>
                              <td className="home-num home-mono">{row.registrations}</td>
                              <td className="home-num">
                                <Badge tone={statusTone(row.status)}>
                                  {statusLabel(row.status)}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <ul className="home-season-cards">
                        {dash.top.map((row) => (
                          <li key={row.slug}>
                            <Link href={`/seasons/${row.slug}`} className="home-season-card">
                              <span className="home-season-top">
                                <span className="home-crest home-crest--sm" aria-hidden>
                                  {monogram(row.name)}
                                </span>
                                <strong className="home-season-name">{row.name}</strong>
                                <Badge tone={statusTone(row.status)}>
                                  {statusLabel(row.status)}
                                </Badge>
                              </span>
                              <span className="home-season-meta">
                                <span>
                                  <b className="home-mono">{row.teams}</b> team
                                  {row.teams === 1 ? "" : "s"}
                                </span>
                                <span>
                                  <b className="home-mono">{row.registrations}</b> player
                                  {row.registrations === 1 ? "" : "s"}
                                </span>
                                <span>{rupeesShort(row.collectedPaise)} collected</span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </Card>
                ) : null}
              </div>
            ) : null}

            {/* ================= RIGHT ================= */}
            {showRight ? (
              <div className="home-col">
                {showAuctions ? (
                  <Card className="home-panel">
                    <div className="home-head">
                      <SectionHeader title="Active auctions" />
                      <Link href="/tournaments?view=seasons" className="home-more">
                        View all
                      </Link>
                    </div>
                    {otherAuctions.length === 0 ? (
                      <PanelEmpty
                        icon={<Glyph d={G.gavel} />}
                        text={
                          liveRow === null
                            ? "No auction running yet."
                            : "Nothing else scheduled right now."
                        }
                        ctaHref={
                          seasonToOpen === undefined
                            ? "/tournaments?view=seasons"
                            : `/seasons/${seasonToOpen.slug}/auction`
                        }
                        ctaLabel={liveRow === null ? "Set one up" : "Plan the next one"}
                      />
                    ) : (
                      <ul className="home-list">
                        {otherAuctions.map((auction) => (
                          <li key={auction.auctionId}>
                            <Link
                              href={`/seasons/${auction.competitionSlug}/auction`}
                              className="home-auction"
                            >
                              <span className="home-crest" aria-hidden>
                                {monogram(auction.competitionName)}
                              </span>
                              <span className="home-auction-main">
                                <span className="home-auction-top">
                                  <strong>{auction.competitionName}</strong>
                                  <span
                                    className={`home-chip home-chip--${auction.status === "live" ? "live" : "soon"}`}
                                  >
                                    {auction.status === "live" ? "LIVE" : "SCHEDULED"}
                                  </span>
                                </span>
                                <span className="home-auction-meta">
                                  <span>
                                    Spend <b>{rupeesShort(auction.spendPaise)}</b>
                                  </span>
                                  <span>
                                    Lots{" "}
                                    <b>
                                      {auction.lotsSold}/{auction.lotsTotal}
                                    </b>
                                  </span>
                                </span>
                                <span className="home-progress" aria-hidden>
                                  <i
                                    style={{
                                      width: `${String(auction.lotsTotal === 0 ? 0 : Math.round((auction.lotsSold / auction.lotsTotal) * 100))}%`,
                                    }}
                                  />
                                </span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                ) : null}

                {showEvents ? (
                  <Card className="home-panel">
                    <div className="home-head">
                      <SectionHeader title="Upcoming events" />
                    </div>
                    {schedule.length === 0 ? (
                      <PanelEmpty
                        icon={<Glyph d={G.calendar} />}
                        text="No fixtures scheduled."
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
                          const when =
                            fixture.kickoffAt !== null ? new Date(fixture.kickoffAt) : null;
                          return (
                            <li key={fixture.id}>
                              <Link
                                href={`/seasons/${fixture.competitionSlug}/fixtures`}
                                className="home-event"
                              >
                                <span className="home-date">
                                  <b>{when !== null ? IST_DAY.format(when) : "--"}</b>
                                  <span>
                                    {when !== null ? IST_MONTH.format(when).toUpperCase() : "TBD"}
                                  </span>
                                </span>
                                <span className="home-event-text">
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
                  </Card>
                ) : null}

                {showActivity ? (
                  <Card className="home-panel">
                    <div className="home-head">
                      <SectionHeader title="Recent activity" />
                      <Link href="/inbox" className="home-more">
                        View all
                      </Link>
                    </div>
                    {dash.activity.length === 0 ? (
                      <PanelEmpty icon={<Glyph d={G.bolt} />} text="No activity recorded yet." />
                    ) : (
                      <ul className="home-list">
                        {dash.activity.map((row) => {
                          const style = activityStyle(row.action);
                          return (
                            <li key={row.id} className="home-feed">
                              <span className={`home-ic home-ic--${style.tone} home-ic--sm`}>
                                {style.icon}
                              </span>
                              <span className="home-feed-text">
                                <strong>
                                  {row.action === "finops.summary"
                                    ? `${String(row.count)} finance ${row.count === 1 ? "update" : "updates"}`
                                    : activityLabel(row.action)}
                                </strong>
                              </span>
                              <span className="home-time">{ago(row.at)}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </Card>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <HomeShortcuts
          competitions={view.competitions.map((competition) => ({
            slug: competition.slug,
            name: competition.name,
            orgName: competition.orgName,
          }))}
        />

        {registrationsMine.length > 0 ? (
          <>
            <SectionHeader title="My registrations" />
            <Card data-testid="home-registrations">
              <ul className="home-list">
                {registrationsMine.map((registration) => (
                  <li key={registration.competitionSlug}>
                    <Link
                      href={`/seasons/${registration.competitionSlug}/register`}
                      className="home-attn"
                    >
                      <span className="home-crest home-crest--sm" aria-hidden>
                        {monogram(registration.competitionName)}
                      </span>
                      <span className="home-attn-text">
                        <strong>{registration.competitionName}</strong>
                        <span>
                          {registration.orgName} · {registration.role.replace(/_/g, " ")} ·{" "}
                          {registration.number}
                        </span>
                      </span>
                      <Badge tone={REG_TONE[registration.status] ?? "neutral"}>
                        {registration.status}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        ) : null}
      </>
    </>
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
                {rung.done ? "✓" : index + 1}
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
