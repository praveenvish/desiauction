"use client";

import {
  Pill,
  SegmentedTabs,
  Toolbar,
  ToolbarCount,
  ToolbarSearch,
  ToolbarSelect,
  ToolbarSpacer,
  ToolbarToggle,
  buttonClassName,
} from "@desiauction/ui";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { formatCount } from "../../lib/plural";
import type { SeasonRow } from "../../server/competition/tournament-actions";
import { dateRange } from "./season-card";
import { SeasonRoad } from "./season-road";
import {
  STAGE_LABEL,
  STAGE_ORDER,
  initialsOf,
  nextStep,
  seasonStage,
  type StageKey,
} from "./season-stage";
import { StagePill, TournamentCard, type BrowsableGroup } from "./tournament-card";

/**
 * "YOUR TOURNAMENTS" — the list half of the tournaments index (2026-09-27).
 *
 * Two views of one dataset: by tournament (cards, each with its editions) and
 * every season flat (rows, each with its stage and next step). The view rides
 * `?view=seasons` so /seasons can redirect onto it; search, stage and sort run
 * in the browser — the page already holds every tournament this person can
 * see, and there is no pagination to coordinate with.
 *
 * FILTERS BY STAGE, NOT STATUS. The tabs used to be the competition's status
 * column — Draft · In setup · Registration open · Registration closed — which
 * stops moving at registration: a season with its squads picked and its
 * matches under way was filed under "Registration closed", mostly beside four
 * zeros. The chips are the season's stage (`seasonStage`), in the card's own
 * words, and a chip that would count nothing is not drawn.
 *
 * ONE PRIMARY ACTION in both views ("+ New tournament", in the identity bar).
 * The flat view carries "New season" as its own secondary button — the view is
 * about editions, and every inbound /seasons link arrives expecting it.
 */

type StageFilter = "all" | StageKey;
type Sort = "newest" | "oldest" | "name" | "seasons";

/** "By tournament" (cards) or "All seasons" (every edition, flat). */
export type ViewMode = "grouped" | "seasons";

const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "name", label: "Name A–Z" },
  { value: "seasons", label: "Most seasons" },
];

/** "Most seasons" sorts GROUPS; a flat list of editions has no such figure. */
const SEASON_SORT_OPTIONS = SORT_OPTIONS.filter((option) => option.value !== "seasons");

/**
 * Dated editions newest first, undated last — the server's `byEditionDate`.
 * Flipping to oldest does not promote the undated tail: a season with no
 * dates is not the oldest edition, it is one nobody has scheduled.
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
  today,
  pendingReview = 0,
  tournamentNames,
  startCard,
  newSeason,
}: {
  groups: BrowsableGroup[];
  initialMode: ViewMode;
  /** The wall-clock date the stages are judged against. */
  today: string;
  /** Registrations waiting on THIS person, across every season they review. */
  pendingReview?: number;
  /** Tournament names by id — the flat rows say which tournament a season is of. */
  tournamentNames: Record<string, string>;
  /** "Run another tournament" — built on the server (its forms are gated there). */
  startCard?: ReactNode;
  /** The flat view's "New season" — absent for someone who may create nowhere. */
  newSeason?: ReactNode;
}) {
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<StageFilter>("all");
  const [sort, setSort] = useState<Sort>("newest");

  const filtering = query.trim() !== "" || stage !== "all";
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
        const stageHit = stage === "all" || seasonStage(season, today) === stage;
        const textHit =
          groupHit ||
          season.name.toLowerCase().includes(q) ||
          (season.location ?? "").toLowerCase().includes(q);
        return stageHit && textHit;
      });
      // An empty tournament is real content, so it survives a name match with
      // no stage filter — but not a stage filter it cannot possibly satisfy.
      if (seasons.length === 0 && !(groupHit && stage === "all")) {
        return [];
      }
      return [{ ...group, seasons }];
    });
    return matched.sort((a, b) => {
      // The one-off bucket is a container for leftovers, not a peer.
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
  }, [groups, query, stage, sort, today]);

  /** The flat view is the SAME match, unpacked — the two views agree on what matched. */
  const seasons = useMemo(() => {
    const rows = visible.flatMap((group) => group.seasons);
    return [...rows].sort((a, b) => {
      switch (sort) {
        case "oldest":
          return byEdition(a, b, true);
        case "name":
          return a.name.localeCompare(b.name);
        default:
          return byEdition(a, b, false);
      }
    });
  }, [visible, sort]);

  const all = useMemo(() => groups.flatMap((group) => group.seasons), [groups]);
  const totalSeasons = all.length;
  const tournamentCount = groups.filter((group) => group.kind === "tournament").length;

  // Every chip counts the WHOLE index — the chip is the filter, its number is
  // how many it would show — and a chip that would count nothing is not drawn.
  const stageCounts = useMemo(() => {
    const counts = new Map<StageKey, number>();
    for (const season of all) {
      const key = seasonStage(season, today);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [all, today]);
  const chips = STAGE_ORDER.filter((key) => (stageCounts.get(key) ?? 0) > 0 || stage === key);

  const countLine = flat
    ? filtering
      ? `${String(seasons.length)} of ${String(totalSeasons)} seasons`
      : `${String(totalSeasons)} ${totalSeasons === 1 ? "season" : "seasons"}`
    : filtering
      ? `${String(visible.length)} of ${String(groups.length)} · ${String(seasons.length)} of ${String(totalSeasons)} seasons`
      : `${String(tournamentCount)} ${tournamentCount === 1 ? "tournament" : "tournaments"} · ${String(totalSeasons)} ${totalSeasons === 1 ? "season" : "seasons"}`;

  return (
    <section className="tx-list" aria-labelledby="tx-list-title">
      <header className="tx-section-head">
        <h2 id="tx-list-title">Your tournaments</h2>
        {pendingReview > 0 ? (
          <Pill tone="amber" dot testId="tg-pending">
            {formatCount(pendingReview)} {pendingReview === 1 ? "registration" : "registrations"} to
            review
          </Pill>
        ) : null}
        <span className="tx-section-spacer" />
        {flat && newSeason !== undefined ? newSeason : null}
      </header>

      <Toolbar className="tx-bar" testId="tg-toolbar">
        <ToolbarToggle
          label="Index view"
          testId="tg-modes"
          items={[
            {
              key: "grouped",
              label: "Tournaments",
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
        {chips.length > 1 || stage !== "all" ? (
          <SegmentedTabs
            label="Season stage"
            testId="tg-summary"
            items={[
              {
                key: "all",
                label: "All",
                count: formatCount(totalSeasons),
                active: stage === "all",
                onSelect: () => {
                  setStage("all");
                },
                testId: "tg-status-all",
              },
              ...chips.map((key) => ({
                key,
                label: STAGE_LABEL[key],
                count: formatCount(stageCounts.get(key) ?? 0),
                active: stage === key,
                onSelect: () => {
                  setStage(stage === key ? "all" : key);
                },
                testId: `tg-status-${key}`,
              })),
            ]}
          />
        ) : null}
        <ToolbarSpacer />
        {/* Announces a filter that runs entirely in the browser — nothing else
            would tell a screen reader the list had changed. */}
        <ToolbarCount>
          <span role="status" aria-live="polite" data-testid="tg-results">
            {countLine}
          </span>
        </ToolbarCount>
        <ToolbarSearch
          id="tg-search"
          label="Search tournaments and seasons"
          placeholder="Search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          testId="tg-search"
        />
        <ToolbarSelect
          id="tg-sort"
          label="Sort"
          testId="tg-sort"
          value={flat && sort === "seasons" ? "newest" : sort}
          onChange={(event) => {
            setSort(event.target.value as Sort);
          }}
          options={flat ? SEASON_SORT_OPTIONS : SORT_OPTIONS}
        />
      </Toolbar>

      {flat ? (
        seasons.length === 0 ? (
          <p className="tg-noresults" data-testid="tg-noresults">
            {filtering
              ? "Nothing matches. Try a different name, or pick “All”."
              : "No seasons yet. Every edition you run will appear here."}
          </p>
        ) : (
          <SeasonList seasons={seasons} today={today} tournamentNames={tournamentNames} />
        )
      ) : visible.length === 0 ? (
        <p className="tg-noresults" data-testid="tg-noresults">
          Nothing matches. Try a different name, or pick “All”.
        </p>
      ) : (
        <div className="tx-cards">
          {visible.map((group) => (
            <TournamentCard key={group.key} group={group} today={today} showAll={filtering} />
          ))}
          {filtering ? null : startCard}
        </div>
      )}
    </section>
  );
}

/** Every edition, one row each: who, when, where it stands, how big, what next. */
function SeasonList({
  seasons,
  today,
  tournamentNames,
}: {
  seasons: readonly SeasonRow[];
  today: string;
  tournamentNames: Record<string, string>;
}) {
  return (
    <div className="tx-seasons" data-testid="competitions-list" role="table" aria-label="Seasons">
      <div className="tx-seasons-head" role="row">
        <span role="columnheader">Season</span>
        <span role="columnheader">When</span>
        <span role="columnheader">Where it is</span>
        <span role="columnheader">Size</span>
        <span role="columnheader">
          <span className="st-sr">Next step</span>
        </span>
      </div>
      {seasons.map((season) => {
        const stage = seasonStage(season, today);
        const step = nextStep(season, today);
        const parent =
          season.tournamentId !== null
            ? (tournamentNames[season.tournamentId] ?? "Tournament")
            : "One-off";
        const size = [
          season.counts.teams > 0
            ? `${formatCount(season.counts.teams)} ${season.counts.teams === 1 ? "team" : "teams"}`
            : null,
          (season.counts.approved ?? 0) > 0
            ? `${formatCount(season.counts.approved ?? 0)} players`
            : null,
        ]
          .filter((part) => part !== null)
          .join(" · ");
        return (
          <div className="tx-season" role="row" key={season.id} data-testid="tx-season">
            <span className="tx-season-id" role="cell">
              <span className="tx-crest" aria-hidden>
                {initialsOf(season.name)}
              </span>
              <span className="tx-season-names">
                <Link href={`/seasons/${season.slug}`} className="tx-season-name">
                  {season.name}
                </Link>
                <span>
                  {[parent, season.orgName, season.location]
                    .filter((part) => part !== null && part !== "")
                    .join(" · ")}
                </span>
              </span>
            </span>
            <span className="tx-season-when" role="cell">
              {dateRange(season.startsOn, season.endsOn) ?? "Dates to be set"}
            </span>
            <span className="tx-season-stage" role="cell">
              <SeasonRoad season={season} size="sm" />
              {season.running ? (
                <span className="tx-pill" data-tone="running">
                  Now running
                </span>
              ) : null}
              <StagePill stage={stage} />
            </span>
            <span className="tx-season-size" role="cell">
              {size === "" ? "—" : size}
            </span>
            <span className="tx-season-next" role="cell">
              {step !== null ? (
                <Link
                  href={step.href}
                  className={buttonClassName({
                    variant: step.urgent ? "primary" : "secondary",
                    size: "sm",
                  })}
                >
                  {step.label}
                </Link>
              ) : (
                <Link
                  href={`/seasons/${season.slug}`}
                  className={buttonClassName({ variant: "ghost", size: "sm" })}
                >
                  View
                </Link>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
