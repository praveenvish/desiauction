/**
 * PX-11 SECURITY FIX (finding F1 — open redirect).
 *
 * Lives in its own module (not the `"use server"` actions file, which may only
 * export async server actions) so it is importable by the redirect-safety suite.
 *
 * The `next` param is attacker-controlled — it rides on the login URL — and the
 * original guard (`startsWith("/") && !startsWith("//")`) admitted `/\evil.com`:
 * a browser folds the backslash to a slash, making it a protocol-relative
 * `//evil.com` redirect to an external phishing origin. It also admitted
 * whitespace/control characters that some agents strip into a bypass.
 *
 * Every legitimate `next` in this app is a simple local path (`/home`,
 * `/seasons/{slug}/register`, `/join/{ulid}`), so this uses a conservative
 * ALLOWLIST — a single leading slash NOT followed by another slash or backslash,
 * then only characters that appear in the app's own paths and query strings.
 * Anything else falls back to `/home`.
 */
export function safeNext(value: string | undefined): string {
  if (value === undefined) {
    return "/home";
  }
  if (/^\/(?![/\\])[A-Za-z0-9\-._~/?#[\]@!$&'()*+,;=%]*$/.test(value)) {
    return value;
  }
  return "/home";
}
