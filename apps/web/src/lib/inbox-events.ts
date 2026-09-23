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
import type { SecurityAction } from "../server/auth/security-events";

/**
 * EVERY EVENT THE LEDGER CAN WRITE HAS PROSE — checked by the compiler.
 *
 * This was a plain `Record<string, string>`, so an event could be added to the
 * `SecurityAction` union, written on every account, and render as a raw key in
 * monospace with nothing failing. Five had: a sign-out, a refused passkey, a
 * changed phone number, a verified email and an updated player profile all read
 * as database identifiers on /inbox and /account. `satisfies` below makes a
 * missing label a type error at the point the event is invented.
 */
const PERSON_EVENT_LABELS = {
  "auth.login.otp": "Signed in with a one-time code",
  "auth.login.email": "Signed in with a code sent to your email",
  // The FIRST line of an email-anchored account's ledger. Deliberately not
  // folded into the sign-in label above: "where did this account come from?" is
  // the question a security page is asked after something goes wrong, and a run
  // of identical sign-in lines never answers it.
  "auth.signup.email": "Account created with a code sent to your email",
  // Written on EVERY sign-in, so it was the single most common raw key a new
  // account ever saw — half of a fresh inbox read `auth.otp.requested` in
  // monospace before the person had done anything but log in twice.
  "auth.otp.requested": "Sign-in code requested",
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
  // The sentence a player waits all night for. The team and the price live in
  // the row's meta; the label stays short because the inbox is a list.
  "auction.sold": "You were sold at auction",
  // Deliberately not "you went unsold". The fact is the same and the reader is
  // a person who put their name in and waited — and by the time this is written
  // the requeue rounds are spent, so it is final rather than a running score.
  "auction.unsold": "The auction finished without a bid for you",
  // Captain, vice-captain, icon or retained — the role and team are in meta.
  "team.appointed": "Your team named you to a role",
  "team.squad_sheet": "Your squad is set",
  "fixture.lineup_announced": "You're in the lineup",
  "profile.name.updated": "Name updated",
  // The first name is not an update — see `profile.name.set`.
  "profile.name.set": "Name added to your profile",
  "auth.logout": "Signed out",
  "auth.passkey.failed": "A passkey sign-in was refused",
  "auth.phone.changed": "Your mobile number was changed",
  "profile.email.verified": "Email address verified",
  "profile.player.updated": "Player profile updated",
  "privacy.erasure.requested": "You asked for your account to be deleted",
  "privacy.erasure.withdrawn": "You withdrew your account deletion request",
} satisfies Record<SecurityAction, string>;

/**
 * Written by other domains onto the same person-scoped ledger (finance), so they
 * are not in the auth union above but still deserve a sentence.
 */
const LABELS: Record<string, string> = {
  ...PERSON_EVENT_LABELS,
  // The first finance event a PAYER ever receives. Until the in-app adapter
  // actually wrote a person-scoped row, a receipt was visible to the club's
  // finance desk and to nobody else — the inbox had no finance writer at all.
  "finance.document.issued": "A receipt was issued to your team",
};

/**
 * Prose for an action key. Unknown keys fall back to the key itself: an event
 * this build has never heard of is still evidence, and hiding it would be worse
 * than showing it in its raw form.
 */
export function labelForEvent(action: string): string {
  return LABELS[action] ?? action;
}

/** Every action key with prose — the notification guard checks the catalogue against it. */
export const KNOWN_EVENT_ACTIONS: readonly string[] = Object.keys(LABELS);

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

/*
 * WHAT A NOTICE SAYS BEYOND ITS HEADLINE.
 *
 * An ALLOWLIST, never a dump of `meta`. The person-scoped ledger carries
 * security rows too, whose meta holds request-shaped facts (addresses, agents)
 * that belong in an audit trail and not on a page; rendering the column
 * wholesale would put them there the first time a new event type was added.
 * Only these two keys are ever shown, in this order, and only as plain text.
 */
const DETAIL_KEYS = ["team", "price"] as const;

export function detailOf(meta: unknown): string | null {
  if (typeof meta !== "object" || meta === null) {
    return null;
  }
  const parts: string[] = [];
  for (const key of DETAIL_KEYS) {
    if (!(key in meta)) {
      continue;
    }
    const value: unknown = (meta as Record<string, unknown>)[key];
    if (typeof value === "string" && value !== "") {
      parts.push(value);
    }
  }
  return parts.length === 0 ? null : parts.join(" · ");
}
