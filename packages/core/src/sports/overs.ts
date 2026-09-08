/**
 * OVERS ARE BALLS, and this is the one place that knows the difference.
 *
 * Extracted from `cricket.ts` so the tiebreaker library can format a ball count
 * without importing a pack — a pack imports the library, so the library
 * importing a pack back would close a cycle the `no-circular` gate refuses, and
 * rightly.
 */

/** Balls → the "4.5" cricket writes. Display only; never arithmetic. */
export function oversOf(balls: number): string {
  return `${String(Math.floor(balls / 6))}.${String(balls % 6)}`;
}

/** "4.5" → 29 balls. Returns null for anything that is not a legal over count. */
export function ballsOf(overs: string): number | null {
  const match = /^(\d{1,3})(?:\.([0-5]))?$/.exec(overs.trim());
  if (match === null) {
    return null;
  }
  // `.6` is rejected by the pattern above rather than folded to the next over:
  // somebody typing 4.6 has made a mistake, and silently reading it as 5.0
  // hides it inside a number nobody re-checks.
  return Number(match[1]) * 6 + Number(match[2] ?? 0);
}
