"use client";

import { IconGrid, IconList, IconSearch, VisuallyHidden } from "@desiauction/ui";
import { useMemo, useState, type ReactNode } from "react";

import { PageAction } from "../../components/shell/page-action";
import { SeasonCard } from "./season-card";
import { TournamentAccordion, type AccordionGroup } from "./tournament-accordion";

import type { SeasonRow } from "../../server/competition/tournament-actions";

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

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "registration_open", label: "Registration open" },
  { value: "registration_closed", label: "Registration closed" },
  { value: "setup", label: "In setup" },
  { value: "draft", label: "Draft" },
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
  bandGrouped,
  bandSeasons,
  actionGrouped,
  actionSeasons,
}: {
  groups: BrowsableGroup[];
  initialMode: ViewMode;
  /** The two summary bands, built on the server. The band follows the active
      view: a union of both would describe neither. */
  bandGrouped: ReactNode;
  bandSeasons: ReactNode;
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

  return (
    <>
      {(flat ? actionSeasons : actionGrouped) !== undefined ? (
        <PageAction>{flat ? actionSeasons : actionGrouped}</PageAction>
      ) : null}

      {/* Two indexes over one dataset used to be two URLs with two vocabularies.
          They are one destination now, and this is the switch between them —
          above the band, because the band follows it. */}
      <div className="tg-modes" role="group" aria-label="Index view" data-testid="tg-modes">
        <button
          type="button"
          className="tg-mode-btn"
          aria-pressed={!flat}
          onClick={() => {
            chooseMode("grouped");
          }}
          data-testid="tg-mode-grouped"
        >
          By tournament
        </button>
        <button
          type="button"
          className="tg-mode-btn"
          aria-pressed={flat}
          onClick={() => {
            chooseMode("seasons");
          }}
          data-testid="tg-mode-seasons"
        >
          All seasons
        </button>
      </div>

      {flat ? bandSeasons : bandGrouped}

      <div className="tg-toolbar">
        <div className="tg-search">
          <span className="tg-search-icon" aria-hidden>
            <IconSearch width={18} height={18} />
          </span>
          <input
            type="search"
            className="tg-search-input"
            placeholder={flat ? "Search seasons…" : "Search tournaments…"}
            aria-label="Search tournaments and seasons"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            data-testid="tg-search"
          />
        </div>

        <label className="tg-pill">
          <span className="tg-pill-label">Status:</span>
          <select
            className="tg-pill-select"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as StatusFilter);
            }}
            data-testid="tg-status"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="tg-pill">
          <span className="tg-pill-label">Sort:</span>
          <select
            className="tg-pill-select"
            // "Most seasons" cannot be *selected* in the flat view, but it can
            // be *carried in* from the grouped one; the control shows what the
            // list is actually doing rather than a value with no option.
            value={flat && sort === "seasons" ? "newest" : sort}
            onChange={(event) => {
              setSort(event.target.value as Sort);
            }}
            data-testid="tg-sort"
          >
            {(flat ? SEASON_SORT_OPTIONS : SORT_OPTIONS).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {/* Two states of one setting, so `aria-pressed` on a pair beats a pair
            of unrelated buttons — a screen reader announces which is current.
            Grouped view only: "All seasons" IS the card grid, so a List/Grid
            pair beside the view switch would be a control with one state. */}
        {flat ? null : (
          <div className="tg-view" role="group" aria-label="Season layout">
            <button
              type="button"
              className="tg-view-btn"
              aria-pressed={layout === "list"}
              onClick={() => {
                setLayout("list");
              }}
              data-testid="tg-view-list"
            >
              <IconList width={18} height={18} />
              <VisuallyHidden>List</VisuallyHidden>
            </button>
            <button
              type="button"
              className="tg-view-btn"
              aria-pressed={layout === "grid"}
              onClick={() => {
                setLayout("grid");
              }}
              data-testid="tg-view-grid"
            >
              <IconGrid width={18} height={18} />
              <VisuallyHidden>Grid</VisuallyHidden>
            </button>
          </div>
        )}
      </div>

      {/* Two jobs in one line. It announces the result of a filter that runs
          entirely in the browser (nothing else would tell a screen reader the
          list had changed), and it says out loud that the summary band above is
          NOT filtered — the band kept reading "1 Tournaments / 7 Seasons" with
          one season left on screen, and nothing on the page admitted it. */}
      <p className="tg-results" role="status" aria-live="polite" data-testid="tg-results">
        {flat
          ? filtering
            ? `Showing ${String(shownSeasons)} of ${String(totalSeasons)} seasons. The summary above counts everything.`
            : `Showing all ${String(totalSeasons)} seasons.`
          : filtering
            ? `Showing ${String(visible.length)} of ${String(groups.length)} ${groups.length === 1 ? "group" : "groups"} · ${String(shownSeasons)} of ${String(totalSeasons)} seasons. The summary above counts everything.`
            : `Showing all ${String(groups.length)} ${groups.length === 1 ? "group" : "groups"} · ${String(totalSeasons)} seasons.`}
      </p>

      {flat ? (
        seasons.length === 0 ? (
          <p className="tg-noresults" data-testid="tg-noresults">
            {filtering
              ? "Nothing matches that search. Try a different name, or set Status back to “All”."
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
          Nothing matches that search. Try a different name, or set Status back to “All”.
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
