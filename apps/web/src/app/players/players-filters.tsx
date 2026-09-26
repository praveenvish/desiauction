"use client";

import {
  FilterMenu,
  Toolbar,
  ToolbarChip,
  ToolbarCount,
  ToolbarSearch,
  ToolbarSpacer,
} from "@desiauction/ui";

import { useFilterQuery } from "../../lib/use-filter-query";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "waitlisted", label: "Waitlisted" },
  { value: "rejected", label: "Declined" },
  { value: "withdrawn", label: "Withdrawn" },
];

/**
 * The /players filter row. Every value lives in the URL and is read by the
 * server (`useFilterQuery`), and every change resets the page — a filter that
 * narrows 400 players to 12 must not leave the reader on page 9 of nothing.
 * That falls out of `current` carrying NO `page`: the hook builds the next URL
 * from `current` + the patch, so a page number simply is not in it.
 */
export function PlayersFilters({
  current,
  seasons,
  teams,
  countLabel,
}: {
  /** RAW filter values as of this render ("" means absent) — no `page`. */
  current: Readonly<Record<string, string>>;
  seasons: readonly { slug: string; name: string; orgName: string }[];
  teams: readonly { id: string; label: string }[];
  /** "43 players" — the toolbar's quiet count. */
  countLabel: string;
}) {
  const { commit, search, setSearch } = useFilterQuery(current);
  const change = (patch: Record<string, string>) => {
    commit(patch);
  };
  const season = current["season"] ?? "";
  const status = current["status"] ?? "";
  const team = current["team"] ?? "";
  const filtered =
    (current["q"] ?? "") !== "" ||
    season !== "" ||
    status !== "" ||
    team !== "" ||
    (current["mark"] ?? "") !== "";
  const menuCount = [season, status, team].filter((value) => value !== "").length;
  const seasonName = seasons.find((entry) => entry.slug === season)?.name ?? season;
  const teamName = teams.find((entry) => entry.id === team)?.label ?? team;
  const statusName = STATUS_OPTIONS.find((entry) => entry.value === status)?.label ?? status;
  /*
   * ONE ROW (wow pass). Search, the filters that are set (as removable chips),
   * the count, and the rest behind one "Filters" menu. It used to be a card
   * header, then a search row, then a row of selects — three bands, ~250px,
   * before the first player.
   */
  return (
    <div className="px-toolbar" role="search">
      <Toolbar>
        <ToolbarSearch
          id="players-search"
          label="Search players"
          placeholder="Search by name or reg. no."
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          testId="players-search"
        />
        {season !== "" ? (
          <ToolbarChip
            removeLabel="Remove season filter"
            onRemove={() => {
              change({ season: "", team: "" });
            }}
          >
            {seasonName}
          </ToolbarChip>
        ) : null}
        {status !== "" ? (
          <ToolbarChip
            removeLabel="Remove status filter"
            onRemove={() => {
              change({ status: "" });
            }}
          >
            {statusName}
          </ToolbarChip>
        ) : null}
        {team !== "" ? (
          <ToolbarChip
            removeLabel="Remove team filter"
            onRemove={() => {
              change({ team: "" });
            }}
          >
            {teamName}
          </ToolbarChip>
        ) : null}
        {filtered ? (
          <button
            type="button"
            className="px-reset"
            onClick={() => {
              // No setSearch(""): its debounced write would land after this one,
              // built from values that may still be the old ones. The box follows
              // the URL once `q` clears (useFilterQuery's sync effect).
              commit({ q: "", season: "", status: "", team: "", mark: "" });
            }}
          >
            Reset
          </button>
        ) : null}
        <ToolbarSpacer />
        <ToolbarCount testId="players-count">{countLabel}</ToolbarCount>
        <FilterMenu activeCount={menuCount} testId="players-filter-menu">
          <div className="px-menu-fields">
            {seasons.length > 1 ? (
              <Select
                label="Season"
                value={season}
                onChange={(value) => {
                  // A team belongs to one season; switching season drops it.
                  change({ season: value, team: "" });
                }}
                options={[
                  { value: "", label: "All seasons" },
                  ...seasons.map((entry) => ({ value: entry.slug, label: entry.name })),
                ]}
              />
            ) : null}
            <Select
              label="Status"
              value={status}
              onChange={(value) => {
                change({ status: value });
              }}
              options={STATUS_OPTIONS}
            />
            {teams.length > 0 ? (
              <Select
                label="Team"
                value={team}
                onChange={(value) => {
                  change({ team: value });
                }}
                options={[
                  { value: "", label: "All teams" },
                  ...teams.map((entry) => ({ value: entry.id, label: entry.label })),
                ]}
              />
            ) : null}
          </div>
        </FilterMenu>
      </Toolbar>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  const id = `px-filter-${label.toLowerCase()}`;
  return (
    <span className="px-select-wrap">
      <label htmlFor={id} className="px-menu-label">
        {label}
      </label>
      <select
        id={id}
        className="px-select"
        value={value}
        data-active={value !== "" ? "true" : undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}
