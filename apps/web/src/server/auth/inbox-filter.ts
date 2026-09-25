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

/** The actions an inbox read leaves out: the routine ones above, plus whatever
 *  this person switched off for the app. */
export function inboxExclusions(hidden: readonly string[]): string[] {
  return [...new Set<string>([...ACCOUNT_ONLY_ACTIONS, ...hidden])];
}
