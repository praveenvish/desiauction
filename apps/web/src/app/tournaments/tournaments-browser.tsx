"use client";

import { IconGrid, IconList, IconSearch, VisuallyHidden } from "@desiauction/ui";
import { useMemo, useState } from "react";

import { TournamentAccordion, type AccordionGroup } from "./tournament-accordion";

/**
 * Search, filter, sort and view state for the tournaments index.
 *
 * All four run in the browser rather than through `searchParams`. The page
 * already loads every tournament this person can see — there is no pagination
 * to coordinate with — so a server round-trip per keystroke would buy nothing
 * and cost the instant feedback that makes a search box worth having. The
 * admin surfaces use `searchParams` because their lists are genuinely paged;
 * this one is not, and copying the pattern would be cargo cult.
 */

type StatusFilter = "all" | "registration_open" | "registration_closed" | "setup" | "draft";
type Sort = "newest" | "oldest" | "name" | "seasons";

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

export function TournamentsBrowser({ groups }: { groups: BrowsableGroup[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [view, setView] = useState<"list" | "grid">("list");

  const filtering = query.trim() !== "" || status !== "all";

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

  return (
    <>
      <div className="tg-toolbar">
        <div className="tg-search">
          <span className="tg-search-icon" aria-hidden>
            <IconSearch width={18} height={18} />
          </span>
          <input
            type="search"
            className="tg-search-input"
            placeholder="Search tournaments…"
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
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as Sort);
            }}
            data-testid="tg-sort"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {/* Two states of one setting, so `aria-pressed` on a pair beats a pair
            of unrelated buttons — a screen reader announces which is current. */}
        <div className="tg-view" role="group" aria-label="Season layout">
          <button
            type="button"
            className="tg-view-btn"
            aria-pressed={view === "list"}
            onClick={() => {
              setView("list");
            }}
            data-testid="tg-view-list"
          >
            <IconList width={18} height={18} />
            <VisuallyHidden>List</VisuallyHidden>
          </button>
          <button
            type="button"
            className="tg-view-btn"
            aria-pressed={view === "grid"}
            onClick={() => {
              setView("grid");
            }}
            data-testid="tg-view-grid"
          >
            <IconGrid width={18} height={18} />
            <VisuallyHidden>Grid</VisuallyHidden>
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
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
              view={view}
              forceOpen={filtering}
            />
          ))}
        </div>
      )}
    </>
  );
}
