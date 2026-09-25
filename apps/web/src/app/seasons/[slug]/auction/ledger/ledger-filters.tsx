"use client";

import { SegmentedTabs } from "@desiauction/ui";

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
  counts,
}: {
  /** The `filter` param as it arrived ("" when absent). */
  raw: string;
  /** What the server actually filtered by — the raw choice or its default. */
  active: LedgerFilter;
  /** The row count behind the ACTIVE reading, shown on its segment. */
  counts?: Partial<Record<LedgerFilter, number>>;
}) {
  const { commit } = useFilterQuery({ filter: raw });
  return (
    <SegmentedTabs
      label="Show rows"
      testId="ledger-filter"
      items={OPTIONS.map((option) => ({
        key: option.value,
        label: option.label,
        ...(counts?.[option.value] !== undefined ? { count: counts[option.value] } : {}),
        active: active === option.value,
        testId: `ledger-filter-${option.value}`,
        onSelect: () => {
          commit({ filter: option.value });
        },
      }))}
    />
  );
}
