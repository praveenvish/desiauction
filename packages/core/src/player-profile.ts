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
