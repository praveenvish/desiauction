import { termsOf, type TermDetail } from "./vocabulary";
import { difference, summariseFields, total } from "./tiebreakers";

import type { RoleVocabulary, ScoreFieldSpec, SportPack, Terminology } from "./types";

/**
 * KABADDI — the third pack, and the first one that cost only a pack.
 *
 * Cricket built the contract; football tested it and forced three additions
 * (terminology, a tiebreaker chain, per-field entry/parse). This one added
 * NOTHING. No new field, no schema change, no UI change, no engine change — the
 * sport picker, the registration form, the results form, the standings columns
 * and the admin catalogue all read it as they read the other two. That is the
 * whole claim of SP-1, and this file is where it either held or did not.
 *
 * It held.
 */

export const KABADDI_ROLE_KEYS = ["raider", "defender", "all_rounder"] as const;
export type KabaddiRole = (typeof KABADDI_ROLE_KEYS)[number];

/**
 * THREE ROLES, and the defensive positions fold into one of them.
 *
 * A kabaddi team sheet distinguishes a left corner from a right cover; an
 * AUCTION does not. What an owner is short of is a raider or a defender, and
 * which corner they stand in is the coach's problem on the night. So the
 * positions are ALIASES that collapse to `defender`, exactly as football's
 * "CB"/"LB"/"RWB" do and as cricket folds "leg spinner" into bowler — an
 * organizer importing a spreadsheet of corners and covers retypes nothing.
 */
const ROLE_TERMS: Record<KabaddiRole, TermDetail> = {
  raider: {
    label: "Raider",
    aliases: ["raid", "raiding", "attacker", "offence", "offense", "chasing raider"],
  },
  defender: {
    label: "Defender",
    aliases: [
      "defence",
      "defense",
      "def",
      "corner",
      "left corner",
      "right corner",
      "cover",
      "left cover",
      "right cover",
      "left in",
      "right in",
      "in",
      "catcher",
      "anchor",
    ],
  },
  all_rounder: {
    label: "All-rounder",
    aliases: ["all rounder", "all round", "ar", "raider defender", "utility"],
  },
};

const ROLES: RoleVocabulary = {
  /*
   * Required. A squad that bought seven raiders and no corner defenders has a
   * problem the plan screen should have named during the auction, and it can
   * only do that if every lot carries a role.
   */
  required: true,
  values: termsOf(KABADDI_ROLE_KEYS, ROLE_TERMS),
};

/**
 * ONE NUMBER A SIDE — points, as the scoreboard shows them.
 *
 * Raid points, tackle points, bonus and all-outs are how a total is BUILT, and
 * a scorer entering a result after the match has the total in front of them,
 * not the breakdown. Asking for six numbers to derive one that was already on
 * the board is a longer form and a new way to be wrong. If a league ever wants
 * the breakdown it is more score fields here, not a different shape.
 *
 * 200 is the typo net, not a rulebook: a kabaddi match rarely passes 60, so a
 * three-figure entry is a slipped finger long before it is a scoreline.
 */
const SCORE_FIELDS: readonly ScoreFieldSpec[] = [
  { key: "points", label: "Points", min: 0, max: 200 },
];

const TERMS: Terminology = {
  participant: ["Player", "Players"],
  squad: "Squad",
  fixture: "Match",
  /*
   * THE WORD THIS PACK CHANGES. Kabaddi is played on a mat, not a ground and
   * not a pitch — the one term the terminology wiring exists for, and the third
   * distinct answer to it.
   */
  ground: "Mat",
};

export const KABADDI: SportPack = {
  key: "kabaddi",
  label: "Kabaddi",
  roles: ROLES,
  /*
   * NO ATTRIBUTES, and that is a finding rather than an omission.
   *
   * Cricket records a batting and a bowling style; football records a preferred
   * foot. Club kabaddi records no comparable per-player fact — there is no
   * "raiding hand" on any team sheet this product would import. Inventing one
   * would put a field on the registration form that no organizer can fill and
   * no feature reads.
   *
   * It also exercises the contract's empty case, which neither previous pack
   * did: the account panel renders the role and nothing else, and the import
   * mapper offers no sport columns.
   */
  attributes: [],
  result: { scoreFields: SCORE_FIELDS },
  standings: {
    /*
     * 2 / 1 / 0, the ordinary club scheme — deliberately NOT the Pro Kabaddi
     * League's 5 / 3 / 1-with-a-bonus-point-for-losing-within-seven. PKL's
     * scheme is real and a league running it should have it, but it is a
     * professional competition's rule and encoding it as the default would
     * quietly impose it on every club league that is not PKL.
     *
     * `PointsPolicy` is an injected value, so the day a PKL-shaped league asks,
     * that is a value on the competition rather than a fork of this pack.
     */
    points: { win: 2, tie: 1, loss: 0, noResult: 1 },
    /* Score difference, then points scored — the order kabaddi tables use. */
    tiebreakers: [difference("points", "SD", { key: "score_difference" }), total("points", "PF")],
    summariseSide: summariseFields("{points}"),
  },
  terms: TERMS,
};
