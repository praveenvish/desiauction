import { createHash } from "node:crypto";

/** Crockford base32 — the alphabet every `newId()` ULID in this product is written in. */
const CROCKFORD32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A 26-character id derived from a string instead of from the clock.
 *
 * Every `*.id` and `*_events.stream_id` in this product is `char(26)` — the
 * ULID shape — so an id that is not exactly that wide is rejected by the insert
 * (and, when it is merely too SHORT somewhere else, silently padded and then
 * never matched again). The first 34 hex digits of the digest are 136 bits,
 * comfortably more than the 130 bits twenty-six base32 characters carry, so no
 * character is short of entropy.
 *
 * WHY THIS EXISTS AT ALL, which is the part worth carrying between call sites:
 * the event writers look a repeat up as `findByCommandId(streamType, streamId,
 * commandId)`. The stream is part of the key. So a stable command id beside a
 * freshly MINTED stream id dedupes nothing — the retry searches an empty
 * stream, finds no duplicate, and does the work twice. Whenever a command
 * creates the very stream it would be deduped on, both halves have to come out
 * of one fingerprint, or the two can disagree about what "the same intent"
 * means.
 *
 * Lifted out of `settlement/actions.ts` (where the payment-intent anchor first
 * needed it) so the finops dispatch retry could not solve the same problem
 * slightly differently — audit PA-1 §16 found that retry minting both halves
 * fresh, so a second click sent a second copy of the document.
 */
export function derivedId(fingerprint: string): string {
  let value = BigInt(`0x${createHash("sha256").update(fingerprint).digest("hex").slice(0, 34)}`);
  let out = "";
  for (let i = 0; i < 26; i += 1) {
    out = `${CROCKFORD32[Number(value % 32n)] ?? "0"}${out}`;
    value /= 32n;
  }
  return out;
}
