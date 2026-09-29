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
  // A URL that carries its own login: `postgres://user:password@host/db`. A
  // driver that fails to connect is fond of quoting the address it was given.
  // FIRST, so that the pattern for addresses below never sees `password@host`
  // — and by shape, not by host: `@db` and `@10.0.0.5` are not addresses, and
  // the looser address pattern only ever caught these by accident.
  { re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, label: "$1[credentials]@" },
  // E.164 India, the shape every phone in this product takes.
  { re: /\+91\d{10}/g, label: "[phone]" },
  // The last label must be LETTERS: `name@host.tld` is an address, and
  // `next@15.5.25` is a package in a stack trace. The looser pattern redacted
  // every frame of every stack (`.pnpm/@[email]/node_modules/…`), which
  // cost the path that says where an error came from and protected nobody.
  { re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}(?![\w-])/g, label: "[email]" },
  // Long opaque credentials: provider keys and bearer tokens.
  { re: /\b(?:sk|rzp)_[A-Za-z0-9_]{8,}/g, label: "[key]" },
  // A URL's sensitive query values. The SMS provider's API takes the one-time
  // code and the number IN THE QUERY STRING, and Sentry's fetch spans record
  // `url.full`/`url.query` — a live login code leaving the process. `ticket`
  // is the auction engine's WebSocket admission (engine-client.ts).
  {
    re: /([?&](?:otp|code|token|ticket|mobile|phone|email|secret|signature|sig|key|authkey)=)[^&#\s"']*/gi,
    label: "$1[redacted]",
  },
  // The same Indian mobile WITHOUT the plus, as providers write it (91XXXXXXXXXX).
  { re: /(?<![\d+])91[6-9]\d{9}(?!\d)/g, label: "[phone]" },
  // Capability links: the path segment IS the credential.
  { re: /\/(join|owner-join|demo|review)\/[^/?#\s"']+/g, label: "/$1/[token]" },
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

/**
 * An error, made safe for a LOG LINE — and still useful in one.
 *
 * Two things were wrong with how the services logged errors, and they pulled in
 * opposite directions (PRR 2026-09-29, reproduced against the engine's logger):
 *
 *  1. The web tier and the engine redacted by key path only, so a constraint
 *     violation wrote the person's number into the log in free text —
 *     `"detail":"Key (phone)=(+9198…) already exists."` — and from there to the
 *     log store, for thirty days.
 *  2. All three redact the key `code` (it is what a one-time code is called),
 *     and an error's `code` is the ONE field that says what went wrong: 23505,
 *     40P01, ECONNREFUSED. Every error line read `"code":"[redacted]"`.
 *
 * So: the whole serialized error goes through `scrub`, and the error's own code
 * is carried across under `errorCode` — but only when it has the shape of one
 * (a SQLSTATE or a Node/system error name), because `code` on an arbitrary
 * object could be anything, including the thing the redaction exists for.
 *
 * Takes the ALREADY SERIALIZED error (pino's `stdSerializers.err`), so this
 * package does not need to know what a logger is.
 */
const ERROR_CODE_SHAPE = /^(?:[0-9A-Z]{5}|E[A-Z0-9_]{2,40}|ERR_[A-Z0-9_]{2,60})$/;

export function scrubError(serialized: unknown): unknown {
  const scrubbed = scrub(serialized);
  if (
    serialized === null ||
    typeof serialized !== "object" ||
    scrubbed === null ||
    typeof scrubbed !== "object" ||
    Array.isArray(scrubbed)
  ) {
    return scrubbed;
  }
  const code = (serialized as { code?: unknown }).code;
  if (typeof code !== "string" || !ERROR_CODE_SHAPE.test(code)) {
    return scrubbed;
  }
  return { ...(scrubbed as Record<string, unknown>), errorCode: code };
}
