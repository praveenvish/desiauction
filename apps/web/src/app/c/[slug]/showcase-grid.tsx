"use client";

import { PlayerImage } from "@desiauction/ui";
import { useMemo, useState } from "react";

import {
  filterSortPlayers,
  type ShowcaseFilter,
  type ShowcaseSort,
} from "../../../components/showcase/showcase-filter";
import type { ShowcasePlayer } from "../../../server/competition/public";

const ROLE_LABEL: Record<string, string> = {
  batter: "Batter",
  bowler: "Bowler",
  all_rounder: "All-rounder",
  wicket_keeper: "Wicket-keeper",
};

/**
 * Public player showcase (parity §3.3). Server-rendered list, client search /
 * filter / sort via the pure `filterSortPlayers` core (unit-tested). SEO-safe
 * and it degrades to the full list without JS. Photos fall back to the branded
 * mark (PlayerImage / C-25); no phones are ever in the data.
 */
export function ShowcaseGrid({ players }: { players: ShowcasePlayer[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ShowcaseFilter>("all");
  const [sort, setSort] = useState<ShowcaseSort>("number");

  const counts = useMemo(
    () => ({
      all: players.length,
      available: players.filter((p) => p.status === "available").length,
      sold: players.filter((p) => p.status === "sold").length,
    }),
    [players],
  );
  const shown = useMemo(
    () => filterSortPlayers(players, { query, filter, sort }),
    [players, query, filter, sort],
  );

  return (
    <div className="showcase">
      <div className="showcase-controls">
        <input
          type="search"
          className="showcase-search"
          placeholder="Search players…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          aria-label="Search players by name or number"
        />
        <label className="showcase-sort">
          <span className="visually-hidden">Sort players</span>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as ShowcaseSort);
            }}
          >
            <option value="number">Sort: number</option>
            <option value="name">Sort: name</option>
            <option value="status">Sort: status</option>
          </select>
        </label>
      </div>

      <div className="showcase-filters" role="tablist" aria-label="Filter players">
        {(["all", "available", "sold"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className="showcase-filter"
            data-active={filter === key}
            onClick={() => {
              setFilter(key);
            }}
          >
            {key === "all" ? "All" : key === "available" ? "Available" : "Sold"}
            <span className="showcase-filter-count">{counts[key]}</span>
          </button>
        ))}
      </div>

      <p className="showcase-count" aria-live="polite">
        {shown.length} {shown.length === 1 ? "player" : "players"}
      </p>

      {shown.length === 0 ? (
        <p className="showcase-empty">No players match your search.</p>
      ) : (
        <ul className="showcase-grid" data-testid="showcase-grid">
          {shown.map((p) => (
            <li key={p.number} className="showcase-card" data-status={p.status}>
              <PlayerImage
                name={p.name}
                seed={p.number}
                size="xl"
                {...(p.photoUrl !== null ? { src: p.photoUrl } : {})}
              />
              <div className="showcase-card-body">
                <span className="showcase-card-name">{p.name}</span>
                <span className="showcase-card-meta">
                  {ROLE_LABEL[p.role] ?? p.role}
                  {p.age !== null ? ` · ${String(p.age)} yrs` : ""}
                </span>
                {p.battingStyle !== null || p.bowlingStyle !== null ? (
                  <span className="showcase-card-sub">
                    {[p.battingStyle, p.bowlingStyle]
                      .filter((s): s is string => s !== null)
                      .map((s) => s.replace(/_/g, " "))
                      .join(" · ")}
                  </span>
                ) : null}
                <span className="showcase-card-status" data-status={p.status}>
                  {p.status === "sold" ? (p.teamName ?? "Sold") : "Available"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
