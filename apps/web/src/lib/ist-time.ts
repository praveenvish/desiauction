/**
 * A `datetime-local` value, read as India time, and back.
 *
 * The browser's <input type="datetime-local"> gives "2026-10-04T20:00" with no
 * zone, and the reader's own clock is not ours to trust: an organizer abroad,
 * or a laptop left on UTC, would move auction night by five and a half hours.
 * Every club on the product is in India, so the field IS India time, always —
 * the label says "IST" and these two functions hold it to that.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "2026-10-04T20:00" (IST) → the moment; null for anything malformed or impossible. */
export function parseIstLocal(value: string): Date | null {
  const match = LOCAL.exec(value.trim());
  if (match === null) {
    return null;
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const utc = Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MS;
  const moment = new Date(utc);
  // 31 Feb rolls over in Date.UTC; refuse it rather than move the auction.
  return toIstLocal(moment) === value.trim() ? moment : null;
}

/** The moment → "2026-10-04T20:00" in IST, for the input's value. */
export function toIstLocal(moment: Date): string {
  return new Date(moment.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16);
}
