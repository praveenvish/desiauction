import { optionsOf, termsOf, type TermDetail } from "./vocabulary";
import { difference, summariseFields } from "./tiebreakers";

import type {
  AttributeSpec,
  RoleVocabulary,
  ScoreFieldSpec,
  SportPack,
  Terminology,
} from "./types";

/**
 * BADMINTON — the sport this repo spent a fortnight calling BLOCKED, wrongly.
 *
 * `PHASE-4_NOTES.md` said racquet sports needed a new `fixtureShape` because "a
 * team tie is several RUBBERS, not one scoreline". The first half is true and
 * the conclusion did not follow. A tie's result IS one scoreline per side —
 * rubbers won, and games won inside them — which is the same arrangement
 * volleyball has had since Phase 4 with sets and points. `ScoreRecord` is an
 * arbitrary map of named numbers, and the result form is built from
 * `scoreFields`, so this pack needed no code at all.
 *
 * WHAT IS ACTUALLY UNAVAILABLE, so the claim is not simply reversed: nobody can
 * record WHO played the third rubber and what it finished. That is a scorecard
 * with line-ups, and no sport here has one — cricket cannot say who batted
 * either. Racquet sports are no more limited than the six that shipped before
 * them, which is the sentence the old note should have contained.
 */

export const BADMINTON_ROLE_KEYS = ["singles", "doubles", "all_court"] as const;
export type BadmintonRole = (typeof BADMINTON_ROLE_KEYS)[number];

export const BADMINTON_HAND_KEYS = ["right", "left"] as const;

/**
 * THREE ROLES, which is what a tie is actually built from.
 *
 * A five-rubber tie is singles and doubles in some arrangement, and what an
 * owner is short of is a singles player or a doubles pair. The professional
 * categories — men's singles, women's doubles, mixed — are ALIASES, because a
 * league's own sheet writes "MS" and "XD" and an auction does not price those
 * separately from the job they describe.
 */
const ROLE_TERMS: Record<BadmintonRole, TermDetail> = {
  singles: {
    label: "Singles",
    aliases: ["single", "ms", "ws", "mens singles", "womens singles", "singles specialist"],
  },
  doubles: {
    label: "Doubles",
    aliases: [
      "double",
      "md",
      "wd",
      "xd",
      "mens doubles",
      "womens doubles",
      "mixed",
      "mixed doubles",
      "doubles specialist",
    ],
  },
  all_court: {
    label: "All-court",
    aliases: ["all court", "allcourt", "both", "utility", "singles and doubles"],
  },
};

const ROLES: RoleVocabulary = { required: true, values: termsOf(BADMINTON_ROLE_KEYS, ROLE_TERMS) };

/**
 * Playing hand, which badminton genuinely records: a left-hander changes which
 * corner a doubles pair defends and which service return they favour, so a
 * league sheet notes it the way cricket notes a batting hand.
 */
const ATTRIBUTES: readonly AttributeSpec[] = [
  {
    key: "playing_hand",
    label: "Playing hand",
    storage: { kind: "json" },
    headerAliases: ["playing hand", "hand", "handedness", "racket hand", "racquet hand"],
    options: optionsOf(BADMINTON_HAND_KEYS, { right: "Right handed", left: "Left handed" }),
  },
];

/**
 * TWO NUMBERS A SIDE, and they are the tie as a scorer reads it off the sheet:
 * rubbers won, then games won across all of them. Nine rubbers covers the
 * longest team format anyone plays; thirty games is far past a nine-rubber tie
 * while still catching a slipped digit.
 */
const SCORE_FIELDS: readonly ScoreFieldSpec[] = [
  { key: "rubbers", label: "Rubbers", min: 0, max: 9 },
  { key: "games", label: "Games", min: 0, max: 30 },
];

const TERMS: Terminology = {
  participant: ["Player", "Players"],
  squad: "Squad",
  /**
   * THE FIRST PACK TO CALL A FIXTURE A TIE. Cricket, football, kabaddi,
   * volleyball and hockey play a Match, basketball a Game; a racquet team
   * meeting is a Tie, and every rubber inside it is a match of its own — which
   * is exactly why the word matters here.
   */
  fixture: "Tie",
  ground: "Court",
};

export const BADMINTON: SportPack = {
  key: "badminton",
  label: "Badminton",
  roles: ROLES,
  attributes: ATTRIBUTES,
  result: { scoreFields: SCORE_FIELDS },
  standings: {
    /*
     * 2 / 0, the ordinary club scheme. `tie` is 1 and unreachable at the
     * formats anyone runs — a tie is an odd number of rubbers precisely so it
     * cannot be drawn — and is filled in rather than left at zero so an even
     * format does not silently award nothing.
     */
    points: { win: 2, tie: 1, loss: 0, noResult: 1 },
    /** Rubber difference, then game difference — the order badminton tables use. */
    tiebreakers: [difference("rubbers", "RD"), difference("games", "GD")],
    summariseSide: summariseFields("{rubbers} ({games})"),
  },
  terms: TERMS,
};
