// Pure showcase filtering/sorting (parity §3.3). No IO, no React — the client
// grid drives its UI from this so the logic is unit-testable without a DB.

export type ShowcaseStatus = "available" | "sold";
export type ShowcaseFilter = "all" | ShowcaseStatus;
export type ShowcaseSort = "number" | "name" | "status";

export interface ShowcaseItem {
  number: string;
  name: string;
  status: ShowcaseStatus;
}

export interface ShowcaseQuery {
  query: string;
  filter: ShowcaseFilter;
  sort: ShowcaseSort;
}

/** Case-insensitive match on player name or registration number. */
function matches(item: ShowcaseItem, needle: string): boolean {
  if (needle === "") {
    return true;
  }
  const q = needle.toLowerCase();
  return item.name.toLowerCase().includes(q) || item.number.toLowerCase().includes(q);
}

const STATUS_RANK: Record<ShowcaseStatus, number> = { available: 0, sold: 1 };

/** Numeric-aware compare so "2" sorts before "10". */
function byNumber(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) {
    return na - nb;
  }
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Filter by status + free-text, then sort. Stable, deterministic, and total:
 * unknown inputs fall back to number order. Returns a new array.
 */
export function filterSortPlayers<T extends ShowcaseItem>(items: readonly T[], q: ShowcaseQuery): T[] {
  const filtered = items.filter(
    (it) => (q.filter === "all" || it.status === q.filter) && matches(it, q.query.trim()),
  );
  const sorted = [...filtered];
  sorted.sort((a, b) => {
    if (q.sort === "name") {
      const n = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      return n !== 0 ? n : byNumber(a.number, b.number);
    }
    if (q.sort === "status") {
      const s = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      return s !== 0 ? s : byNumber(a.number, b.number);
    }
    return byNumber(a.number, b.number);
  });
  return sorted;
}
