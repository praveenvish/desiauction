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
 * The account's photo, unless the season only knows this player by a typed
 * name: a face would unmask exactly what the typed name protects.
 */
export const shownPhotoKey = sql<
  string | null
>`case when ${registrations.enteredName} is null then ${people.photoUrl} end`;
