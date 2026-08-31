/**
 * Player profile value types (parity foundation, §3.2). Pure — no IO, no
 * ambient time. Batting/bowling styles are curated enums the register form and
 * the showcase both key off; age is DERIVED from date-of-birth against an
 * injected clock (we store DOB, never a rotting age integer — decision D2).
 */

export const BATTING_STYLES = [
  "right_hand",
  "left_hand",
  "right_hand_opener",
  "left_hand_opener",
  "right_hand_middle_order",
  "left_hand_middle_order",
] as const;

export const BOWLING_STYLES = [
  "right_arm_fast",
  "right_arm_medium",
  "left_arm_fast",
  "left_arm_medium",
  "off_break",
  "leg_break",
  "left_arm_orthodox",
  "left_arm_chinaman",
] as const;

/** The four playing roles the register form and showcase key off. */
export const PLAYER_ROLES = ["batter", "bowler", "all_rounder", "wicket_keeper"] as const;

export type BattingStyle = (typeof BATTING_STYLES)[number];
export type BowlingStyle = (typeof BOWLING_STYLES)[number];
export type PlayerRole = (typeof PLAYER_ROLES)[number];

const ROLE_LABELS: Record<PlayerRole, string> = {
  batter: "Batter",
  bowler: "Bowler",
  all_rounder: "All-rounder",
  wicket_keeper: "Wicket-keeper",
};

/** Human label for a role; unknown/legacy values pass through unchanged. */
export function roleLabel(role: string): string {
  return (ROLE_LABELS as Record<string, string>)[role] ?? role;
}

export function isBattingStyle(value: string): value is BattingStyle {
  return (BATTING_STYLES as readonly string[]).includes(value);
}

export function isBowlingStyle(value: string): value is BowlingStyle {
  return (BOWLING_STYLES as readonly string[]).includes(value);
}

/** Human labels for display (the DB stores the enum key). */
export function battingStyleLabel(style: BattingStyle): string {
  return LABELS[style];
}

export function bowlingStyleLabel(style: BowlingStyle): string {
  return LABELS[style];
}

const LABELS: Record<BattingStyle | BowlingStyle, string> = {
  right_hand: "Right Hand Batsman",
  left_hand: "Left Hand Batsman",
  right_hand_opener: "Right Hand Opener",
  left_hand_opener: "Left Hand Opener",
  right_hand_middle_order: "Right Hand Middle Order",
  left_hand_middle_order: "Left Hand Middle Order",
  right_arm_fast: "Right Arm Fast",
  right_arm_medium: "Right Arm Medium",
  left_arm_fast: "Left Arm Fast",
  left_arm_medium: "Left Arm Medium",
  off_break: "Off-Break",
  leg_break: "Leg-Break",
  left_arm_orthodox: "Left Arm Orthodox",
  left_arm_chinaman: "Left Arm Chinaman",
};

/**
 * PARSE A STYLE THE WAY A PERSON WROTE IT.
 *
 * The stored values are snake_case tokens (`right_hand_opener`); every surface
 * that shows a style shows its LABEL ("Right Hand Opener"). Nothing bridged the
 * two on the way IN, so a CSV import carrying what the organizer could see —
 * which is the only spelling they have ever been shown — silently stored
 * nothing at all. Measured in the RH-1 rehearsal: 73 imported rows each carried
 * a batting style, 0 were stored, and the preview reported "73 valid row(s) ·
 * 0 errors".
 *
 * Accepts the canonical token, the human label, and either with any mixture of
 * case, spaces, hyphens and underscores — so "Off-Break", "off break" and
 * "off_break" are one answer. Returns null for anything it cannot place, which
 * is the caller's cue to REPORT rather than to drop.
 */
function normalizeStyleKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, "");
}

const STYLE_BY_NORMALIZED: ReadonlyMap<string, BattingStyle | BowlingStyle> = new Map(
  (Object.keys(LABELS) as (BattingStyle | BowlingStyle)[]).flatMap((key) => [
    [normalizeStyleKey(key), key] as const,
    [normalizeStyleKey(LABELS[key]), key] as const,
  ]),
);

/** The canonical batting style behind a token or a label, else null. */
export function parseBattingStyle(value: string): BattingStyle | null {
  const found = STYLE_BY_NORMALIZED.get(normalizeStyleKey(value));
  return found !== undefined && isBattingStyle(found) ? found : null;
}

/** The canonical bowling style behind a token or a label, else null. */
export function parseBowlingStyle(value: string): BowlingStyle | null {
  const found = STYLE_BY_NORMALIZED.get(normalizeStyleKey(value));
  return found !== undefined && isBowlingStyle(found) ? found : null;
}

/**
 * THE COLUMN THE STYLE FIX LEFT BEHIND.
 *
 * `parseBattingStyle` was taught to read what a person actually writes; role was
 * left on a bare enum match (`isRegistrationRole`), so every spelling a human
 * uses on a registration form — "All Rounder", "Batsman", "Wicket Keeper" —
 * failed line by line. Since the import refuses any file with errors, one
 * ordinary Google Form export produced N errors and imported nobody.
 *
 * The aliases below are the vocabulary of a club registration form, not an
 * attempt at natural language: each one is a spelling of one of the four roles
 * we already have, and anything outside them still returns null so the caller
 * REPORTS rather than guesses. Speciality spellings collapse to the role they
 * are a kind of — a "leg spinner" is a bowler, an opener is a batter — because
 * the finer detail already has its own columns in `batting_style` and
 * `bowling_style`.
 */
/*
 * Spelled out in the form a person types; punctuation and spacing are removed
 * by `normalizeStyleKey` before lookup, so "All Rounder", "all-rounder" and
 * "allrounder" are one entry here, not three.
 */
const ROLE_ALIASES: Record<PlayerRole, readonly string[]> = {
  batter: [
    "bat",
    "batsman",
    "batswoman",
    "batting",
    "opener",
    "opening batsman",
    "top order",
    "top order batsman",
    "middle order",
    "middle order batsman",
    "finisher",
  ],
  bowler: [
    "bowl",
    "bowling",
    "pacer",
    "pace bowler",
    "fast",
    "fast bowler",
    "medium pacer",
    "seamer",
    "spin",
    "spinner",
    "spin bowler",
    "off spinner",
    "leg spinner",
  ],
  all_rounder: ["all rounder", "all round", "ar", "batting all rounder", "bowling all rounder"],
  wicket_keeper: [
    "wicket keeper",
    "keeper",
    "wk",
    "wkt",
    "wkt keeper",
    "stumper",
    "wicket keeper batsman",
    "wk batsman",
    "keeper batsman",
  ],
};

const ROLE_BY_NORMALIZED: ReadonlyMap<string, PlayerRole> = new Map(
  PLAYER_ROLES.flatMap((role) => [
    [normalizeStyleKey(role), role] as const,
    [normalizeStyleKey(ROLE_LABELS[role]), role] as const,
    ...ROLE_ALIASES[role].map((alias) => [normalizeStyleKey(alias), role] as const),
  ]),
);

/**
 * The canonical role behind a token, a label or the way it is written on a
 * registration form, else null — the caller's cue to report the value back.
 */
export function parseRole(value: string): PlayerRole | null {
  return ROLE_BY_NORMALIZED.get(normalizeStyleKey(value)) ?? null;
}

/**
 * Label any batting OR bowling enum key (the two sets are disjoint), passing an
 * unknown/legacy value through unchanged and `null` through as `null`. The one
 * style formatter for the showcase, the player page, and the share card.
 */
export function styleLabel(style: string | null): string | null {
  if (style === null) {
    return null;
  }
  if (isBattingStyle(style)) {
    return battingStyleLabel(style);
  }
  if (isBowlingStyle(style)) {
    return bowlingStyleLabel(style);
  }
  return style;
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
  if (trimmed.length > PROFILE_LOCATION_MAX || /[ -]/.test(trimmed)) {
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
