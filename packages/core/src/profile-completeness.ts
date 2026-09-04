/**
 * PROFILE COMPLETENESS — derived, never stored (PI-1 P4).
 *
 * The house rule for lifecycle facts applies to progress too: a stored
 * percentage rots the moment a column changes, so this is recomputed on every
 * read from the same rows the surfaces render. Codes out, copy in the UI —
 * the publishBlockers pattern.
 *
 * The item list is what the PRODUCT actually uses, not a form-field census:
 * a photo renders on the showcase, the role builds the auction pool, DOB
 * drives the age on the player card, a passkey is the fast door in. Fields
 * nothing consumes (jersey preference) do not gate "complete" — a checklist
 * that scolds people about unused fields is homework, not help.
 *
 * Gender is deliberately ABSENT from the checklist. It is optional-always by
 * design; a completeness meter that docks points for not answering makes the
 * optional mandatory by nagging (the same back-door the eligibility engine
 * refuses).
 */

export const PROFILE_ITEMS = [
  "name",
  "photo",
  "role",
  "date_of_birth",
  "style",
  "location",
  "email",
  "passkey",
] as const;

export type ProfileItem = (typeof PROFILE_ITEMS)[number];

export interface ProfileCompletenessInput {
  name: string | null;
  /** The storage key; only ever set through the consent-gated media path. */
  photoUrl: string | null;
  emailVerified: boolean;
  dateOfBirth: string | null;
  location: string | null;
  defaultRole: string | null;
  defaultBattingStyle: string | null;
  defaultBowlingStyle: string | null;
  passkeyCount: number;
}

export interface ProfileCompleteness {
  done: number;
  total: number;
  /** 0..1, done/total — render as a bar or a fraction, never store it. */
  score: number;
  missing: ProfileItem[];
}

function present(value: string | null): boolean {
  return value !== null && value.trim() !== "";
}

export function profileCompleteness(input: ProfileCompletenessInput): ProfileCompleteness {
  const state: Record<ProfileItem, boolean> = {
    name: present(input.name),
    photo: present(input.photoUrl),
    role: present(input.defaultRole),
    date_of_birth: present(input.dateOfBirth),
    // Either style counts: a specialist bowler owes nobody a batting style.
    style: present(input.defaultBattingStyle) || present(input.defaultBowlingStyle),
    location: present(input.location),
    email: input.emailVerified,
    passkey: input.passkeyCount > 0,
  };
  const missing = PROFILE_ITEMS.filter((item) => !state[item]);
  const done = PROFILE_ITEMS.length - missing.length;
  return {
    done,
    total: PROFILE_ITEMS.length,
    score: done / PROFILE_ITEMS.length,
    missing,
  };
}
