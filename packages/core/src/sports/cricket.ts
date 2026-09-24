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

import { termsOf, type TermDetail } from "./vocabulary";
import { DEFAULT_POINTS } from "../standings";
import { ballsOf } from "./overs";
import { netRate, summariseFields } from "./tiebreakers";

import type {
  AttributeSpec,
  RoleVocabulary,
  ScoreFieldSpec,
  SportPack,
  Terminology,
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

/*
 * The spellings a registration form's style question actually produces.
 *
 * Without these, only the exact label ("Right Hand Batsman") placed, so a
 * Google Form offering "Right" / "Left" sent every row of a real cricket export
 * to the value mapper. ONLY spellings with one meaning are listed: "Left Arm
 * Spin" could be orthodox or chinaman and "Fast Medium" either pace band, so
 * those still come back to the organizer rather than being guessed.
 */
const BATTING_STYLE_TERMS: Record<CricketBattingStyle, TermDetail> = {
  right_hand: {
    label: "Right Hand Batsman",
    aliases: [
      "right",
      "right hand",
      "right handed",
      "right hander",
      "right hand bat",
      "right hand batter",
      "right handed batsman",
      "right handed batter",
      "rhb",
    ],
  },
  left_hand: {
    label: "Left Hand Batsman",
    aliases: [
      "left",
      "left hand",
      "left handed",
      "left hander",
      "left hand bat",
      "left hand batter",
      "left handed batsman",
      "left handed batter",
      "lhb",
    ],
  },
  right_hand_opener: { label: "Right Hand Opener", aliases: [] },
  left_hand_opener: { label: "Left Hand Opener", aliases: [] },
  right_hand_middle_order: { label: "Right Hand Middle Order", aliases: [] },
  left_hand_middle_order: { label: "Left Hand Middle Order", aliases: [] },
};

const BOWLING_STYLE_TERMS: Record<CricketBowlingStyle, TermDetail> = {
  right_arm_fast: {
    label: "Right Arm Fast",
    aliases: ["right arm fast bowler", "right arm pace", "right arm pacer"],
  },
  right_arm_medium: {
    label: "Right Arm Medium",
    aliases: ["right arm medium pace", "right arm medium pacer"],
  },
  left_arm_fast: {
    label: "Left Arm Fast",
    aliases: ["left arm fast bowler", "left arm pace", "left arm pacer"],
  },
  left_arm_medium: {
    label: "Left Arm Medium",
    aliases: ["left arm medium pace", "left arm medium pacer"],
  },
  off_break: {
    label: "Off-Break",
    aliases: [
      "off spin",
      "off spinner",
      "right arm off spin",
      "right arm off break",
      "right arm off spinner",
      "offie",
    ],
  },
  leg_break: {
    label: "Leg-Break",
    aliases: [
      "leg spin",
      "leg spinner",
      "right arm leg spin",
      "right arm leg break",
      "right arm leg spinner",
      "leggie",
    ],
  },
  left_arm_orthodox: {
    label: "Left Arm Orthodox",
    aliases: ["slow left arm orthodox", "sla", "left arm orthodox spin", "left arm finger spin"],
  },
  left_arm_chinaman: {
    label: "Left Arm Chinaman",
    aliases: ["chinaman", "left arm wrist spin", "left arm unorthodox", "slow left arm chinaman"],
  },
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
    options: termsOf(CRICKET_BATTING_STYLE_KEYS, BATTING_STYLE_TERMS),
  },
  {
    key: "bowling_style",
    label: "Bowling style",
    storage: { kind: "column", column: "bowling_style" },
    headerAliases: ["bowling style", "bowling", "bowls", "bowling arm", "bowling type"],
    options: termsOf(CRICKET_BOWLING_STYLE_KEYS, BOWLING_STYLE_TERMS),
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

const TERMS: Terminology = {
  participant: ["Player", "Players"],
  squad: "Squad",
  fixture: "Match",
  ground: "Ground",
};

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
    /* Runs per BALL times six — never runs per decimal over. See `netRate`. */
    tiebreakers: [netRate("runs", "balls", 6, "NRR", { key: "net_run_rate" })],
    summariseSide: summariseFields("{runs}/{balls:overs}"),
  },
  terms: TERMS,
};
