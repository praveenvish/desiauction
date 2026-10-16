/**
 * NUMBERS NOBODY OWNS — or rather, numbers somebody else does.
 *
 * Pure: no IO, no storage, no ambient time.
 *
 * A club's master sheet fills the gaps with made-up numbers so every row has
 * one: 9000000001, 9000000002, … (BPL4: 106 of 156 rows). Each of those passes
 * `normalizePhone` — it is a perfectly shaped Indian mobile — and a phone here
 * is an IDENTITY, not a contact detail: the import would have created a
 * platform-wide person for every one of them. Whoever really owns 9000000001
 * signs in with a code and becomes that player; another club using the same
 * filler joins two strangers into one person; the SMS outbox texts a stranger
 * "you've been sold".
 *
 * So a placeholder is never stored anywhere. The import reads it as "no phone"
 * and SAYS so, by name, before anything is written — and the organizer can
 * vouch for any number this flagged that is in fact real.
 */

/** The ten national digits of an E.164 Indian mobile, or the input unchanged. */
function nationalDigits(phone: string): string {
  return phone.startsWith("+91") ? phone.slice(3) : phone;
}

/*
 * The run length that marks a filler. A real allocation with six identical
 * digits in a row exists, but it is rare enough that asking is cheap — and
 * the organizer is always asked, never overruled.
 */
const REPEATED_RUN = /(\d)\1{5}/;

/** The keyboard-walk numbers people type when a form will not take a blank. */
const WALKS = new Set(["9876543210", "9123456789", "8765432109", "7654321098", "6789012345"]);

/** A number that reads as typed-to-fill-a-cell rather than as anyone's phone. */
export function looksLikePlaceholderPhone(phone: string): boolean {
  const digits = nationalDigits(phone);
  return REPEATED_RUN.test(digits) || WALKS.has(digits);
}
