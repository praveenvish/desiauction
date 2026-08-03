/**
 * Deterministic date/time formatting for the India-facing product (docs 05:
 * "IST-implied"). Pinning both locale AND timeZone is what keeps server and
 * client output byte-identical — a bare `toLocaleDateString()` reads the host
 * locale/zone, which differs between the SSR render and the browser and throws
 * a React hydration mismatch. Use these anywhere a Date reaches the DOM.
 */
const LOCALE = "en-IN";
const TIME_ZONE = "Asia/Kolkata";

/** e.g. "19 Jul 2026" */
export function formatDate(value: Date | string | number): string {
  return new Date(value).toLocaleDateString(LOCALE, {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** e.g. "6:30 pm" — time only, for same-day event timelines. */
export function formatTime(value: Date | string | number): string {
  return new Date(value).toLocaleTimeString(LOCALE, {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
}

/** e.g. "19 Jul 2026, 6:30 pm" */
export function formatDateTime(value: Date | string | number): string {
  return new Date(value).toLocaleString(LOCALE, {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// --- Wall-clock kickoffs -------------------------------------------------------
//
// A fixture kickoff is a LOCAL WALL-CLOCK string ("2026-08-02T18:00", see
// packages/core/src/fixture.ts) — a tournament's own time, carrying no zone at
// all. Feeding one to `new Date()` makes the runtime guess a zone (the host's),
// and the helpers above would then convert that guess into IST: 18:00 becomes
// 23:30 on a UTC host. So these read the digits and format them directly. No
// Date parsing, no zone, no drift — the string means what it says.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function clockOf(parts: WallParts): string {
  const suffix = parts.hour < 12 ? "am" : "pm";
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${String(hour12)}:${String(parts.minute).padStart(2, "0")} ${suffix}`;
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
