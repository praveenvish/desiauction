/**
 * One prose name per person-scoped event, shared by every surface that shows
 * them.
 *
 * /inbox humanised these rows; /account printed the raw database action key in
 * monospace — `profile.name.updated`, `auth.login.otp` — from the SAME query,
 * on the same account, 150px apart in the navigation. The map lived inside the
 * inbox's client component, so the security panel could not reach it. It lives
 * here now and both read it.
 */
const LABELS: Record<string, string> = {
  "auth.login.otp": "Signed in with a one-time code",
  // DA-19: the events a PLAYER cares about, not just the ones about their login.
  "registration.approved": "Your registration was approved — you're in the player pool",
  "registration.rejected": "Your registration wasn't approved this time",
  "registration.waitlisted": "You've been added to the waitlist",
  "auth.login.passkey": "Signed in with a passkey",
  "auth.otp.lockout": "Too many wrong codes — sign-in was locked briefly",
  "auth.passkey.enrolled": "Passkey added",
  "auth.passkey.renamed": "Passkey renamed",
  "auth.passkey.removed": "Passkey removed",
  "auth.session.revoked": "A device was signed out",
  // The first finance event a PAYER ever receives. Until the in-app adapter
  // actually wrote a person-scoped row, a receipt was visible to the club's
  // finance desk and to nobody else — the inbox had no finance writer at all.
  "finance.document.issued": "A receipt was issued to your team",
  "profile.name.updated": "Name updated",
  // The first name is not an update — see `profile.name.set`.
  "profile.name.set": "Name added to your profile",
};

/**
 * Prose for an action key. Unknown keys fall back to the key itself: an event
 * this build has never heard of is still evidence, and hiding it would be worse
 * than showing it in its raw form.
 */
export function labelForEvent(action: string): string {
  return LABELS[action] ?? action;
}

/** True when we have real prose — the caller can then drop the monospace. */
export function isKnownEvent(action: string): boolean {
  return LABELS[action] !== undefined;
}

/**
 * The device's "I have read up to here" watermark, PER ACCOUNT.
 *
 * It used to be one origin-global key, `da:inbox-seen-at`, written by the inbox
 * and read by the shell's bell, and sign-out cleared only the session cookie.
 * On a shared handset — which this phone-first product explicitly targets —
 * person A reading their inbox marked person B's genuinely-unread registration
 * approval as already read, dot and all. Reproduced: with the watermark pushed
 * forward, all ten rows rendered `unread=false` and the bell reported nothing.
 *
 * Namespacing by personId is the fix that cannot be undone by a missed
 * clear-on-logout: two accounts simply cannot address the same key.
 */
export function inboxSeenKey(personId: string): string {
  return `da:inbox-seen-at:${personId}`;
}

/** The legacy shared key. Read nowhere; swept on sign-out so it cannot linger. */
const LEGACY_INBOX_SEEN_KEY = "da:inbox-seen-at";

/**
 * Forget every inbox watermark this device holds. Called on sign-out, so the
 * next person to use the handset starts from "nothing read" rather than
 * inheriting a stranger's reading position.
 */
export function clearInboxWatermarks(): void {
  if (typeof window === "undefined") {
    return;
  }
  const doomed: string[] = [LEGACY_INBOX_SEEN_KEY];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key !== null && key.startsWith("da:inbox-seen-at")) {
      doomed.push(key);
    }
  }
  for (const key of doomed) {
    window.localStorage.removeItem(key);
  }
}
