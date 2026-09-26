/**
 * `1 job` / `3 jobs` — one speller for counted nouns.
 *
 * Two surfaces were writing "(s)" at the reader: the admin attention queue
 * ("1 auction(s) still live") and the auction readiness gates ("10 player(s)
 * in the auction pool"). Both are operator-facing sentences, and neither is a
 * place to make a person decode a parenthesis.
 *
 * Counts are grouped the way the rest of the product groups them — the
 * platform counts in thousands, and ungrouped digits do not.
 */
const GROUPED = new Intl.NumberFormat("en-IN");

/**
 * `174500` → `1,74,500`: the product's one count format (round 3B). Every
 * figure that is not money — players, lots, events, sends — goes through here;
 * money goes through `lib/money` (its season's unit) or `lib/inr` (fees).
 */
export function formatCount(value: number): string {
  return GROUPED.format(value);
}

export function countNoun(value: number, noun: string, pluralNoun?: string): string {
  return `${GROUPED.format(value)} ${value === 1 ? noun : (pluralNoun ?? `${noun}s`)}`;
}
