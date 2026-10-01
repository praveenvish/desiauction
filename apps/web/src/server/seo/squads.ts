import { MINOR_AGE_THRESHOLD, deriveAge } from "@desiauction/core";

/**
 * MAY A SEASON'S SQUAD PAGES BE OFFERED TO SEARCH ENGINES? (SEO-1 Phase 5)
 *
 * A squad page lists players by name. Shared by link, that is a team sheet;
 * indexed, it is a name a stranger can search for. So indexing needs BOTH:
 *
 *   1. the organizer's opt-in (`competitions.list_squads_in_search`), and
 *   2. every approved player in the season a KNOWN adult.
 *
 * FAIL CLOSED, like `mayPublishPhoto`: an unknown or unparseable date of birth
 * blocks, exactly as an under-18 one does. The CSV import carries no DOB and
 * the add-player form marks it optional, so "no date" is common, and a child
 * entered by the club without one must not become searchable because nobody
 * typed a birthday. Season-wide, not per team: approving a minor into ANY
 * squad takes every squad of that season back out of search.
 *
 * Pure, so the rule is tested without a database; the reads live in
 * server/competition/public.ts beside the other public read models.
 */
export type SquadListing =
  | { readonly indexable: true }
  | {
      readonly indexable: false;
      readonly reason: "off" | "no_players" | "unproven_age";
      readonly blocking: number;
    };

export function squadListingDecision(input: {
  readonly optedIn: boolean;
  /** `registrations.date_of_birth` of every APPROVED registration in the season. */
  readonly birthDates: readonly (string | null)[];
  readonly now: Date;
}): SquadListing {
  if (!input.optedIn) return { indexable: false, reason: "off", blocking: 0 };
  if (input.birthDates.length === 0) return { indexable: false, reason: "no_players", blocking: 0 };
  const blocking = input.birthDates.filter((dob) => {
    const age = deriveAge(dob, input.now);
    return age === null || age < MINOR_AGE_THRESHOLD;
  }).length;
  return blocking === 0
    ? { indexable: true }
    : { indexable: false, reason: "unproven_age", blocking };
}
