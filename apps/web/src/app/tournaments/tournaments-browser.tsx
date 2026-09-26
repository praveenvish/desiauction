"use client";

import {
  IconGrid,
  IconList,
  Pill,
  SegmentedTabs,
  Toolbar,
  ToolbarCount,
  ToolbarSearch,
  ToolbarSelect,
  ToolbarSpacer,
  ToolbarToggle,
} from "@desiauction/ui";
import { useMemo, useState, type ReactNode } from "react";

import { PageAction } from "../../components/shell/page-action";
import { SeasonCard } from "./season-card";
import { TournamentAccordion, type AccordionGroup } from "./tournament-accordion";

import type { SeasonRow } from "../../server/competition/tournament-actions";
import { formatCount } from "../../lib/plural";

/**
 * Search, filter, sort and layout state for the tournaments index.
 *
 * All four run in the browser rather than through `searchParams`. The page
 * already loads every tournament this person can see — there is no pagination
 * to coordinate with — so a server round-trip per keystroke would buy nothing
 * and cost the instant feedback that makes a search box worth having. The
 * admin surfaces use `searchParams` because their lists are genuinely paged;
 * this one is not, and copying the pattern would be cargo cult.
 *
 * The VIEW MODE is the one deliberate exception, and it is not a filter. It is
 * which of two indexes over the same dataset you are looking at — the thing
 * /seasons used to be a separate URL for — so it has to survive being pasted
 * into a message, and `/seasons` has to redirect somewhere that lands on it.
 * It rides `?view=seasons`, written with `history.replaceState` so switching
 * costs no server round-trip and adds no history entry to click back through.
 * The initial value is read on the SERVER, which is what lets the summary band
 * and the header's primary action follow the active view.
 */

type StatusFilter = "all" | "registration_open" | "registration_closed" | "setup" | "draft";
type Sort = "newest" | "oldest" | "name" | "seasons";

/** "By tournament" (the hierarchy) or "All seasons" (every edition, flat). */
export type ViewMode = "grouped" | "seasons";

/**
 * A group plus the one field only the toolbar needs. The sort key lives here
 * rather than on `AccordionGroup` because the org page renders the same
 * accordion without a toolbar, and has no birthday to give it.
 */
export interface BrowsableGroup extends AccordionGroup {
  /** Epoch ms — a number, so it cannot drift across the server boundary. */
  createdAt: number;
}

/* The status tabs, in the order a season lives them. */
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "setup", label: "In setup" },
  { value: "registration_open", label: "Registration open" },
  { value: "registration_closed", label: "Registration closed" },
];

const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "name", label: "Name A–Z" },
  { value: "seasons", label: "Most seasons" },
];

/** "Most seasons" sorts GROUPS; a flat list of editions has no such figure. */
const SEASON_SORT_OPTIONS = SORT_OPTIONS.filter((option) => option.value !== "seasons");

/**
 * The same order `byEditionDate` gives on the server: dated editions newest
 * first, undated last. Repeated here rather than imported because the server
 * module is `"use server"` — every export would have to be an action.
 *
 * `newest` is negated for `oldest`, but the UNDATED tail is not: a season with
 * no dates is not the oldest edition, it is an edition nobody has scheduled,
 * and flipping the sort should not promote it to the top of the page.
 */
function byEdition(a: SeasonRow, b: SeasonRow, oldestFirst: boolean): number {
  if (a.startsOn === b.startsOn) {
    return 0;
  }
  if (a.startsOn === null) {
    return 1;
  }
  if (b.startsOn === null) {
    return -1;
  }
  const later = a.startsOn > b.startsOn ? -1 : 1;
  return oldestFirst ? -later : later;
}

export function TournamentsBrowser({
  groups,
  initialMode,
  pendingReview = 0,
  featured,
  actionGrouped,
  actionSeasons,
}: {
  groups: BrowsableGroup[];
  initialMode: ViewMode;
  /** Registrations waiting on THIS person, across every season they review. */
  pendingReview?: number;
  /** The featured season (banner + journey), built on the server. */
  featured?: ReactNode;
  /** The header's one primary action per view — absent for someone who holds
      `competition.create` nowhere. */
  actionGrouped?: ReactNode;
  actionSeasons?: ReactNode;
}) {
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [layout, setLayout] = useState<"list" | "grid">("list");

  const filtering = query.trim() !== "" || status !== "all";
  const flat = mode === "seasons";

  function chooseMode(next: ViewMode) {
    setMode(next);
    // Shareable without a navigation: the list, the filters and the scroll
    // position all stay exactly where they are.
    const { pathname } = window.location;
    window.history.replaceState(
      null,
      "",
      next === "seasons" ? `${pathname}?view=seasons` : pathname,
    );
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = groups.flatMap((group) => {
      // A hit on the tournament itself keeps all of its seasons: someone who
      // searched "Premier" wants the tournament, not a filtered slice of it.
      const groupHit =
        q === "" || group.name.toLowerCase().includes(q) || group.meta.toLowerCase().includes(q);
      const seasons = group.seasons.filter((season) => {
        const statusHit = status === "all" || season.status === status;
        const textHit =
          groupHit ||
          season.name.toLowerCase().includes(q) ||
          (season.location ?? "").toLowerCase().includes(q);
        return statusHit && textHit;
      });
      // An empty tournament is real content, so it survives a name match with
      // no status filter — but not a status filter it cannot possibly satisfy.
      if (seasons.length === 0 && !(groupHit && status === "all")) {
        return [];
      }
      return [{ ...group, seasons }];
    });
    return matched.sort((a, b) => {
      // The one-off bucket is a container for leftovers, not a peer: it sits
      // last under every sort rather than jumping the list on "Name A–Z".
      if (a.kind !== b.kind) {
        return a.kind === "standalone" ? 1 : -1;
      }
      switch (sort) {
        case "oldest":
          return a.createdAt - b.createdAt;
        case "name":
          return a.name.localeCompare(b.name);
        case "seasons":
          return b.seasons.length - a.seasons.length;
        default:
          return b.createdAt - a.createdAt;
      }
    });
  }, [groups, query, status, sort]);

  /**
   * The flat view is the SAME match, unpacked. Deriving it from `visible`
   * rather than filtering the seasons again is what makes "search a tournament
   * name, then flip to All seasons" show that tournament's editions — the two
   * views agree on what matched because only one thing decided it.
   */
  const seasons = useMemo(() => {
    const rows = visible.flatMap((group) => group.seasons);
    return [...rows].sort((a, b) => {
      switch (sort) {
        case "oldest":
          return byEdition(a, b, true);
        case "name":
          return a.name.localeCompare(b.name);
        // "Most seasons" is a group figure; a flat list falls back to newest.
        default:
          return byEdition(a, b, false);
      }
    });
  }, [visible, sort]);

  const totalSeasons = groups.reduce((sum, group) => sum + group.seasons.length, 0);
  const shownSeasons = seasons.length;

  // Every figure on the status tabs counts the WHOLE index, whichever tab is
  // open — the tab is the filter, its number is how many it would show.
  const statusCount = (value: StatusFilter): number =>
    value === "all"
      ? totalSeasons
      : groups.reduce(
          (sum, group) => sum + group.seasons.filter((season) => season.status === value).length,
          0,
        );

  const countLine = flat
    ? filtering
      ? `${String(shownSeasons)} of ${String(totalSeasons)} seasons`
      : `${String(totalSeasons)} ${totalSeasons === 1 ? "season" : "seasons"}`
    : filtering
      ? `${String(visible.length)} of ${String(groups.length)} · ${String(shownSeasons)} of ${String(totalSeasons)} seasons`
      : `${String(groups.length)} ${groups.length === 1 ? "tournament" : "tournaments"} · ${String(totalSeasons)} ${totalSeasons === 1 ? "season" : "seasons"}`;

  return (
    <>
      {(flat ? actionSeasons : actionGrouped) !== undefined ? (
        <PageAction>{flat ? actionSeasons : actionGrouped}</PageAction>
      ) : null}

      {featured}

      {/* THE SHARED LIST HEAD (round 2): status tabs with counts, then ONE
          toolbar row — view · search · count · sort · layout — the same kit
          and geometry as Players and Registrations. The four KPI tiles that
          sat here were these same numbers, mostly zeros, and not filters. */}
      <div className="tg-listhead">
        <div className="tg-tabs-row">
          <SegmentedTabs
            label="Season status"
            testId="tg-summary"
            items={STATUS_OPTIONS.map((option) => ({
              key: option.value,
              label: option.label,
              count: formatCount(statusCount(option.value)),
              active: status === option.value,
              onSelect: () => {
                setStatus(option.value);
              },
              testId: `tg-status-${option.value}`,
            }))}
          />
          {pendingReview > 0 ? (
            <Pill tone="amber" dot testId="tg-pending">
              {formatCount(pendingReview)} {pendingReview === 1 ? "registration" : "registrations"}{" "}
              to review
            </Pill>
          ) : null}
        </div>

        <Toolbar className="tg-bar" testId="tg-toolbar">
          <ToolbarToggle
            label="Index view"
            testId="tg-modes"
            items={[
              {
                key: "grouped",
                label: "By tournament",
                active: !flat,
                onSelect: () => {
                  chooseMode("grouped");
                },
                testId: "tg-mode-grouped",
              },
              {
                key: "seasons",
                label: "All seasons",
                active: flat,
                onSelect: () => {
                  chooseMode("seasons");
                },
                testId: "tg-mode-seasons",
              },
            ]}
          />
          <ToolbarSearch
            id="tg-search"
            label="Search tournaments and seasons"
            placeholder="Search tournaments or seasons…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            testId="tg-search"
          />
          <ToolbarSpacer />
          {/* Announces a filter that runs entirely in the browser — nothing
              else would tell a screen reader the list had changed. */}
          <ToolbarCount>
            <span role="status" aria-live="polite" data-testid="tg-results">
              {countLine}
            </span>
          </ToolbarCount>
          <ToolbarSelect
            id="tg-sort"
            label="Sort"
            testId="tg-sort"
            // "Most seasons" cannot be *selected* in the flat view, but it can
            // be *carried in* from the grouped one; the control shows what the
            // list is actually doing rather than a value with no option.
            value={flat && sort === "seasons" ? "newest" : sort}
            onChange={(event) => {
              setSort(event.target.value as Sort);
            }}
            options={flat ? SEASON_SORT_OPTIONS : SORT_OPTIONS}
          />
          {/* Grouped view only: "All seasons" IS the card grid. */}
          {flat ? null : (
            <ToolbarToggle
              label="Season layout"
              items={[
                {
                  key: "list",
                  label: "List",
                  icon: <IconList size={16} />,
                  active: layout === "list",
                  onSelect: () => {
                    setLayout("list");
                  },
                  testId: "tg-view-list",
                },
                {
                  key: "grid",
                  label: "Grid",
                  icon: <IconGrid size={16} />,
                  active: layout === "grid",
                  onSelect: () => {
                    setLayout("grid");
                  },
                  testId: "tg-view-grid",
                },
              ]}
            />
          )}
        </Toolbar>
      </div>

      {flat ? (
        seasons.length === 0 ? (
          <p className="tg-noresults" data-testid="tg-noresults">
            {filtering
              ? "Nothing matches. Try a different name, or pick the “All” tab."
              : "No seasons yet. Every edition you run will appear here."}
          </p>
        ) : (
          <div className="tg-grid tg-seasons" data-testid="competitions-list">
            {seasons.map((season) => (
              <SeasonCard key={season.id} season={season} />
            ))}
          </div>
        )
      ) : visible.length === 0 ? (
        <p className="tg-noresults" data-testid="tg-noresults">
          Nothing matches. Try a different name, or pick the “All” tab.
        </p>
      ) : (
        <div className="tg-list">
          {visible.map((group, index) => (
            <TournamentAccordion
              key={group.key}
              group={group}
              defaultOpen={index === 0}
              view={layout}
              forceOpen={filtering}
            />
          ))}
        </div>
      )}
    </>
  );
}
