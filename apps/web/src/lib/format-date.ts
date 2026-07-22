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
