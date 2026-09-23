import { mayPublishPhoto } from "@desiauction/core";
import { people, registrations } from "@desiauction/db";
import { sql } from "drizzle-orm";

/**
 * WHAT A SEASON CALLS A REGISTERED PLAYER (0075).
 *
 * When an organizer added this player by phone to an account that already
 * existed, the season shows the name THEY typed, never the account's own —
 * otherwise a club could import phone numbers and read back who they belong
 * to. Every season-facing reader of a registration's name uses this, not
 * `people.name`. A person's OWN views (their career, their account) and the
 * platform desks keep reading `people.name`.
 */
export const shownName = sql<string | null>`coalesce(${registrations.enteredName}, ${people.name})`;

/**
 * The photo a season shows for a registration.
 *
 * The ENTRY's photo wins whenever there is one (0077): anything the club
 * attached is stored on the registration, never on the account, because a
 * club may not rewrite a person's platform-wide picture (P2 — only the person
 * writes `people.photo_url`). Without an entry photo, the account's own photo
 * shows — unless the season only knows this player by a typed name: a face
 * would unmask exactly what the typed name protects.
 */
export const shownPhotoKey = sql<
  string | null
>`case when ${registrations.enteredPhotoKey} is not null then ${registrations.enteredPhotoKey} when ${registrations.enteredName} is null then ${people.photoUrl} else null end`;

/**
 * The consent that makes `shownPhotoKey` renderable (DPDP §5) — read from the
 * same place the photo came from, by the same branches in the same order.
 * Always select the two together.
 */
export const shownPhotoConsentAt = sql<Date | null>`case when ${registrations.enteredPhotoKey} is not null then ${registrations.enteredPhotoConsentAt} when ${registrations.enteredName} is null then ${people.photoConsentAt} else null end`;

/** The two columns `shownPhotoKey` / `shownPhotoConsentAt` select, as read. */
export interface ShownPhotoRow {
  photoKey: string | null;
  photoConsentAt: Date | null;
}

/**
 * The shown photo as a URL for an AUTHENTICATED, capability-gated desk (the
 * organizer's registrations, teams, squad and lineup screens): consent decides.
 * Consent is checked before signing, so an unconsented photo never gets a URL
 * that could leak.
 */
export function consentedPhotoUrl(
  row: ShownPhotoRow,
  readUrl: (key: string) => string,
): string | null {
  return row.photoConsentAt !== null && row.photoKey !== null ? readUrl(row.photoKey) : null;
}

/**
 * The shown photo as a URL for anything a spectator, a rival or the public can
 * reach (live rooms, broadcast pages, posters, share cards): consent AND age.
 * PRR P0-2 (DPDP §9) — a minor's face never rides a public surface, whatever
 * consent was recorded. Same rule as `toShowcasePlayer` on /c.
 *
 * P0-6: and neither does a face of UNKNOWN age. `mayPublishPhoto`, not
 * `!isMinor` — the latter lets a DOB-less import row (a child, as often as
 * not) through.
 */
export function publicPhotoUrl(
  row: ShownPhotoRow & { dateOfBirth: string | null },
  now: Date,
  readUrl: (key: string) => string,
): string | null {
  return mayPublishPhoto(row.dateOfBirth, now) ? consentedPhotoUrl(row, readUrl) : null;
}
