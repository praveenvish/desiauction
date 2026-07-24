"use client";

import {
  Badge,
  IconArrowRight,
  IconCalendar,
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
 * one whose editions have all closed registration is "Closed".
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
  return { label: "Closed", tone: "warning" };
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
  return (
    <Link href={`/seasons/${season.slug}`} className="tg-season" data-testid="tg-season">
      <span className="tg-season-glyph" aria-hidden>
        <IconTrophy width={16} height={16} />
      </span>
      <span className="tg-season-id">
        <strong>{season.name}</strong>
        {season.orgName !== "" ? <span>{season.orgName}</span> : null}
      </span>
      <Badge tone={STATUS_TONE[season.status]}>{STATUS_LABEL[season.status]}</Badge>
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
            ▸
          </span>
          <span className={`tg-glyph tg-glyph--${group.kind}`} aria-hidden>
            {group.kind === "tournament" ? <IconTrophy /> : "◎"}
          </span>
          <span className="tg-id">
            <span className="tg-id-top">
              <span className="tg-name">{group.name}</span>
              <Badge tone={status.tone}>{status.label}</Badge>
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
        {/* Secondary by design: the audit flagged "+ New tournament" and
            "+ Season" reading as equals. The page keeps ONE gold action, and
            "+ Season" opens the create modal in place. */}
        <FormDialog
          title={group.seasonDialogTitle}
          triggerLabel="+ Season"
          triggerAsLink
          triggerClassName="tg-add"
          triggerTestId={`add-season-${group.key}`}
        >
          {group.seasonForm}
        </FormDialog>
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
          <p className="tg-empty">No seasons yet — use “+ Season” above to add the first one.</p>
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
                  ▾
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
