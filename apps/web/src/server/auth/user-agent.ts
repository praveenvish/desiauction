/**
 * "Chrome on macOS", not the first 48 characters of a UA string.
 *
 * The sessions list used to print `session.userAgent?.slice(0, 48)`. On a real
 * account that produced 142 rows reading
 * `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Ap` — 142 times, character
 * for character — beside 141 Revoke buttons. The screen's whole job is "is one
 * of these not you?", and it answered with the one field that is identical for
 * every session a person will ever create on the same laptop.
 *
 * This is DELIBERATELY a small, ordered table of substring tests rather than a
 * UA-parsing dependency. It is display text on one panel; being wrong about an
 * obscure browser costs a slightly vaguer label, and the raw string is still
 * carried through as the row's title so support can recover the truth. Order
 * matters: Edge and Opera both claim to be Chrome, Chrome claims to be Safari,
 * and every one of them claims to be Mozilla.
 */

const BROWSERS: readonly (readonly [needle: string, label: string])[] = [
  ["Edg/", "Edge"],
  ["EdgiOS", "Edge"],
  ["OPR/", "Opera"],
  ["SamsungBrowser", "Samsung Internet"],
  ["CriOS", "Chrome"],
  ["FxiOS", "Firefox"],
  ["Firefox/", "Firefox"],
  ["Chrome/", "Chrome"],
  ["Safari/", "Safari"],
];

const PLATFORMS: readonly (readonly [needle: string, label: string])[] = [
  ["iPhone", "iPhone"],
  ["iPad", "iPad"],
  ["Android", "Android"],
  ["Windows NT", "Windows"],
  ["Mac OS X", "macOS"],
  ["Macintosh", "macOS"],
  ["CrOS", "ChromeOS"],
  ["Linux", "Linux"],
];

function match(userAgent: string, table: readonly (readonly [string, string])[]): string | null {
  for (const [needle, label] of table) {
    if (userAgent.includes(needle)) {
      return label;
    }
  }
  return null;
}

/**
 * A short human label for a stored user agent, or null when there is nothing
 * honest to say. Null is a real answer: "Unknown device" is more useful than a
 * confident guess, and the caller renders it.
 */
export function describeUserAgent(userAgent: string | null): string | null {
  if (userAgent === null || userAgent.trim() === "") {
    return null;
  }
  const browser = match(userAgent, BROWSERS);
  const platform = match(userAgent, PLATFORMS);
  if (browser !== null && platform !== null) {
    return `${browser} on ${platform}`;
  }
  return browser ?? platform;
}
