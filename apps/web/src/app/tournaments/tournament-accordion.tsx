"use client";

import {
  Badge,
  IconArrowRight,
  IconCalendar,
  IconChevronDown,
  IconKebab,
  IconMatch,
  IconPin,
  IconTrophy,
  IconUsers,
  PopoverMenu,
} from "@desiauction/ui";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

import { FormDialog } from "../../components/form-dialog";
import { dateRange, SeasonCard } from "./season-card";

import type { SeasonRow as Season } from "../../server/competition/tournament-actions";

// The tournaments accordion (Tournaments & Orgs.dc.html).
//
// Season rows, not season cards: a card grid gave four editions the same visual
// weight as four tournaments, and an organizer scanning "which of my seasons is
// open?" reads a list far faster than a grid. The grid is still available on
// demand from the toolbar, because a card is the better shape once you are
// comparing a handful of editions rather than scanning many.
//
// The header is a real <button>, which the design's own audit called for: the
// prototype had a div with onClick, so it was unreachable by keyboard and
// announced nothing. A button brings Enter/Space, focus and disabled semantics
// for free — only `aria-expanded`/`aria-controls` have to be stated. It also
// fixes what goes INSIDE the header: the kebab and "+ Season" are siblings of
// the toggle, never children, because a button inside a button is invalid HTML
// and swallows the inner control's keyboard events.

/** Rows past this fold behind "View all seasons" — a long tournament should
    never push the next one off the screen. */
const FOLD = 3;

const STATUS_TONE = {
  draft: "neutral",
  setup: "info",
  registration_open: "success",
  registration_closed: "warning",
} as const;

/** Short forms: the row is scanned, not read. */
const STATUS_LABEL = {
  draft: "Draft",
  setup: "Setup",
  registration_open: "Reg open",
  registration_closed: "Reg closed",
} as const;

/**
 * The group's own state, derived only from its seasons — nothing here is a
 * claim the data cannot back. A tournament with no editions yet is "Upcoming";
 * one whose editions have all closed registration is "Between seasons".
 *
 * NOT "Closed": this badge describes a LEAGUE, and a league whose single
 * edition has stopped taking entries has not finished — it is waiting for its
 * next one. "Closed" on the parent read as an obituary for a competition that
 * runs again next year.
 */
function groupStatus(group: AccordionGroup): {
  label: string;
  tone: "neutral" | "info" | "success" | "warning";
} {
  if (group.kind === "standalone") {
    return { label: "One-off", tone: "neutral" };
  }
  if (group.seasons.length === 0) {
    return { label: "Upcoming", tone: "info" };
  }
  if (group.seasons.some((season) => season.status === "registration_open")) {
    return { label: "Open", tone: "success" };
  }
  if (group.seasons.every((season) => season.status === "draft" || season.status === "setup")) {
    return { label: "In setup", tone: "info" };
  }
  return { label: "Between seasons", tone: "neutral" };
}

function HeadStat({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <span className="tg-stat">
      <span className="tg-stat-icon" aria-hidden>
        {icon}
      </span>
      <span className="tg-stat-body">
        <span className="tg-stat-value">{value}</span>
        <span className="tg-stat-label">{label}</span>
      </span>
    </span>
  );
}

function SeasonRow({ season }: { season: Season }) {
  const when = dateRange(season.startsOn, season.endsOn);
  // The settlement case's word outranks the competition status — a settled
  // season must not read "Reg closed" forever (see seasonStatusBadge, which
  // this mirrors in the row's short-form vocabulary).
  const badge =
    season.settlement === "settled"
      ? { label: "Settled", tone: "success" as const }
      : season.settlement === "settling"
        ? { label: "Settling", tone: "info" as const }
        : { label: STATUS_LABEL[season.status], tone: STATUS_TONE[season.status] };
  return (
    <Link href={`/seasons/${season.slug}`} className="tg-season" data-testid="tg-season">
      <span className="tg-season-glyph" aria-hidden>
        <IconTrophy width={16} height={16} />
      </span>
      <span className="tg-season-id">
        <strong>{season.name}</strong>
        {season.orgName !== "" ? <span>{season.orgName}</span> : null}
        {/* The dates again, in the sub-line. `.tg-season-when` leaves the row
            under 860px, and what was left was name + org + badge + arrow: an
            organizer could not tell the 2026 edition from the 2029 one on a
            phone. Shown only where the full-width column is gone. */}
        {when !== null ? <span className="tg-season-compact">{when}</span> : null}
      </span>
      {/* One container, not two loose badges: below 620px the pair moves to its
          own grid row under the name, and two independent flex items cannot do
          that without overlapping the title they were crushing. */}
      <span className="tg-season-badges">
        {season.running ? (
          <Badge tone="live" className="tg-badge">
            Now running
          </Badge>
        ) : null}
        <Badge tone={badge.tone} className="tg-badge">
          {badge.label}
        </Badge>
      </span>
      {when !== null ? (
        <span className="tg-season-when">
          <IconCalendar width={15} height={15} />
          {when}
        </span>
      ) : null}
      {season.location !== null ? (
        <span className="tg-season-where">
          <IconPin width={15} height={15} />
          {season.location}
        </span>
      ) : null}
      {/* Decorative: the whole row is the link, so this must not be a second
          focusable target inside it. */}
      <span className="tg-season-go" aria-hidden>
        <IconArrowRight width={16} height={16} />
      </span>
    </Link>
  );
}

export interface AccordionGroup {
  key: string;
  name: string;
  /**
   * Org name for a tournament; the explanatory line for the one-off group.
   * Deliberately NOT the season count — the accordion appends that itself from
   * the array it was handed, so the sub-line and the header figures can never
   * disagree once the toolbar filters the list down.
   */
  meta: string;
  seasons: Season[];
  /** The one-off group is a bucket, not a tournament: different glyph. */
  kind: "tournament" | "standalone";
  /** Modal title for this group's "+ Season". */
  seasonDialogTitle: string;
  /** The pre-scoped create form (org fixed, tournament set) — a client element
      the server page builds and hands down untouched. */
  seasonForm: ReactNode;
  /** Absent for the one-off bucket, which has no page of its own. */
  href?: string;
  /**
   * Whether this person may actually create a season here — resolved from
   * their grants, not from membership. "+ Season" used to render for everyone
   * and the server refused staff and viewers after they had filled the form.
   */
  canCreateSeason: boolean;
}

export function TournamentAccordion({
  group,
  defaultOpen,
  view = "list",
  forceOpen = false,
}: {
  group: AccordionGroup;
  defaultOpen: boolean;
  view?: "list" | "grid";
  /** Set while the list is filtered: a hit inside a collapsed group is a hit
      the organizer cannot see. Kept separate from `open` so clearing the
      filter restores whatever they had toggled themselves. */
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const isOpen = forceOpen || open;
  const status = groupStatus(group);
  const teams = group.seasons.reduce((sum, season) => sum + season.counts.teams, 0);
  const matches = group.seasons.reduce((sum, season) => sum + season.counts.matches, 0);
  const folded = !expanded && view === "list" && group.seasons.length > FOLD;
  const shown = folded ? group.seasons.slice(0, FOLD) : group.seasons;
  const tally =
    group.seasons.length === 0
      ? "no seasons yet"
      : `${String(group.seasons.length)} season${group.seasons.length === 1 ? "" : "s"}`;
  const meta = group.meta === "" ? tally : `${group.meta} · ${tally}`;

  const menuItems = [
    ...(group.href !== undefined
      ? [{ key: "open", label: "Open tournament", href: group.href }]
      : []),
    ...group.seasons.slice(0, 1).map((season) => ({
      key: "latest",
      label: "Go to latest season",
      href: `/seasons/${season.slug}`,
    })),
  ];

  return (
    <section className="tg" data-testid={`tg-${group.key}`}>
      <div className="tg-head">
        <button
          type="button"
          className="tg-toggle"
          aria-expanded={isOpen}
          aria-controls={panelId}
          // The overflow trigger in this same header is also a button with
          // aria-expanded, so role+expanded cannot address the toggle alone.
          data-testid={`tg-toggle-${group.key}`}
          onClick={() => {
            setOpen(!isOpen);
          }}
        >
          <span className="tg-caret" data-open={isOpen} aria-hidden>
            <IconChevronDown width={16} height={16} />
          </span>
          <span className={`tg-glyph tg-glyph--${group.kind}`} aria-hidden>
            {group.kind === "tournament" ? <IconTrophy /> : <IconCalendar />}
          </span>
          <span className="tg-id">
            <span className="tg-id-top">
              <span className="tg-name">{group.name}</span>
              <Badge tone={status.tone} className="tg-badge">
                {status.label}
              </Badge>
            </span>
            <span className="tg-meta">{meta}</span>
          </span>
          {group.seasons.length > 0 ? (
            <span className="tg-stats">
              <HeadStat
                icon={<IconCalendar width={16} height={16} />}
                value={group.seasons.length}
                label={group.seasons.length === 1 ? "Season" : "Seasons"}
              />
              <HeadStat icon={<IconUsers width={16} height={16} />} value={teams} label="Teams" />
              <HeadStat
                icon={<IconMatch width={16} height={16} />}
                value={matches}
                label="Matches"
              />
            </span>
          ) : null}
        </button>
        {/* A real button, sized to the platform's 44px rung.
            It was a 73x24 low-contrast text link, on the reasoning that the
            page should spend its one gold on "+ New tournament". That reasoning
            is sound about COLOUR and wrong about WEIGHT: /home sends people
            here with the instruction "Add a season", so the control that does
            the thing they were sent to do cannot be the quietest thing on the
            screen. Secondary keeps the single gold action intact. */}
        {group.canCreateSeason ? (
          <FormDialog
            title={group.seasonDialogTitle}
            triggerLabel="+ Season"
            variant="secondary"
            size="touch"
            triggerClassName="tg-add"
            triggerTestId={`add-season-${group.key}`}
          >
            {group.seasonForm}
          </FormDialog>
        ) : null}
        {menuItems.length > 0 ? (
          <PopoverMenu
            label={`${group.name} actions`}
            trigger={<IconKebab width={18} height={18} />}
            triggerClassName="tg-kebab"
            items={menuItems}
          />
        ) : null}
      </div>
      <div id={panelId} className="tg-body" hidden={!isOpen}>
        {group.seasons.length === 0 ? (
          <p className="tg-empty">
            {group.canCreateSeason
              ? "No seasons yet — use “+ Season” above to add the first one."
              : "No seasons yet. Ask an owner to add a season."}
          </p>
        ) : view === "grid" ? (
          <div className="tg-grid">
            {group.seasons.map((season) => (
              <SeasonCard key={season.id} season={season} />
            ))}
          </div>
        ) : (
          <>
            {shown.map((season) => (
              <SeasonRow key={season.id} season={season} />
            ))}
            {group.seasons.length > FOLD ? (
              <button
                type="button"
                className="tg-more"
                onClick={() => {
                  setExpanded(!expanded);
                }}
              >
                {folded ? `View all seasons (${String(group.seasons.length)})` : "Show fewer"}
                <span className="tg-more-caret" data-open={!folded} aria-hidden>
                  <IconChevronDown width={16} height={16} />
                </span>
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Shimmer rows. Deliberately NOT a route-level `loading.tsx`: a Suspense
 * boundary above this page would commit a 200 before the session gate runs,
 * and /tournaments redirects anonymous visitors to /login. Gate first, then
 * stream.
 */
export function TournamentsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden data-testid="tournaments-skeleton">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="tg tg-skel">
          <span className="tg-skel-glyph" />
          <span className="tg-skel-bar tg-skel-bar--wide" />
          <span className="tg-skel-bar" />
        </div>
      ))}
    </div>
  );
}
