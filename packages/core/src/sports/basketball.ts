import { termsOf, type TermDetail } from "./vocabulary";
import { difference, summariseFields, total } from "./tiebreakers";

import type { RoleVocabulary, ScoreFieldSpec, SportPack, Terminology } from "./types";

/**
 * BASKETBALL — the sixth pack, and the first where a LOSS is worth something.
 *
 * Every pack before this one gives nothing for losing. Basketball does not, at
 * any level: a FIBA standings table awards 2 for a win and 1 for a loss, and
 * that is how the sport's tables are read everywhere they are read. It is the
 * first real test of `PointsPolicy` being four independent numbers rather than
 * a win/draw/loss ladder that assumes zero at the bottom.
 *
 * It is also the first pack to change the word for a fixture. Cricket, football,
 * kabaddi, volleyball and hockey all play a Match; basketball plays a Game, and
 * the terminology wiring built in Phase 4 for `ground` turns out to have been
 * built for this too.
 */

export const BASKETBALL_ROLE_KEYS = ["guard", "forward", "center"] as const;
export type BasketballRole = (typeof BASKETBALL_ROLE_KEYS)[number];

/**
 * THREE ROLES, from the five positions everybody names.
 *
 * A basketball team sheet distinguishes a point guard from a shooting guard and
 * a small forward from a power forward. An AUCTION does not: what an owner is
 * short of is a ball-handler, a wing or a big, and which of the two guard slots
 * somebody starts in is the coach's problem on the night. So the five collapse
 * to three with the rest as ALIASES — the same rule football applies to
 * CB/LB/RWB, kabaddi to its corners and covers, and volleyball to its six.
 *
 * The numbers are aliases too, because half of amateur basketball writes them:
 * a sheet that says "1" or "2" means a guard, "3"/"4" a forward, "5" a centre.
 * An organizer importing that spreadsheet retypes nothing.
 */
const ROLE_TERMS: Record<BasketballRole, TermDetail> = {
  guard: {
    label: "Guard",
    aliases: [
      "g",
      "pg",
      "sg",
      "point guard",
      "shooting guard",
      "combo guard",
      "playmaker",
      "1",
      "2",
    ],
  },
  forward: {
    label: "Forward",
    aliases: [
      "f",
      "sf",
      "pf",
      "small forward",
      "power forward",
      "wing",
      "swingman",
      "stretch four",
      "3",
      "4",
    ],
  },
  center: {
    label: "Center",
    aliases: ["c", "centre", "big", "big man", "post", "pivot", "5"],
  },
};

const ROLES: RoleVocabulary = { required: true, values: termsOf(BASKETBALL_ROLE_KEYS, ROLE_TERMS) };

/**
 * ONE NUMBER A SIDE — the final score, as the board shows it.
 *
 * Not a box score. Rebounds, assists and fouls are how a total is BUILT, and a
 * scorer entering a result after the game has the total in front of them.
 * Asking for six numbers to derive one already on the board is a longer form
 * and a new way to be wrong.
 *
 * 300 is the typo net: an amateur game rarely passes 120 a side and never
 * doubles it, so a three-figure entry above 300 is a slipped digit.
 */
const SCORE_FIELDS: readonly ScoreFieldSpec[] = [
  { key: "points", label: "Points", min: 0, max: 300 },
];

const TERMS: Terminology = {
  participant: ["Player", "Players"],
  squad: "Squad",
  /** THE FIRST PACK TO CHANGE THIS WORD. Basketball plays games, not matches. */
  fixture: "Game",
  ground: "Court",
};

export const BASKETBALL: SportPack = {
  key: "basketball",
  label: "Basketball",
  roles: ROLES,
  /*
   * NO ATTRIBUTES. The fact a basketball club actually records about a player
   * is HEIGHT, and the contract has no place for a measurement — `attributes`
   * are curated options (a batting hand, a preferred foot), not numbers, and a
   * free-text "6'2"" would be a field nothing could sort, filter or validate.
   *
   * Inventing a curated one instead — a "shooting hand" no team sheet carries —
   * would put a question on the registration form nobody can answer, which is
   * the mistake kabaddi's pack declined to make. Height is a real gap and it is
   * a CONTRACT change (a numeric attribute with units), not a pack file.
   */
  attributes: [],
  result: { scoreFields: SCORE_FIELDS },
  standings: {
    /*
     * 2 FOR A WIN, 1 FOR A LOSS — FIBA's scheme, and the first time `loss` is
     * not zero in this repo.
     *
     * This is not a professional quirk like the Pro Kabaddi League's bonus
     * point, which kabaddi's pack declined to impose. It is how basketball
     * standings are read at every level, so a club table that gave nothing for
     * a loss would be the surprising one.
     *
     * THE CONSEQUENCE, NAMED. Points become `2W + L`, which is `W + games
     * played` — so mid-season, a team that has played more games can sit above
     * one that has played fewer on the same number of wins. That is true of
     * every FIBA table and resolves itself once the fixtures even out; it is
     * recorded here so the next reader knows it is the sport, not a bug.
     *
     * `tie` is 1 and UNREACHABLE: basketball plays overtime until somebody
     * wins. It is filled in rather than left at zero so a future format that
     * can draw does not silently award nothing.
     */
    points: { win: 2, tie: 1, loss: 1, noResult: 1 },
    /*
     * Point difference, then points scored.
     *
     * KNOWN LIMIT, in the volleyball tradition of naming one: basketball's own
     * first tiebreak is the head-to-head record between the tied teams, which
     * `TiebreakerSpec` cannot express — it folds each side's totals and never
     * sees who they were against. Point difference is the sport's next
     * tiebreak and the one a club table usually stops at.
     */
    tiebreakers: [difference("points", "PD", { key: "point_difference" }), total("points", "PF")],
    summariseSide: summariseFields("{points}"),
  },
  terms: TERMS,
};
