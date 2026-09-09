/**
 * Player profile value types (parity foundation, §3.2). Pure — no IO, no
 * ambient time. Age is DERIVED from date-of-birth against an injected clock
 * (we store DOB, never a rotting age integer — decision D2).
 *
 * THE VOCABULARY MOVED (Phase 0). Playing roles, batting and bowling styles,
 * their labels and every alias a registration form spells them with now live in
 * `sports/cricket.ts` — they were declared here AND in `competition.ts` AND
 * twice more in the web app, in two different spellings of "All-rounder". What
 * remains in this module is the PERSON-level profile — gender, date of birth,
 * location, jersey — which is sport-neutral and stays that way.
 *
 * Every symbol below keeps its name, its type and its behaviour; each is now a
 * thin reader over the cricket pack. When `competitions.sport` arrives in Phase
 * 1, these become the compiler's own list of callers that still assume one
 * sport, and each is a real question about which pack applies.
 */

import {
  CRICKET,
  CRICKET_BATTING_STYLE_KEYS,
  CRICKET_BOWLING_STYLE_KEYS,
  CRICKET_ROLE_KEYS,
  attributeOptionLabel,
  isAttributeValueIn,
  parseAttributeIn,
  roleLabelIn,
} from "./sports";

export const BATTING_STYLES = CRICKET_BATTING_STYLE_KEYS;
export const BOWLING_STYLES = CRICKET_BOWLING_STYLE_KEYS;
/** The four playing roles the register form and showcase key off. */
export const PLAYER_ROLES = CRICKET_ROLE_KEYS;

export type BattingStyle = (typeof BATTING_STYLES)[number];
export type BowlingStyle = (typeof BOWLING_STYLES)[number];
export type PlayerRole = (typeof PLAYER_ROLES)[number];

/** Human label for a role; an unknown/legacy value comes back readable. */
export function roleLabel(role: string | null): string {
  return roleLabelIn(CRICKET, role);
}

export function isBattingStyle(value: string): value is BattingStyle {
  return isAttributeValueIn(CRICKET, "batting_style", value);
}

export function isBowlingStyle(value: string): value is BowlingStyle {
  return isAttributeValueIn(CRICKET, "bowling_style", value);
}

/** Human labels for display (the DB stores the enum key). */
export function battingStyleLabel(style: BattingStyle): string {
  return attributeOptionLabel(CRICKET, style) ?? style;
}

export function bowlingStyleLabel(style: BowlingStyle): string {
  return attributeOptionLabel(CRICKET, style) ?? style;
}

/**
 * PARSE A VALUE THE WAY A PERSON WROTE IT.
 *
 * Accepts the canonical token, the human label, and — for roles — the spellings
 * a club registration form actually uses, with any mixture of case, spaces,
 * hyphens and underscores. Returns null for anything it cannot place, which is
 * the caller's cue to REPORT rather than to drop the row.
 *
 * The two failures that bought these functions are worth remembering. Styles
 * were parsed by bare enum match, so an import carrying the only spelling an
 * organizer has ever been shown stored nothing: measured in the RH-1 rehearsal
 * at 73 styles supplied, 0 stored, and a preview reporting "0 errors". Role was
 * left on the same bare match afterwards, so "All Rounder" failed line by line
 * and one ordinary Google Form export imported nobody at all.
 */
export function parseBattingStyle(value: string): BattingStyle | null {
  const found = parseAttributeIn(CRICKET, "batting_style", value);
  return found !== null && isBattingStyle(found) ? found : null;
}

export function parseBowlingStyle(value: string): BowlingStyle | null {
  const found = parseAttributeIn(CRICKET, "bowling_style", value);
  return found !== null && isBowlingStyle(found) ? found : null;
}

/*
 * `parseRole` LIVED HERE AND IS GONE.
 *
 * It was `parseRoleIn(CRICKET, …)` under a name that reads like "parse a role",
 * so four separate gates reached for it and every one of them ended up asking
 * cricket about a football season: the eligibility evaluator, the registration
 * writer, the CSV import and the organizer's add-by-hand dialog. Three of the
 * four shipped sports could not admit a player by any route.
 *
 * The fix was to pass the season's pack, and leaving the old name exported
 * would have left the trap armed for the next caller. Use `parseRoleIn(pack, …)`
 * — it makes you name the sport you mean.
 */

/**
 * Label any batting OR bowling enum key (the two sets are disjoint), passing an
 * unknown/legacy value through unchanged and `null` through as `null`. The one
 * style formatter for the showcase, the player page, and the share card.
 */
export function styleLabel(style: string | null): string | null {
  return attributeOptionLabel(CRICKET, style);
}

/**
 * Derive integer age (completed years) from an ISO `yyyy-mm-dd` DOB against
 * `now`. Returns null for an absent/invalid/future date. Deterministic: the
 * caller supplies `now` (no `Date.now()` here — house rule 2.1).
 */
export function deriveAge(dateOfBirth: string | null, now: Date): number | null {
  if (dateOfBirth === null) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Reject impossible calendar values (e.g. 2020-13-40).
  const dob = new Date(Date.UTC(year, month - 1, day));
  if (
    dob.getUTCFullYear() !== year ||
    dob.getUTCMonth() !== month - 1 ||
    dob.getUTCDate() !== day
  ) {
    return null;
  }
  let age = now.getUTCFullYear() - year;
  const beforeBirthday =
    now.getUTCMonth() < month - 1 || (now.getUTCMonth() === month - 1 && now.getUTCDate() < day);
  if (beforeBirthday) {
    age -= 1;
  }
  return age < 0 ? null : age;
}

/** The age below which a registrant is treated as a child (DPDP Act 2023 §2(f)). */
export const MINOR_AGE_THRESHOLD = 18;

/**
 * Is this registrant a minor? (PRR P0-2 — DPDP Act 2023 §9.)
 *
 * A child's personal data may not be published on a public, unauthenticated
 * surface, and processing it needs verifiable guardian consent. This is the one
 * predicate both the registration gate and the public read model derive that
 * from. An unknown or unparseable date of birth is NOT treated as a minor: the
 * age gate cannot assert a fact it does not have, and a registrant who gave no
 * date has no age published anyway (there is nothing to suppress).
 */
export function isMinor(dateOfBirth: string | null, now: Date): boolean {
  const age = deriveAge(dateOfBirth, now);
  return age !== null && age < MINOR_AGE_THRESHOLD;
}

// --- Person-level profile (PI-1) ---------------------------------------------
//
// GENDER, MODELED ONCE AND ASKED GENTLY.
//
// Two different absences, and a reader must be able to tell them apart:
// a NULL column means the question was never put to this person; `unspecified`
// means it was, and they declined. Collapsing the two turns "we never asked"
// into "they refused to say", which is a claim about a person we cannot make.
//
// `self_described` carries its own words in a separate column, because a fixed
// list that ends in "other" without a voice is the list doing the describing.
//
// Never inferred from a name, never an authorization input, never rendered on
// an org-facing or public surface (DPDP minimalism; C-23 spirit). The ONE
// consumer of this value for decisions is `eligibility.ts` — a guardrail test
// holds that boundary.
export const GENDERS = ["male", "female", "non_binary", "self_described", "unspecified"] as const;

export type Gender = (typeof GENDERS)[number];

export function isGender(value: string): value is Gender {
  return (GENDERS as readonly string[]).includes(value);
}

const GENDER_LABELS: Record<Gender, string> = {
  male: "Male",
  female: "Female",
  non_binary: "Non-binary",
  self_described: "Self-described",
  unspecified: "Prefer not to say",
};

/**
 * Human label for a gender. A self-described answer shows the person's own
 * words when they gave any — that is the entire point of the option.
 */
export function genderLabel(gender: Gender, selfDescribed: string | null = null): string {
  if (gender === "self_described" && selfDescribed !== null && selfDescribed.trim() !== "") {
    return selfDescribed.trim();
  }
  return GENDER_LABELS[gender];
}

export const GENDER_SELF_DESCRIBED_MAX = 40;
export const PROFILE_LOCATION_MAX = 80;
export const JERSEY_NAME_MAX = 30;

/**
 * Validate an ISO `yyyy-mm-dd` date of birth against an injected clock.
 * Distinct from `deriveAge`, which answers "how old" and folds every failure to
 * null — a form needs to say WHY a value was refused. `null`/empty is valid
 * (the field is optional everywhere it appears).
 */
export function validateDateOfBirth(
  value: string | null,
  now: Date,
): { ok: true } | { ok: false; reason: "format" | "future" | "too_old" } {
  if (value === null || value.trim() === "") {
    return { ok: true };
  }
  const age = deriveAge(value, now);
  if (age === null) {
    // deriveAge rejects malformed strings, impossible calendar dates AND
    // future dates (negative age) — a future date parses, so tell it apart.
    const parses = /^(\d{4})-(\d{2})-(\d{2})$/.test(value);
    return { ok: false, reason: parses && value > isoDateOf(now) ? "future" : "format" };
  }
  if (value < "1900-01-01") {
    return { ok: false, reason: "too_old" };
  }
  return { ok: true };
}

function isoDateOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * A city-level free-text location. No taxonomy: the platform is India-first
 * (C-24) and a state/country picker would be a form asking for data no feature
 * consumes. Control characters are refused, not stripped — a value that needed
 * stripping is a value somebody should look at.
 */
export function validateProfileLocation(
  value: string,
): { ok: true; location: string } | { ok: false } {
  const trimmed = value.trim().replace(/\s+/g, " ");
  // eslint-disable-next-line no-control-regex
  if (trimmed.length > PROFILE_LOCATION_MAX || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return { ok: false };
  }
  return { ok: true, location: trimmed };
}

/**
 * Preferred jersey number: 1–3 digits, as the import path tolerates ("07" is a
 * number somebody wears). Stored as text, like `registrations.jersey_number`.
 */
export function validateJerseyNumber(value: string): { ok: true; number: string } | { ok: false } {
  const trimmed = value.trim();
  if (!/^\d{1,3}$/.test(trimmed)) {
    return { ok: false };
  }
  return { ok: true, number: trimmed };
}
