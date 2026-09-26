/**
 * THE ONE DATE GRAMMAR (round 3B). Every date that reaches the DOM goes
 * through here, in one of these shapes:
 *
 *   formatDate        "1 Aug 2026"            a day
 *   formatShortDate   "1 Aug"                 a day this year, where the year is obvious
 *   formatDateRange   "1 Aug – 31 Oct 2026"   a span (the year once, when shared)
 *   formatTime        "6:30 pm"
 *   formatDateTime    "1 Aug 2026, 6:30 pm"
 *   relativeAge       "3d ago" / "in 2h"      ages, FLOORED (a request 7 days
 *                                             and 14 hours old is "7d ago")
 *
 * Deterministic for the India-facing product (docs 05: "IST-implied"): both
 * the zone and the month names are pinned. A bare `toLocaleDateString()`
 * reads the host locale/zone, which differs between the SSR render and the
 * browser and throws a hydration mismatch; and ICU's en-IN spells September
 * "Sept" while every other month is three letters, so a range straddling it
 * read "1 Aug – 15 Sept 2026" — two styles in one string.
 */
const TIME_ZONE = "Asia/Kolkata";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const IST_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** A calendar date ("2026-08-01") is a day, not an instant: read its digits. */
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function partsOf(value: Date | string | number): Parts {
  if (typeof value === "string") {
    const match = CALENDAR_DATE.exec(value);
    if (match !== null) {
      return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        hour: 0,
        minute: 0,
      };
    }
  }
  const out: Parts = { year: 1970, month: 1, day: 1, hour: 0, minute: 0 };
  for (const part of IST_PARTS.formatToParts(new Date(value))) {
    if (part.type in out) out[part.type as keyof Parts] = Number(part.value);
  }
  return out;
}

function clockOf(parts: Pick<Parts, "hour" | "minute">): string {
  const suffix = parts.hour < 12 ? "am" : "pm";
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${String(hour12)}:${String(parts.minute).padStart(2, "0")} ${suffix}`;
}

const month = (parts: Parts): string => MONTHS[parts.month - 1] ?? "";

/** e.g. "19 Jul 2026" */
export function formatDate(value: Date | string | number): string {
  const parts = partsOf(value);
  return `${String(parts.day)} ${month(parts)} ${String(parts.year)}`;
}

/** e.g. "19 Jul" — only where the year goes without saying. */
export function formatShortDate(value: Date | string | number): string {
  const parts = partsOf(value);
  return `${String(parts.day)} ${month(parts)}`;
}

/**
 * e.g. "Sun, 19 Jul" — a day in a schedule or a feed, where the weekday is
 * the point. `withYear` adds it ("Sun, 19 Jul 2026") for a day in another year.
 */
export function formatDayDate(value: Date | string | number, withYear = false): string {
  const parts = partsOf(value);
  const weekday = WEEKDAYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()];
  const tail = withYear ? ` ${String(parts.year)}` : "";
  return `${weekday ?? ""}, ${String(parts.day)} ${month(parts)}${tail}`;
}

/** e.g. "Jul 2026" — a join date, a review's month. */
export function formatMonthYear(value: Date | string | number): string {
  const parts = partsOf(value);
  return `${month(parts)} ${String(parts.year)}`;
}

/** The India calendar day as "YYYY-MM-DD" (today, by default). */
export function istCalendarDate(value: Date | string | number = new Date()): string {
  const parts = partsOf(value);
  return `${String(parts.year)}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** A calendar tile: { day: "4", month: "Oct" }. */
export function dateTile(value: Date | string | number): { day: string; month: string } {
  const parts = partsOf(value);
  return { day: String(parts.day), month: month(parts) };
}

/** e.g. "6:30 pm" — time only, for same-day event timelines. */
export function formatTime(value: Date | string | number): string {
  return clockOf(partsOf(value));
}

/** e.g. "19 Jul 2026, 6:30 pm" */
export function formatDateTime(value: Date | string | number): string {
  const parts = partsOf(value);
  return `${formatDate(value)}, ${clockOf(parts)}`;
}

/**
 * e.g. "1 Aug – 31 Oct 2026"; "15 Dec 2026 – 10 Jan 2027" across a year;
 * one date when only one end is known; "Dates to be announced" with neither.
 */
export function formatDateRange(
  start: Date | string | number | null,
  end: Date | string | number | null,
): string {
  if (start === null && end === null) {
    return "Dates to be announced";
  }
  if (start !== null && end !== null) {
    const a = partsOf(start);
    const b = partsOf(end);
    if (a.year === b.year && a.month === b.month && a.day === b.day) {
      return formatDate(start);
    }
    const left = a.year === b.year ? formatShortDate(start) : formatDate(start);
    return `${left} – ${formatDate(end)}`;
  }
  return formatDate((start ?? end) as Date | string | number);
}

/**
 * "3d ago" / "in 7mo". Past ages are FLOORED (a countdown is rounded), like the calendar a reader counts
 * on: a request asked 7 days and 14 hours ago is "7d ago". Rounding printed
 * "8d ago" on /admin beside the erasure desk's own date, which is 7 days back.
 * Past a month it is the date itself.
 */
export function relativeAge(atMs: number, nowMs: number): string {
  const seconds = Math.round((nowMs - atMs) / 1000);
  // Future instants used to fall into the `< 60` branch below and print
  // "just now" — the Health page's "Next due 01 Apr 2027 · just now" beside a
  // NOT RUNNING runner read as "should be firing right now". Say "in 7mo".
  if (seconds < -30) {
    const ahead = -seconds;
    if (ahead < 3600) {
      return `in ${String(Math.max(1, Math.round(ahead / 60)))}m`;
    }
    if (ahead < 86400) {
      return `in ${String(Math.round(ahead / 3600))}h`;
    }
    const days = Math.round(ahead / 86400);
    return days < 60 ? `in ${String(days)}d` : `in ${String(Math.round(days / 30))}mo`;
  }
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${String(days)}d ago`;
  }
  return formatDate(atMs);
}

// --- Wall-clock kickoffs -------------------------------------------------------
//
// A fixture kickoff is a LOCAL WALL-CLOCK string ("2026-08-02T18:00", see
// packages/core/src/fixture.ts) — a tournament's own time, carrying no zone at
// all. Feeding one to `new Date()` makes the runtime guess a zone (the host's),
// and the helpers above would then convert that guess into IST: 18:00 becomes
// 23:30 on a UTC host. So these read the digits and format them directly. No
// Date parsing, no zone, no drift — the string means what it says.

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function wallParts(wall: string): WallParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(wall);
  if (match === null) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? "0"),
    minute: Number(match[5] ?? "0"),
  };
}

/** e.g. "Sun, 2 Aug 2026" — the weekday is the point; a bare date never names one. */
export function formatWallDate(wall: string): string {
  const parts = wallParts(wall);
  if (parts === null) {
    return wall;
  }
  const weekday = WEEKDAYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()];
  return `${weekday ?? ""}, ${String(parts.day)} ${MONTHS[parts.month - 1] ?? ""} ${String(parts.year)}`;
}

/** e.g. "6:00 pm" */
export function formatWallTime(wall: string): string {
  const parts = wallParts(wall);
  return parts === null ? wall : clockOf(parts);
}

/** e.g. "Sun, 2 Aug 2026, 6:00 pm" */
export function formatKickoff(wall: string): string {
  const parts = wallParts(wall);
  return parts === null ? wall : `${formatWallDate(wall)}, ${clockOf(parts)}`;
}
