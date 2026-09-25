"use client";

import type { LedgerFilter } from "../../../../../lib/ledger-filter";
import { useFilterQuery } from "../../../../../lib/use-filter-query";

const OPTIONS: readonly { value: LedgerFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "bids", label: "Bids" },
  { value: "results", label: "Results" },
];

/**
 * All · Bids · Results. The server reads the choice (it pages the filtered
 * rows), so this writes the URL through `useFilterQuery`, built from the RAW
 * param rather than the resolved default — a finished auction defaults to
 * Results, and choosing "All" there has to be written as `filter=all`, not
 * dropped as if it were the default. `current` carries no `page`, so every
 * choice lands on page 1 of the new reading.
 */
export function LedgerFilters({
  raw,
  active,
}: {
  /** The `filter` param as it arrived ("" when absent). */
  raw: string;
  /** What the server actually filtered by — the raw choice or its default. */
  active: LedgerFilter;
}) {
  const { commit } = useFilterQuery({ filter: raw });
  return (
    <div className="ledger-filter" role="group" aria-label="Show rows">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="ledger-filter-chip"
          aria-pressed={active === option.value}
          onClick={() => {
            commit({ filter: option.value });
          }}
          data-testid={`ledger-filter-${option.value}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
