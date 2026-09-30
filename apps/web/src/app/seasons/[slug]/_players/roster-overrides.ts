/**
 * WHICH CHANGES OUTLIVE A PAGE THAT HAS JUST ARRIVED FROM THE SERVER.
 *
 * A page is the truth AS OF THE MOMENT IT WAS ASKED FOR, and this screen asks
 * for pages constantly: a refresh after every write, and another every time
 * the open sheet moves to the next player (the address changes, and the
 * framework fetches the page for the new one). The roster used to keep a
 * change only while its write was in flight and drop it the moment ANY page
 * arrived. A fast reviewer loses that race about one time in three:
 *
 *   1. approve B → the sheet moves to C → a page for C's address is asked for
 *                  (it will say "C: waiting")
 *   2. approve C, and the write lands        → C is approved, not "in flight"
 *   3. the page from step 1 arrives           → C's change is dropped;
 *                                               C reads "waiting" again
 *   4. approve D, the last                    → "who is next?" finds C, and
 *                                               the walk jumps back to a
 *                                               player already approved
 *
 * until a later page quietly puts it right. The database was never wrong; the
 * screen was believing a page older than its own last write. Measured before
 * this rule: 6 failures in 20 runs of the review walk.
 *
 * Asking WHEN each page was requested does not work — half of them are asked
 * for by the framework, where nobody can stamp them (that was tried first,
 * and the race was still lost 2 times in 10). So the rule is about what the
 * page SAYS:
 *
 *   · a write still in flight keeps its change, as before;
 *   · a change the page AGREES with is dropped: the server has caught up;
 *   · a change the page DISAGREES with is kept — the write was confirmed, so
 *     the page is more likely old than right — but only PATIENCE times. Past
 *     that, the server wins: somebody else really did change it since.
 */
export type Overrides<R> = Readonly<Record<string, Partial<R>>>;

/**
 * How many disagreeing pages a confirmed change outlasts. A write can have
 * three pages already on their way when it lands (two for the address, one
 * refresh); the page asked for AFTER it is the one that settles the matter.
 */
export const PATIENCE = 3;

export interface AfterPage<R> {
  kept: Record<string, Partial<R>>;
  /** Per row: how many pages have disagreed with its kept change so far. */
  doubts: Map<string, number>;
}

export function overridesAfterPage<R extends { id: string }>(
  current: Overrides<R>,
  inflight: ReadonlyMap<string, number>,
  doubts: ReadonlyMap<string, number>,
  page: readonly R[],
): AfterPage<R> {
  const after: AfterPage<R> = { kept: {}, doubts: new Map() };
  for (const [id, patch] of Object.entries(current)) {
    if (inflight.has(id)) {
      after.kept[id] = patch;
      continue;
    }
    const row = page.find((candidate) => candidate.id === id);
    if (row === undefined || agrees(row, patch)) {
      // Not on this page, or the page already says what the change says.
      continue;
    }
    const doubted = doubts.get(id) ?? 0;
    if (doubted < PATIENCE) {
      after.kept[id] = patch;
      after.doubts.set(id, doubted + 1);
    }
  }
  return after;
}

/** Does the row already hold every value the change set? */
function agrees<R>(row: R, patch: Partial<R>): boolean {
  for (const key of Object.keys(patch) as (keyof R)[]) {
    if (!same(row[key], patch[key])) {
      return false;
    }
  }
  return true;
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  // Rows are plain data off the wire: dates arrive as strings, and the few
  // nested values are small lists and records.
  return JSON.stringify(a) === JSON.stringify(b);
}
