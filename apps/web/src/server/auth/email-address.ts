/**
 * Deliberately permissive, and that is the point: the code decides.
 *
 * An address that passes a strict regex is not more likely to be the person's
 * own, and every strict pattern rejects mail that works — plus addressing,
 * long TLDs, unicode domains. The only real test of an address is whether a
 * message sent to it comes back, so this rejects the shapes that cannot be an
 * address at all and lets the mailbox answer the rest.
 */
export function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < 3 || trimmed.length > 254 || /\s/.test(trimmed)) {
    return null;
  }
  const at = trimmed.indexOf("@");
  if (at <= 0 || at !== trimmed.lastIndexOf("@") || at === trimmed.length - 1) {
    return null;
  }
  const domain = trimmed.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
    return null;
  }
  return trimmed;
}
