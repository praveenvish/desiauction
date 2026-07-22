/**
 * Share attribution (Outcome Governance). Pure: normalizes an attacker-controlled
 * `?ref=` / `utm_source` value into a BOUNDED token before it is ever persisted.
 *
 * Security: the raw value comes off a public URL, so it must never reach the
 * audit-log jsonb unbounded — an allowlist caps cardinality and strips injection
 * payloads. Unknown-but-present sources collapse to `"other"`; absent to
 * `"direct"`. This is the one place a share source is trusted.
 */

/** The deliberate share flows we attribute (marketing sources + our own links). */
export const SHARE_SOURCES = [
  "whatsapp",
  "facebook",
  "instagram",
  "x",
  "telegram",
  "qr",
  "copy",
  "recruit",
  "player",
] as const;

export type ShareSource = (typeof SHARE_SOURCES)[number];

/** Sentinels that are valid outputs but not "deliberate" sources. */
export const ATTRIBUTION_DIRECT = "direct";
export const ATTRIBUTION_OTHER = "other";

const KNOWN = new Set<string>(SHARE_SOURCES);

const ALIAS: Record<string, string> = {
  twitter: "x",
  tweet: "x",
  fb: "facebook",
  wa: "whatsapp",
  ig: "instagram",
  tg: "telegram",
};

/**
 * Normalize a raw `?ref` value to a bounded attribution token. Never returns
 * unbounded input: `null`/empty → `"direct"`; recognized → the canonical source;
 * anything else present → `"other"`.
 */
export function normalizeShareSource(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) {
    return ATTRIBUTION_DIRECT;
  }
  const value = raw.trim().toLowerCase();
  if (value === "") {
    return ATTRIBUTION_DIRECT;
  }
  const canonical = ALIAS[value] ?? value;
  return KNOWN.has(canonical) ? canonical : ATTRIBUTION_OTHER;
}
