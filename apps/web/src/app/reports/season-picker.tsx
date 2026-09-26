"use client";

import { useFilterQuery } from "../../lib/use-filter-query";

/** Which season the report is about — written to the URL, read by the server. */
export function SeasonPicker({
  current,
  seasons,
}: {
  current: string;
  seasons: readonly { slug: string; name: string; orgName: string }[];
}) {
  const { commit } = useFilterQuery({ season: current });
  const multiOrg = new Set(seasons.map((season) => season.orgName)).size > 1;
  return (
    <span className="rp-picker">
      <label htmlFor="rp-season" className="rp-picker-label">
        Season
      </label>
      <select
        id="rp-season"
        className="px-select"
        value={current}
        onChange={(event) => {
          commit({ season: event.target.value });
        }}
        data-testid="reports-season"
      >
        {seasons.map((season) => (
          <option key={season.slug} value={season.slug}>
            {multiOrg ? `${season.name} · ${season.orgName}` : season.name}
          </option>
        ))}
      </select>
    </span>
  );
}
