import { termsOf, type TermDetail } from "./vocabulary";
import { ratio, summariseFields } from "./tiebreakers";

import type {
  AttributeSpec,
  RoleVocabulary,
  ScoreFieldSpec,
  SportPack,
  Terminology,
} from "./types";

/**
 * VOLLEYBALL — the fourth pack, and the first whose SHAPE is different.
 *
 * Cricket, football and kabaddi all reduce a match to one running total per
 * side: runs, goals, points. Volleyball does not. A match is a best-of-five of
 * SETS, and a league table ranks on the ratio of sets won to sets lost before
 * it ever looks at points. So this pack carries two score components where
 * kabaddi carried one, and its tiebreaks are RATIOS rather than differences.
 *
 * The contract took it unchanged — `scoreFields` is already a list, and
 * `tiebreakers` already takes any function of the totals. The divide-by-zero
 * this sport creates (a team that has not lost a set) was worked out here and
 * then MOVED into `tiebreakers.ts`, so every later pack inherits the right
 * answer instead of re-deriving it. What is still worth reading here is the
 * note on points at the bottom: the first place the contract genuinely does
 * not stretch.
 */

export const VOLLEYBALL_ROLE_KEYS = ["setter", "attacker", "blocker", "libero"] as const;
export type VolleyballRole = (typeof VOLLEYBALL_ROLE_KEYS)[number];

export const VOLLEYBALL_HAND_KEYS = ["right", "left"] as const;
export type VolleyballHand = (typeof VOLLEYBALL_HAND_KEYS)[number];

/**
 * FOUR ROLES, from six positions.
 *
 * A volleyball team sheet distinguishes an outside hitter from an opposite and
 * a middle blocker from a defensive specialist. An auction cares whether the
 * squad has a setter, whether it can attack, whether it can block, and whether
 * it has a libero — so the six collapse to four, with the rest as aliases. Same
 * rule as football's CB/LB/RWB and kabaddi's corners and covers.
 *
 * The libero stays its own role rather than folding into defence: it is the one
 * position with its own SHIRT and its own substitution rule, a squad may field
 * only one at a time, and an owner who bought none has a hole no defender
 * fills.
 */
const ROLE_TERMS: Record<VolleyballRole, TermDetail> = {
  setter: { label: "Setter", aliases: ["set", "s", "playmaker", "second passer"] },
  attacker: {
    label: "Attacker",
    aliases: [
      "spiker",
      "hitter",
      "outside hitter",
      "outside",
      "oh",
      "opposite",
      "opposite hitter",
      "opp",
      "wing spiker",
      "left attacker",
      "right attacker",
    ],
  },
  blocker: {
    label: "Blocker",
    aliases: ["middle blocker", "middle", "mb", "centre", "center", "middle hitter"],
  },
  libero: { label: "Libero", aliases: ["l", "defensive specialist", "ds", "receiver", "digger"] },
};

const ROLES: RoleVocabulary = {
  required: true,
  values: termsOf(VOLLEYBALL_ROLE_KEYS, ROLE_TERMS),
};

/**
 * Spiking hand — recorded because in volleyball it genuinely changes where a
 * player is used: a left-hander hitting from the right is attacking across
 * their body's strong side, which is why opposites are so often left-handed.
 *
 * Only added because that is a real fact clubs write down. Kabaddi's pack
 * declares NO attributes for the opposite reason, and inventing one there would
 * have put a field on the form nobody can fill.
 */
const ATTRIBUTES: readonly AttributeSpec[] = [
  {
    key: "spiking_hand",
    label: "Spiking hand",
    storage: { kind: "json" },
    headerAliases: ["spiking hand", "hitting hand", "hand", "handedness", "dominant hand"],
    options: termsOf(VOLLEYBALL_HAND_KEYS, {
      right: { label: "Right handed", aliases: ["right hand", "righty"] },
      left: { label: "Left handed", aliases: ["left hand", "lefty"] },
    }),
  },
];

/**
 * TWO NUMBERS A SIDE, where the other three packs need one.
 *
 * `sets` is what decides the match; `points` is the running total across all
 * sets and is what separates teams level on sets. A scorer reading a finished
 * scoreboard has both in front of them — 3-1, and 98-87 — so asking for both is
 * asking for what is already written down, not for a derivation.
 *
 * Bounds are the typo net: 5 sets is the most any format plays, and 500 points
 * is far past a five-set match (~125 a side) while still catching a slipped
 * digit.
 */
const SCORE_FIELDS: readonly ScoreFieldSpec[] = [
  { key: "sets", label: "Sets", min: 0, max: 5 },
  { key: "points", label: "Points", min: 0, max: 500 },
];

const TERMS: Terminology = {
  participant: ["Player", "Players"],
  squad: "Squad",
  fixture: "Match",
  /** Cricket's Ground, football's Pitch, kabaddi's Mat — and volleyball's. */
  ground: "Court",
};

export const VOLLEYBALL: SportPack = {
  key: "volleyball",
  label: "Volleyball",
  roles: ROLES,
  attributes: ATTRIBUTES,
  result: { scoreFields: SCORE_FIELDS },
  standings: {
    /*
     * THE FIRST PLACE THE CONTRACT DOES NOT STRETCH — worth naming rather than
     * hiding, because the next pack may hit it harder.
     *
     * Competitive volleyball awards 3 points for a 3-0 or 3-1 win, 2 for a 3-2
     * win, and 1 for LOSING 2-3. Those depend on the SET SCORE, and
     * `PointsPolicy` is four flat numbers keyed on the outcome — win, tie,
     * loss, no-result. It cannot express "a win, but only just".
     *
     * So this is the ordinary club scheme: 3 for a win, nothing for a loss.
     * `tie` is set to 1 and is UNREACHABLE — volleyball plays until somebody
     * wins, so no match ever ends level. It is filled in rather than left at
     * zero so that a future format which can draw does not silently award
     * nothing.
     *
     * Making the real scheme expressible means letting a policy read the score
     * as well as the outcome. That is a contract change, and it should wait
     * until a league actually asks — the same rule every other deferral in this
     * programme followed.
     */
    points: { win: 3, tie: 1, loss: 0, noResult: 1 },
    /*
     * Set ratio, then point ratio. The divide-by-zero an unbeaten team creates
     * — and why it has to be Infinity rather than null or zero — now lives in
     * `ratio()`, where every sport inherits the right answer instead of each
     * one re-deriving it.
     */
    tiebreakers: [
      ratio("sets", "Sets", { key: "set_ratio" }),
      ratio("points", "Pts", { key: "point_ratio" }),
    ],
    summariseSide: summariseFields("{sets} ({points})"),
  },
  terms: TERMS,
};
