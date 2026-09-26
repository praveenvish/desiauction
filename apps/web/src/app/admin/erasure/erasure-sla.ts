/** The account page's promise: an erasure request is answered within 7 days. */
export const ERASURE_PROMISE_DAYS = 7;

const IST_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The India calendar date, as YYYY-MM-DD. The desk printed the UTC date, so a
 * request made at 01:10 on the 19th in India read "asked 2026-09-18" beside a
 * correct "Due today" on the 26th — and looked a day overdue.
 */
export function istDate(ms: number): string {
  return IST_DAY.format(ms);
}

/** Days since the epoch of the India calendar day `ms` falls on. */
function istDayNumber(ms: number): number {
  const [year, month, day] = IST_DAY.format(ms).split("-").map(Number);
  return Math.round(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / 86_400_000);
}

/**
 * Calendar days left on the promise: 0 on the due day, negative once it has
 * passed. Counted in India calendar days, not elapsed 24-hour periods — the
 * old `floor((now - asked) / 24h)` read "Due today" for a whole extra day, so
 * a request asked on the 18th still said "Due today" on the morning of the
 * 26th, a day after the promise had lapsed.
 */
export function erasureDaysLeft(requestedAtMs: number, nowMs: number): number {
  return istDayNumber(requestedAtMs) + ERASURE_PROMISE_DAYS - istDayNumber(nowMs);
}
