// Pure showcase filtering/sorting (parity §3.3). No IO, no React — the client
// grid drives its UI from this so the logic is unit-testable without a DB.

// DA-17: retained (pre-signed icon) is its own outcome. Folding it into "sold"
// made a public page announce "4 sold" before a single lot had opened.
export type ShowcaseStatus = "available" | "sold" | "retained";
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

export interface Squad<T> {
  teamName: string;
  players: T[];
}

/**
 * Group SOLD players into squads by team name (teams A→Z, players by number).
 * Pure — the public Squads view renders directly from this. Available players
 * and any sold row missing a team name are excluded.
 */
export function groupSquads<T extends ShowcaseItem & { teamName: string | null }>(
  items: readonly T[],
): Squad<T>[] {
  const byTeam = new Map<string, T[]>();
  for (const it of items) {
    // A squad is everyone on the team sheet — bought at auction or retained.
    if (it.status === "available" || it.teamName === null || it.teamName === "") {
      continue;
    }
    const bucket = byTeam.get(it.teamName);
    if (bucket === undefined) {
      byTeam.set(it.teamName, [it]);
    } else {
      bucket.push(it);
    }
  }
  return [...byTeam.entries()]
    .map(([teamName, players]) => ({
      teamName,
      players: [...players].sort((a, b) => byNumber(a.number, b.number)),
    }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName, undefined, { sensitivity: "base" }));
}

/** Case-insensitive match on player name or registration number. */
function matches(item: ShowcaseItem, needle: string): boolean {
  if (needle === "") {
    return true;
  }
  const q = needle.toLowerCase();
  return item.name.toLowerCase().includes(q) || item.number.toLowerCase().includes(q);
}

const STATUS_RANK: Record<ShowcaseStatus, number> = { available: 0, retained: 1, sold: 2 };

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
export function filterSortPlayers<T extends ShowcaseItem>(
  items: readonly T[],
  q: ShowcaseQuery,
): T[] {
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
