/**
 * Redaction for anything leaving the process to a third party.
 *
 * The pino loggers redact by KEY PATH, which is right for structured fields and
 * useless for the other half of the problem: an error *message*. `PostgresError:
 * duplicate key ... Key (phone)=(+919999000001) already exists` carries a phone
 * number in free text, and a Sentry event carries that message verbatim. So the
 * three services had PII-safe logs and an unredacted error tracker
 * (audit PA-1 §20) — the moment a DSN is set, that becomes a real disclosure to
 * a third party under DPDP.
 *
 * Pure and here rather than in each app, so all three redact identically: the
 * one thing worse than no scrub is two services disagreeing about what is
 * sensitive.
 */

/** Field names whose VALUE is sensitive wherever it appears. */
const SENSITIVE_KEYS = new Set([
  "phone",
  "email",
  "code",
  "otp",
  "token",
  "secret",
  "password",
  "apikey",
  "authorization",
  "cookie",
  "signature",
  "gstin",
]);

export const REDACTED = "[redacted]";

/**
 * Patterns that are sensitive by SHAPE, for the free text a key cannot cover.
 *
 * Deliberately narrow. A greedy pattern that ate every long digit string would
 * redact lot numbers, paise amounts and ULIDs, and an error report with the
 * money removed is not much of an error report.
 */
const PATTERNS: readonly { readonly re: RegExp; readonly label: string }[] = [
  // E.164 India, the shape every phone in this product takes.
  { re: /\+91\d{10}/g, label: "[phone]" },
  { re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, label: "[email]" },
  // Long opaque credentials: provider keys and bearer tokens.
  { re: /\b(?:sk|rzp)_[A-Za-z0-9_]{8,}/g, label: "[key]" },
];

/** Redact sensitive shapes inside free text. */
export function scrubText(value: string): string {
  let out = value;
  for (const { re, label } of PATTERNS) {
    out = out.replace(re, label);
  }
  return out;
}

/**
 * Deep-redact a value: sensitive keys by name, sensitive shapes in any string.
 *
 * Cycles are tracked because an error object graph can contain them, and a
 * scrub that throws on the way to the error tracker loses the report entirely.
 * Depth is bounded for the same reason.
 */
export function scrub(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return scrubText(value);
  }
  if (value === null || typeof value !== "object" || depth > 8) {
    return value;
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => scrub(item, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : scrub(item, depth + 1, seen);
  }
  return out;
}
