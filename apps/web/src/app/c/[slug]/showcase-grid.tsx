"use client";

import { roleLabel } from "@desiauction/core";
import { Button, ButtonLink, Dialog, PlayerImage } from "@desiauction/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  filterSortPlayers,
  type ShowcaseFilter,
  type ShowcaseSort,
} from "../../../components/showcase/showcase-filter";
import {
  parseShowcaseParams,
  serializeShowcaseParams,
  type ShowcaseView,
} from "../../../components/showcase/showcase-params";
import { showcaseToCsv } from "../../../components/showcase/showcase-csv";
import { track } from "../../../lib/telemetry";
import type { ShowcasePlayer } from "../../../server/competition/public";
import { SquadsView } from "./squads-view";

/**
 * Public player showcase (parity §3.3). Server-rendered list, client search /
 * filter / sort via the pure `filterSortPlayers` core (unit-tested). SEO-safe
 * and it degrades to the full list without JS. Photos fall back to the branded
 * mark (PlayerImage / C-25); no phones are ever in the data. Role labels come
 * from the shared core `roleLabel` (one formatter across the product).
 */
export function ShowcaseGrid({ players, slug }: { players: ShowcasePlayer[]; slug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Seed state from the URL (only the useState initializers below read this, on
  // first render); subsequent URL writes are driven by state, never read back.
  const initial = parseShowcaseParams(new URLSearchParams(searchParams.toString()));

  const [query, setQuery] = useState(initial.query);
  const [filter, setFilter] = useState<ShowcaseFilter>(initial.filter);
  const [sort, setSort] = useState<ShowcaseSort>(initial.sort);
  const [selected, setSelected] = useState<ShowcasePlayer | null>(null);
  const [view, setView] = useState<ShowcaseView>(initial.view);

  // Keep the URL in sync so a filtered/squads view is shareable + back-friendly.
  useEffect(() => {
    const qs = serializeShowcaseParams({ view, filter, sort, query });
    router.replace(qs === "" ? pathname : `${pathname}?${qs}`, { scroll: false });
  }, [view, filter, sort, query, pathname, router]);

  const counts = useMemo(
    () => ({
      all: players.length,
      available: players.filter((p) => p.status === "available").length,
      sold: players.filter((p) => p.status === "sold").length,
      // DA-17: retained players were counted as sold, so a page announced
      // "4 sold" before a single lot had opened.
      retained: players.filter((p) => p.status === "retained").length,
    }),
    [players],
  );
  const shown = useMemo(
    () => filterSortPlayers(players, { query, filter, sort }),
    [players, query, filter, sort],
  );

  function downloadCsv() {
    const blob = new Blob([showcaseToCsv(shown)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "players.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    track("showcase.exported");
  }

  return (
    <div className="showcase">
      <div className="showcase-viewtoggle" role="tablist" aria-label="Showcase view">
        {(["players", "squads"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className="showcase-view"
            data-active={view === v}
            onClick={() => {
              setView(v);
            }}
          >
            {v === "players" ? "Players" : "Squads"}
          </button>
        ))}
      </div>

      {view === "squads" ? (
        <SquadsView players={players} />
      ) : (
        <>
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
            <Button
              variant="secondary"
              size="sm"
              onClick={downloadCsv}
              disabled={shown.length === 0}
            >
              Download CSV
            </Button>
          </div>

          <div className="showcase-filters" role="tablist" aria-label="Filter players">
            {(["all", "available", "sold", "retained"] as const).map((key) => (
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
                {key === "all"
                  ? "All"
                  : key === "available"
                    ? "Available"
                    : key === "sold"
                      ? "Sold"
                      : "Retained"}
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
                  <button
                    type="button"
                    className="showcase-card-btn"
                    aria-label={`View ${p.name}`}
                    onClick={() => {
                      setSelected(p);
                      track("showcase.player_viewed");
                    }}
                  >
                    <PlayerImage
                      name={p.name}
                      seed={p.number}
                      size="xl"
                      {...(p.photoUrl !== null ? { src: p.photoUrl } : {})}
                    />
                    <span className="showcase-card-body">
                      <span className="showcase-card-name">{p.name}</span>
                      <span className="showcase-card-meta">
                        {roleLabel(p.role)}
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
                        {p.status === "available" ? "Available" : (p.teamName ?? "Signed")}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Dialog
        open={selected !== null}
        onClose={() => {
          setSelected(null);
        }}
        title={selected?.name ?? "Player"}
      >
        {selected !== null ? (
          <div className="showcase-detail">
            <PlayerImage
              name={selected.name}
              seed={selected.number}
              size="hero"
              {...(selected.photoUrl !== null ? { src: selected.photoUrl } : {})}
            />
            <dl className="showcase-detail-meta">
              <dt>Number</dt>
              <dd>{selected.number}</dd>
              <dt>Role</dt>
              <dd>{roleLabel(selected.role)}</dd>
              {selected.age !== null ? (
                <>
                  <dt>Age</dt>
                  <dd>{selected.age} yrs</dd>
                </>
              ) : null}
              {selected.battingStyle !== null ? (
                <>
                  <dt>Batting</dt>
                  <dd>{selected.battingStyle.replace(/_/g, " ")}</dd>
                </>
              ) : null}
              {selected.bowlingStyle !== null ? (
                <>
                  <dt>Bowling</dt>
                  <dd>{selected.bowlingStyle.replace(/_/g, " ")}</dd>
                </>
              ) : null}
              <dt>Status</dt>
              <dd>
                {selected.status === "available"
                  ? "Available"
                  : `${selected.teamName ?? "Signed"}${selected.status === "retained" ? " · retained" : ""}`}
              </dd>
            </dl>
            <ButtonLink
              href={`/c/${slug}/p/${selected.number}`}
              variant="secondary"
              size="sm"
              data-testid="player-profile-link"
              onClick={() => {
                track("showcase.player_profile_opened");
              }}
            >
              View full profile
            </ButtonLink>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
