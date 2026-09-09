"use client";

import { ButtonLink, Dialog, PlayerImage } from "@desiauction/ui";
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
import { track } from "../../../lib/telemetry";
import type { ShowcasePlayer, ShowcasePool } from "../../../server/competition/public";
import { SquadsView } from "./squads-view";

/**
 * Public player showcase (parity §3.3). Server-rendered list, client search /
 * filter / sort via the pure `filterSortPlayers` core (unit-tested). SEO-safe
 * and it degrades to the full list without JS. Photos fall back to the branded
 * mark (PlayerImage / C-25); no phones are ever in the data. Role labels come
 * from the SEASON's pack, passed in as plain {key,label} pairs (`roleLabel`
 * is cricket's, and this page is public).
 *
 * Takes the POOL rather than an array of players. Everything this component
 * computes — the four filter counts, the "N players" line, the squad rollup and
 * the CSV — is derived from rows that are now page-limited on the server, so
 * every one of those numbers is a statement about this page and not about the
 * tournament. `pool.total` is the only number here that describes the
 * tournament, and when the two disagree the component has to say so before it
 * shows a single count.
 */
export function ShowcaseGrid({
  pool,
  slug,
  roles,
}: {
  pool: ShowcasePool;
  slug: string;
  /** The SEASON's roles — `roleLabel` asks cricket, and this page is public. */
  roles: readonly { key: string; label: string }[];
}) {
  const { players, total, truncated } = pool;
  const labelOf = (role: string | null): string =>
    role === null
      ? ""
      : (roles.find((entry) => entry.key === role)?.label ?? role.replace(/_/g, " "));
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

  // There was a "Download CSV" button here, and a "Download squads (CSV)" one
  // in SquadsView. One anonymous click produced players.csv — number, name,
  // role, age, batting, bowling, status, team, one row per approved player — a
  // durable, portable file of civilians' personal data, taken with no account,
  // no record that it happened, and nothing anywhere in the registration funnel
  // disclosing that the button exists. The organizer's own export writes an
  // audit row for exactly this reason (`recordRegistrationExport`,
  // server/competition/registrations.ts:639): "an export is the one read that
  // produces a durable artefact, and it was the only one that wrote no
  // evidence." A public page has no actor to name in that row, so it does not
  // get the capability. Reading the pool a card at a time is what this page is
  // for; leaving with the whole database is not.
  return (
    <div className="showcase">
      {/* Said BEFORE the view toggle, the counts and the grid, because every
          one of those is scoped to the loaded rows and this is the sentence
          that makes them readable. Deliberately names the CSV and the search:
          a visitor who searches for a player in the untruncated tail gets "no
          players match", and without this line that reads as "that player is
          not in this tournament" — a slow page traded for a false one, which
          is exactly the trade a bare LIMIT makes. */}
      {truncated ? (
        <p className="showcase-truncated" data-testid="showcase-truncated">
          This page shows the first {players.length} of {total} approved players. The search,
          filters, squads and CSV below all cover these {players.length} — the rest of the pool is
          not loaded on this page.
        </p>
      ) : null}

      {/* Not a tablist. These claimed `role="tab"`/`aria-selected` with no
          tabpanel, no `aria-controls` and no arrow-key handling, so a screen
          reader announced "tab 1 of 2" and then ArrowRight did nothing — the
          exact contract the role promises, broken. They are toggle buttons over
          one region, and `aria-pressed` says that truthfully with the keyboard
          behaviour buttons already have. Same treatment the directory's facet
          chips use one level up (`role="group"`). */}
      <div className="showcase-viewtoggle" role="group" aria-label="Showcase view">
        {(["players", "squads"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
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
          </div>

          <div className="showcase-filters" role="group" aria-label="Filter players">
            {(["all", "available", "sold", "retained"] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                className="showcase-filter"
                data-active={filter === key}
                onClick={() => {
                  setFilter(key);
                }}
              >
                {/* The status key is "retained" for history's sake, but what it
                    holds is ICONS — `public.ts` sets it from `isIcon`, and the
                    schema's separate `is_retained` flag means something else.
                    Every organiser surface says Icon; so does the card below.
                    Only this filter said Retained. */}
                {key === "all"
                  ? "All"
                  : key === "available"
                    ? "Available"
                    : key === "sold"
                      ? "Sold"
                      : "Icons"}
                <span className="showcase-filter-count">{counts[key]}</span>
              </button>
            ))}
          </div>

          <p className="showcase-count" aria-live="polite">
            {shown.length} {shown.length === 1 ? "player" : "players"}
          </p>

          {shown.length === 0 ? (
            <p className="showcase-empty">
              {truncated
                ? `No players match your search among the ${String(players.length)} loaded on this page.`
                : "No players match your search."}
            </p>
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
                        {labelOf(p.role)}
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
                      {/* "Signed" was the fallback for a player with no team
                          name — which is exactly an approved icon nobody has
                          assigned yet, so the card claimed a team that does not
                          exist. An icon is not signed and not available: they
                          are held out of the auction entirely. */}
                      <span className="showcase-card-status" data-status={p.status}>
                        {p.status === "available" ? "Available" : (p.teamName ?? "Icon player")}
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
              <dd>{labelOf(selected.role)}</dd>
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
                  : selected.teamName === null
                    ? "Icon player — not in the auction"
                    : `${selected.teamName}${selected.status === "retained" ? " · icon" : ""}`}
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
