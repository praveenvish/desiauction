import { formatPaiseINR, paise } from "@desiauction/core";
import { Money, VisuallyHidden, IconCheck } from "@desiauction/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { auctionDashboard } from "../../server/auction/actions";
import { registrationDashboard } from "../../server/competition/actions";
import type { HomeDashboardData, HomeStages } from "../../server/home/dashboard";

/**
 * THE ORGANIZER'S DASHBOARD, IN PIECES.
 *
 * Everything `organizer-home.tsx` renders WITH, separated from what it
 * renders. The split is not cosmetic: the home was a 1306-line file, which is
 * the same failure /home itself had before RN-1 Phase 3 — a surface nobody can
 * review as a whole is a surface that drifts in the middle.
 *
 * Nothing here knows which role is reading. It is formatting, iconography and
 * the two derivations (the attention scan, the lifecycle counts) that the
 * dashboard is built from.
 */

export interface AttentionRow {
  key: string;
  label: string;
  detail: string;
  href: string;
}

export const ATTENTION_SCAN_LIMIT = 8;

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
export async function attentionFor(
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

export const G = {
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

export function Glyph({ d }: { d: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      {d}
    </svg>
  );
}

/** An empty panel should still sell the next move, not just report nothing. */
export function PanelEmpty({
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

export function rupees(value: number): string {
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
export function rupeesShort(value: number): string {
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
export const IST_DAY = new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "2-digit" });
export const IST_MONTH = new Intl.DateTimeFormat("en-IN", { timeZone: IST, month: "short" });

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
  // Written by the privacy desk when a member or player asked to be erased.
  "person.erased": "A member's account was erased",
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
export function activityLabel(action: string): string {
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

export function activityStyle(action: string): { tone: string; icon: ReactNode } {
  return (
    ACTIVITY_STYLE[action.split(".")[0] ?? ""] ?? { tone: "accent", icon: <Glyph d={G.bolt} /> }
  );
}

export function ago(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  return `${String(Math.floor(hours / 24))}d`;
}

/** Build a polyline `points` string for a 7-value series. */
export function points(series: number[], max: number): string {
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

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
export function lifecycleFor(dash: HomeDashboardData): {
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

export function MoneyCell({
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

export interface SetupRung {
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
export function SetupLadder({ rungs, current }: { rungs: SetupRung[]; current: number }) {
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
