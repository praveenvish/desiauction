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
    // Same-origin already, but "/./x" and "/../x" are dot segments the browser
    // resolves before we ever see the result — so the destination the user
    // reaches is not the string that was checked. Everything here stays on this
    // origin either way; this keeps the value we approved and the value that is
    // navigated to the SAME string, which is the property the allowlist is
    // supposed to guarantee (audit 2026-08-18, P3-8).
    if (value.split("/").some((segment) => segment === "." || segment === "..")) {
      return "/home";
    }
    return value;
  }
  return "/home";
}
