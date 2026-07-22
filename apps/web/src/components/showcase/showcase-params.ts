import type { ShowcaseFilter, ShowcaseSort } from "./showcase-filter";

// Pure URL-state mapping for the public showcase (parity §3.3). Keeps filtered /
// squads views shareable and back-button-friendly. No IO — unit-testable.

export type ShowcaseView = "players" | "squads";

export interface ShowcaseState {
  view: ShowcaseView;
  filter: ShowcaseFilter;
  sort: ShowcaseSort;
  query: string;
}

const DEFAULTS: ShowcaseState = { view: "players", filter: "all", sort: "number", query: "" };

const VIEWS: ShowcaseView[] = ["players", "squads"];
const FILTERS: ShowcaseFilter[] = ["all", "available", "sold"];
const SORTS: ShowcaseSort[] = ["number", "name", "status"];

function pick<T extends string>(value: string | null, allowed: T[], fallback: T): T {
  return value !== null && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

/** Parse URL params → validated state (unknown/absent values fall back to defaults). */
export function parseShowcaseParams(params: URLSearchParams): ShowcaseState {
  return {
    view: pick(params.get("view"), VIEWS, DEFAULTS.view),
    filter: pick(params.get("filter"), FILTERS, DEFAULTS.filter),
    sort: pick(params.get("sort"), SORTS, DEFAULTS.sort),
    query: params.get("q") ?? DEFAULTS.query,
  };
}

/** Serialize state → a canonical query string; defaults are OMITTED for clean URLs. */
export function serializeShowcaseParams(state: ShowcaseState): string {
  const p = new URLSearchParams();
  if (state.view !== DEFAULTS.view) p.set("view", state.view);
  if (state.filter !== DEFAULTS.filter) p.set("filter", state.filter);
  if (state.sort !== DEFAULTS.sort) p.set("sort", state.sort);
  if (state.query.trim() !== "") p.set("q", state.query);
  return p.toString();
}
