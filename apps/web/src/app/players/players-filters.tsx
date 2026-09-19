"use client";

import { IconSearch } from "@desiauction/ui";

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
}: {
  /** RAW filter values as of this render ("" means absent) — no `page`. */
  current: Readonly<Record<string, string>>;
  seasons: readonly { slug: string; name: string; orgName: string }[];
  teams: readonly { id: string; label: string }[];
}) {
  const { commit, search, setSearch } = useFilterQuery(current);
  const change = (patch: Record<string, string>) => {
    commit(patch);
  };
  const filtered =
    (current["q"] ?? "") !== "" ||
    (current["season"] ?? "") !== "" ||
    (current["status"] ?? "") !== "" ||
    (current["team"] ?? "") !== "" ||
    (current["mark"] ?? "") !== "";
  return (
    <div className="px-filters" role="search">
      <label className="px-search">
        <span className="px-visually-hidden">Search players</span>
        <IconSearch size={18} aria-hidden />
        <input
          type="search"
          value={search}
          placeholder="Search by name or reg. no."
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          data-testid="players-search"
        />
      </label>
      {seasons.length > 1 ? (
        <Select
          label="Season"
          value={current["season"] ?? ""}
          onChange={(value) => {
            // A team belongs to one season; switching season drops it.
            change({ season: value, team: "" });
          }}
          options={[
            { value: "", label: "All seasons" },
            ...seasons.map((season) => ({ value: season.slug, label: season.name })),
          ]}
        />
      ) : null}
      <Select
        label="Status"
        value={current["status"] ?? ""}
        onChange={(value) => {
          change({ status: value });
        }}
        options={STATUS_OPTIONS}
      />
      {teams.length > 0 ? (
        <Select
          label="Team"
          value={current["team"] ?? ""}
          onChange={(value) => {
            change({ team: value });
          }}
          options={[
            { value: "", label: "All teams" },
            ...teams.map((team) => ({ value: team.id, label: team.label })),
          ]}
        />
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
      <label htmlFor={id} className="px-visually-hidden">
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
