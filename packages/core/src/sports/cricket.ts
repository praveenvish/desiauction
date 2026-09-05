/**
 * CRICKET, AS A PACK.
 *
 * Everything in this file was already in the product — it was just in four
 * places at once. The playing-role list was declared in `player-profile.ts`,
 * again in `competition.ts`, again in `apps/web/src/lib/playing-roles.ts` and a
 * fourth time inside `teams-panel.tsx`; two of those spelled the same role
 * "All-rounder" and two spelled it "All rounder", so a player read as one thing
 * on their share card and another in the registrations table. That is the
 * defect this pack closes, and it was worth closing whether or not a second
 * sport is ever added.
 *
 * NOTHING HERE IS NEW. The tokens, the labels and every alias are carried over
 * unchanged from the modules they came from, with one deliberate exception
 * recorded at ROLE_TERMS below.
 *
 * THE KEY TUPLES ARE EXPORTED, and that is not incidental. `PlayerRole`,
 * `BattingStyle`, `BowlingStyle` and `RegistrationRole` are literal-union types
 * the whole product is typed against; deriving them from `readonly string[]`
 * would silently widen every one to `string` and delete the compiler's ability
 * to catch a misspelt role. The tuples keep the types exact while the runtime
 * values still come from one place.
 */

import { DEFAULT_POINTS, ratePer } from "../standings";

import type {
  AttributeSpec,
  RoleVocabulary,
  ScoreFieldSpec,
  SportPack,
  Terminology,
  VocabularyTerm,
} from "./types";

export const CRICKET_ROLE_KEYS = ["batter", "bowler", "all_rounder", "wicket_keeper"] as const;
export type CricketRole = (typeof CRICKET_ROLE_KEYS)[number];

export const CRICKET_BATTING_STYLE_KEYS = [
  "right_hand",
  "left_hand",
  "right_hand_opener",
  "left_hand_opener",
  "right_hand_middle_order",
  "left_hand_middle_order",
] as const;
export type CricketBattingStyle = (typeof CRICKET_BATTING_STYLE_KEYS)[number];

export const CRICKET_BOWLING_STYLE_KEYS = [
  "right_arm_fast",
  "right_arm_medium",
  "left_arm_fast",
  "left_arm_medium",
  "off_break",
  "leg_break",
  "left_arm_orthodox",
  "left_arm_chinaman",
] as const;
export type CricketBowlingStyle = (typeof CRICKET_BOWLING_STYLE_KEYS)[number];

type TermDetail = { readonly label: string; readonly aliases: readonly string[] };

function termsOf<K extends string>(
  keys: readonly K[],
  details: Record<K, TermDetail>,
): readonly VocabularyTerm[] {
  return keys.map((key) => ({ key, label: details[key].label, aliases: details[key].aliases }));
}

/** A curated option carries no aliases of its own — its token and its label are
 *  both matched, which is exactly what `parseBattingStyle` did before. */
function options<K extends string>(
  keys: readonly K[],
  labels: Record<K, string>,
): readonly VocabularyTerm[] {
  return keys.map((key) => ({ key, label: labels[key], aliases: [] }));
}

/**
 * THE FOUR ROLES.
 *
 * THE ONE INTENTIONAL CHANGE IN PHASE 0: `all_rounder` now reads "All-rounder"
 * everywhere. It already did on the share card, the poster, the public player
 * page and the career header; the registrations table, the season pool and the
 * teams panel said "All rounder" because they read a second map. One spelling
 * had to win, and the hyphenated one wins because it is the one on the public
 * surfaces a player sees about themselves.
 *
 * The aliases are the vocabulary of a club registration form, not an attempt at
 * natural language. A speciality spelling collapses to the role it is a kind of
 * — a leg spinner is a bowler, an opener is a batter — because the finer detail
 * already has its own attribute below.
 */
const ROLE_TERMS: Record<CricketRole, TermDetail> = {
  batter: {
    label: "Batter",
    aliases: [
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
  },
  bowler: {
    label: "Bowler",
    aliases: [
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
  },
  all_rounder: {
    label: "All-rounder",
    aliases: ["all rounder", "all round", "ar", "batting all rounder", "bowling all rounder"],
  },
  wicket_keeper: {
    label: "Wicket-keeper",
    aliases: [
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
  },
};

/**
 * `required: true` — cricket is a sport where the role genuinely decides
 * something: the auction plan counts a squad by role, and an owner about to buy
 * an eleventh batter has been told so.
 */
const ROLES: RoleVocabulary = {
  required: true,
  values: termsOf(CRICKET_ROLE_KEYS, ROLE_TERMS),
};

const BATTING_STYLE_LABELS: Record<CricketBattingStyle, string> = {
  right_hand: "Right Hand Batsman",
  left_hand: "Left Hand Batsman",
  right_hand_opener: "Right Hand Opener",
  left_hand_opener: "Left Hand Opener",
  right_hand_middle_order: "Right Hand Middle Order",
  left_hand_middle_order: "Left Hand Middle Order",
};

const BOWLING_STYLE_LABELS: Record<CricketBowlingStyle, string> = {
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
 * Batting and bowling style.
 *
 * Both live in real columns and STAY there. They predate this registry, they
 * have ten consumers plus an import mapper plus a share card behind them, and
 * migrating them into JSON would spend a data migration on the only sport that
 * currently has players in it. The `storage` field records the fact so no
 * surface has to care; sports added from Phase 2 on use `{ kind: "json" }`.
 */
const ATTRIBUTES: readonly AttributeSpec[] = [
  {
    key: "batting_style",
    label: "Batting style",
    storage: { kind: "column", column: "batting_style" },
    headerAliases: ["batting style", "batting", "bats", "batting hand"],
    options: options(CRICKET_BATTING_STYLE_KEYS, BATTING_STYLE_LABELS),
  },
  {
    key: "bowling_style",
    label: "Bowling style",
    storage: { kind: "column", column: "bowling_style" },
    headerAliases: ["bowling style", "bowling", "bowls", "bowling arm", "bowling type"],
    options: options(CRICKET_BOWLING_STYLE_KEYS, BOWLING_STYLE_LABELS),
  },
];

/**
 * The typo net, carried over from `recordFixtureResult`'s `plausible()`.
 *
 * Ten wickets is a real limit. The other two are not rules — they are the point
 * past which a number is certainly a slipped finger, which is all that check
 * ever claimed to catch.
 */
const SCORE_FIELDS: readonly ScoreFieldSpec[] = [
  { key: "runs", label: "Runs", min: 0, max: 2000 },
  { key: "wickets", label: "Wickets", min: 0, max: 10 },
  {
    key: "balls",
    label: "Balls",
    min: 0,
    max: 3000,
    entry: { label: "Overs", help: "18.3 — not 18.5 for a half" },
    parse: ballsOf,
  },
];

/**
 * NET RUN RATE, now a declared tiebreak rather than a hard-wired one.
 *
 * OVERS ARE BALLS THROUGHOUT. `4.5` overs is four overs and five balls, and a
 * rate computed on that decimal is wrong by roughly eight percent per
 * fractional over — quietly, all season, in the number that decides who
 * qualifies. This divides runs by BALLS and multiplies by six, which is the
 * whole reason `balls` is a stored score component and `overs` is only ever a
 * display.
 *
 * Null, not zero, when a side has faced nothing: zero is a real NRR that a team
 * exactly level has earned.
 */
const NET_RUN_RATE = {
  key: "net_run_rate",
  label: "NRR",
  precision: 3,
  compute: (totals: { scored: Record<string, number>; conceded: Record<string, number> }) => {
    const scored = ratePer(totals.scored["runs"] ?? 0, totals.scored["balls"] ?? 0, 6);
    const conceded = ratePer(totals.conceded["runs"] ?? 0, totals.conceded["balls"] ?? 0, 6);
    return scored === null || conceded === null ? null : scored - conceded;
  },
};

const TERMS: Terminology = {
  participant: ["Player", "Players"],
  squad: "Squad",
  fixture: "Match",
  ground: "Ground",
};

/** Balls → the "4.5" cricket writes. Display only; never arithmetic. */
export function oversOf(balls: number): string {
  return `${String(Math.floor(balls / 6))}.${String(balls % 6)}`;
}

/** "4.5" → 29 balls. Returns null for anything that is not a legal over count. */
export function ballsOf(overs: string): number | null {
  const match = /^(\d{1,3})(?:\.([0-5]))?$/.exec(overs.trim());
  if (match === null) {
    return null;
  }
  // `.6` is rejected by the pattern above rather than folded to the next over:
  // somebody typing 4.6 has made a mistake, and silently reading it as 5.0
  // hides it inside a number nobody re-checks.
  return Number(match[1]) * 6 + Number(match[2] ?? 0);
}

export const CRICKET: SportPack = {
  key: "cricket",
  label: "Cricket",
  roles: ROLES,
  attributes: ATTRIBUTES,
  result: { scoreFields: SCORE_FIELDS },
  /*
   * Referenced, not copied. `DEFAULT_POINTS` is cricket's limited-overs scheme
   * (2 / 1 / 0, a point shared on a no-result) and it already lives beside the
   * net-run-rate maths that depends on it. Pointing at it keeps ONE definition;
   * it moves in here when Phase 2 generalizes the tiebreaker chain and
   * standings.ts stops being cricket's home.
   */
  standings: {
    points: DEFAULT_POINTS,
    tiebreakers: [NET_RUN_RATE],
    summariseSide: (totals) => `${String(totals["runs"] ?? 0)}/${oversOf(totals["balls"] ?? 0)}`,
  },
  terms: TERMS,
};
