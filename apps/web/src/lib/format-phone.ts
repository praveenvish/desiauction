/**
 * Display formatting for the E.164 phones the product stores (+91XXXXXXXXXX).
 *
 * The storage shape is deliberately unpunctuated — it is an identifier, and
 * `normalizePhone` (packages/core) guarantees exactly one canonical spelling.
 * But an identifier is not a number a person recognises: the login placeholder
 * has always been grouped ("98765 43210") while every confirmation, header and
 * receipt line echoed the raw run of thirteen characters back. On the two
 * screens whose entire job is "is this YOUR number?" that difference decides
 * whether the answer is read or guessed.
 *
 * Grouping only, never mutation: anything that is not a +91 mobile is returned
 * untouched, so this can be dropped in front of any stored phone without the
 * caller having to know which shape it holds.
 */
export function formatPhone(phone: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return match === null ? phone : `+91 ${match[1] as string} ${match[2] as string}`;
}
