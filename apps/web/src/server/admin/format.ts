/**
 * PX-9 shared formatting. PURE — no db, no IO, no React. It sits under
 * `server/admin` because both the projections (which put numbers into attention
 * subjects) and the panels (which render them) need the same spelling, and a
 * number that reads "1558" in one place and "1,558" in another is a number the
 * operator has to re-read.
 */

const GROUPED = new Intl.NumberFormat("en-IN");

/** `1558` → `1,558`. The platform counts in thousands; ungrouped digits do not. */
export function formatCount(value: number): string {
  return GROUPED.format(value);
}

/**
 * Counted nouns live in `lib/plural` — the readiness gates need the same
 * speller, and they must not import out of `server/admin`. Re-exported here so
 * this module stays the one place admin code looks for formatting.
 */
export { countNoun } from "../../lib/plural";

/**
 * A waiting time in words. Deliberately coarse: an operator needs "is this
 * stuck?", and "11 days" answers that where "1,558" never did.
 */
export function waitedFor(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) {
    return "under a minute";
  }
  if (minutes < 60) {
    return `${String(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? "1 hour" : `${String(hours)} hours`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${String(days)} days`;
}

/**
 * The zero ULID every machine-derived audit row is signed with — the same
 * sentinel `settlement/writer.ts` writes as SYSTEM_ACTOR.
 */
const SYSTEM_ACTOR = "00000000000000000000000000";

/**
 * Who did it, for a screen.
 *
 * Both admin feeds rendered `actorName ?? actor.slice(-6)`, and a lot the timer
 * closed or a sweep the coordinator ran has no person behind it — so the
 * Overview read "auction.LotSold by 000000" and the audit trail linked those
 * zeros to a /admin/users page that deliberately 404s. The platform IS the
 * actor there, and saying so is both shorter and true.
 */
export function actorLabel(actor: string, actorName: string | null): string {
  if (actorName !== null && actorName !== "") {
    return actorName;
  }
  return actor === SYSTEM_ACTOR ? "the platform" : actor.slice(-6);
}

/** True when the row was written by the platform itself, not by a person. */
export function isSystemActor(actor: string): boolean {
  return actor === SYSTEM_ACTOR;
}

/**
 * The stored E.164 number, grouped and TRUNCATED for a directory.
 *
 * A bulk list is a bulk export: `/admin/users` put 50 people's full mobile
 * numbers on one screen, and `?q=` made the other 1,098 a page away. The
 * directory's job is "which row is this?", which the last four digits answer;
 * the whole number belongs on the one person's page an operator deliberately
 * opened. Anything that is not a +91 mobile is masked wholesale rather than
 * guessed at.
 */
export function maskPhone(phone: string): string {
  const match = /^\+91(\d{6})(\d{4})$/.exec(phone);
  return match === null ? "•••• ••••" : `+91 •••••• ${match[2] as string}`;
}

/**
 * A suppressed contact, masked. Either a phone number or an email address —
 * the suppression list is keyed by the CONTACT and holds both.
 *
 * The domain survives on an email because it is the operationally useful part:
 * a run of bounces all landing on one domain is the shape of a blocklisting,
 * and masking it away would hide the only pattern worth spotting. The local
 * part is the person, and goes.
 */
export function maskContact(contact: string): string {
  const at = contact.indexOf("@");
  if (at <= 0) {
    return maskPhone(contact);
  }
  const local = contact.slice(0, at);
  return `${local.slice(0, 1)}•••${contact.slice(at)}`;
}

/**
 * Lifecycle states, in words.
 *
 * Capability SETS are rendered verbatim on purpose — `org:owner` and
 * `settlement:controller` are the only honest description of what someone
 * holds, and prettifying them would erase the partition the platform is built
 * on. That argument does not extend to `REGISTRATION_CLOSED`: a lifecycle state
 * is a fact about a season, not a name an operator must type back, and the
 * screaming enum token is just an un-translated database value.
 */
const LIFECYCLE_LABELS: Record<string, string> = {
  // Competition (IP-3)
  draft: "Draft",
  setup: "Setup",
  registration_open: "Registration open",
  registration_closed: "Registration closed",
  // Auction (IP-4)
  scheduled: "Scheduled",
  live: "Live",
  paused: "Paused",
  completed: "Completed",
  reconciled: "Reconciled",
  abandoned: "Abandoned",
  // Settlement (IP-5)
  opened: "Opened",
  verified: "Verified",
  discrepant: "Discrepant",
  settling: "Settling",
  settled: "Settled",
  closed: "Closed",
  voided: "Voided",
  // Visibility (IP-3)
  public: "Public",
  private: "Private",
  unlisted: "Unlisted",
};

/** An unknown state is shown verbatim rather than guessed at or hidden. */
export function lifecycleLabel(status: string): string {
  return LIFECYCLE_LABELS[status] ?? status;
}
