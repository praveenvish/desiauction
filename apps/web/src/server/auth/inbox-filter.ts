/**
 * WHAT THE INBOX LEAVES TO THE SECURITY PAGE.
 *
 * Every sign-in writes two ledger rows (the code asked for, then the sign-in
 * itself) and every sign-out one more. On a real account they drowned the
 * notices the inbox exists for: 6 of a sold player's 8 rows and all 10 of an
 * owner's read "Signed in" or "Sign-in code requested", and "You were sold"
 * fell off the end of the list. These are the person's own routine actions —
 * nothing to be told about — so the inbox and its bell skip them.
 *
 * They are NOT hidden from the person: Account → Security activity reads the
 * ledger whole (`listSecurityEvents`). The ones that DO warrant attention stay
 * in the inbox — a lockout, a refused passkey, a revoked session, a changed
 * number, and the account's creation.
 *
 * Its own module (not security-events.ts) so a unit test can pin the list
 * without opening a database pool — and it imports nothing from there, not
 * even the `SecurityAction` type, because that would be an import cycle (the
 * architecture gate counts type-only ones). The test checks every entry IS a
 * `SecurityAction`, so a renamed action fails the build there.
 */
export const ACCOUNT_ONLY_ACTIONS = [
  "auth.login.otp",
  "auth.login.email",
  "auth.login.passkey",
  "auth.otp.requested",
  "auth.logout",
] as const;

/**
 * LEDGER ROWS THAT ARE NOT EVENTS AT ALL (2026-09-27).
 *
 * The photo-upload rate limiter (`server/media/presign-quota.ts`) counts its
 * quota by writing one audit row per upload, scoped to the uploader — the same
 * log and the same scope the inbox reads. With no label, every organizer who
 * uploaded photos was told `media.upload_requested` in raw monospace, once per
 * photo (up to 300 an hour on a bulk import), and the bell lit for each. These
 * are a counter, not news and not security activity: neither page shows them.
 */
export const LEDGER_ONLY_ACTIONS = [
  "media.upload_requested",
  "media.own_upload_requested",
] as const;

/** The actions an inbox read leaves out: the routine ones above, the quota
 *  ledger, plus whatever this person switched off for the app. */
export function inboxExclusions(hidden: readonly string[]): string[] {
  return [...new Set<string>([...ACCOUNT_ONLY_ACTIONS, ...LEDGER_ONLY_ACTIONS, ...hidden])];
}
