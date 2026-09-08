import { termsOf, type TermDetail } from "./vocabulary";
import { difference, summariseFields, total } from "./tiebreakers";

import type {
  AttributeSpec,
  RoleVocabulary,
  ScoreFieldSpec,
  SportPack,
  Terminology,
} from "./types";

/**
 * FOOTBALL — the second pack, and the one that had to prove the first was right.
 *
 * Phase 0 built the SportPack contract from cricket alone, which is the cheapest
 * way to design an abstraction that fits exactly one thing. This file is the
 * test of it, and the honest report is in the three places the contract had to
 * grow rather than bend:
 *
 *   1. TERMINOLOGY. Cricket plays on a Ground, football on a Pitch. Phase 0
 *      deliberately declared no dictionary because nothing consumed one; a
 *      second sport is what made "ground" a wrong word rather than a neutral
 *      one, so `terms` exists now and did not before.
 *   2. TIEBREAKERS. Cricket's net run rate was hard-wired into
 *      `compareStandings`. Football breaks ties on goal difference and then on
 *      goals scored, and neither is a rate at all — so the chain became a
 *      declared, ordered list and the league table stopped knowing what a sport
 *      is.
 *   3. POINTS. Cricket's default is 2/1/0; football's is 3/1/0. That one needed
 *      no change at all — `PointsPolicy` was already an injected value, which
 *      is the single piece of foresight this whole programme inherited.
 *
 * What did NOT have to change is the more useful finding: roles, aliases,
 * attributes, score fields and their bounds all took football unmodified. The
 * auction, the purse, settlement and every lifecycle took it without noticing.
 */

export const FOOTBALL_ROLE_KEYS = ["goalkeeper", "defender", "midfielder", "forward"] as const;
export type FootballRole = (typeof FOOTBALL_ROLE_KEYS)[number];

export const FOOTBALL_FOOT_KEYS = ["right", "left", "both"] as const;
export type FootballFoot = (typeof FOOTBALL_FOOT_KEYS)[number];

/**
 * FOUR POSITIONS, NOT ELEVEN.
 *
 * A team sheet distinguishes a left-back from a right-back; an AUCTION does
 * not. What an owner is buying against is the shape of a squad — do we have a
 * keeper, are we short at the back — and the finer position is detail the
 * squad's own team sheet carries. Eleven roles would make the auction plan's
 * role tally unreadable and every registration form longer for no decision.
 *
 * So the specific positions are ALIASES that collapse to the four groups, the
 * same way cricket folds "leg spinner" into bowler. An organizer importing a
 * spreadsheet full of "CB", "LB" and "RWB" gets defenders, and nobody retypes a
 * column.
 */
const ROLE_TERMS: Record<FootballRole, TermDetail> = {
  goalkeeper: {
    label: "Goalkeeper",
    aliases: ["gk", "keeper", "goalie", "goal keeper", "gollie", "custodian"],
  },
  defender: {
    label: "Defender",
    aliases: [
      "def",
      "defence",
      "defense",
      "back",
      "cb",
      "centre back",
      "center back",
      "central defender",
      "lb",
      "left back",
      "rb",
      "right back",
      "full back",
      "wing back",
      "lwb",
      "rwb",
      "sweeper",
      "stopper",
    ],
  },
  midfielder: {
    label: "Midfielder",
    aliases: [
      "mid",
      "midfield",
      "cm",
      "central midfielder",
      "dm",
      "cdm",
      "defensive midfielder",
      "am",
      "cam",
      "attacking midfielder",
      "lm",
      "rm",
      "playmaker",
      "box to box",
    ],
  },
  forward: {
    label: "Forward",
    aliases: [
      "fwd",
      "attacker",
      "attack",
      "striker",
      "st",
      "cf",
      "centre forward",
      "center forward",
      "winger",
      "lw",
      "rw",
      "left winger",
      "right winger",
      "second striker",
      "poacher",
    ],
  },
};

const ROLES: RoleVocabulary = {
  /*
   * Required, like cricket's. A football auction is exactly the place a role
   * decides something: an owner with no goalkeeper has a problem the plan
   * screen should have told them about, and it can only do that if every lot
   * carries one.
   */
  required: true,
  values: termsOf(FOOTBALL_ROLE_KEYS, ROLE_TERMS),
};

/**
 * Preferred foot — football's equivalent of a batting style, and the first
 * attribute on this platform stored as JSON rather than in a column of its own.
 *
 * Cricket's two styles predate the registry and keep their columns (see
 * `AttributeStorage` in types.ts); everything from here on lives in
 * `registrations.attributes`, so adding a sport never again costs a migration.
 */
const ATTRIBUTES: readonly AttributeSpec[] = [
  {
    key: "preferred_foot",
    label: "Preferred foot",
    storage: { kind: "json" },
    headerAliases: ["preferred foot", "strong foot", "foot", "footedness", "dominant foot"],
    options: termsOf(FOOTBALL_FOOT_KEYS, {
      right: { label: "Right footed", aliases: ["right foot", "righty"] },
      left: { label: "Left footed", aliases: ["left foot", "lefty"] },
      both: { label: "Both feet", aliases: ["either", "two footed", "both feet"] },
    }),
  },
];

/**
 * ONE NUMBER A SIDE, where cricket needs three.
 *
 * Goals, and nothing else. A shootout is deliberately NOT a score component:
 * penalties decide who progresses in a knockout, they are not goals, and
 * folding them in here would put them into goal difference and quietly corrupt
 * the league table. The existing `method` column carries "penalties" — the same
 * column cricket uses for "DLS".
 *
 * 99 is the typo net, not a rulebook. It is the point past which a number is
 * certainly a slipped finger, which is all cricket's 2000 runs ever claimed.
 */
const SCORE_FIELDS: readonly ScoreFieldSpec[] = [{ key: "goals", label: "Goals", min: 0, max: 99 }];

const TERMS: Terminology = {
  participant: ["Player", "Players"],
  squad: "Squad",
  fixture: "Match",
  ground: "Pitch",
};

export const FOOTBALL: SportPack = {
  key: "football",
  label: "Football",
  roles: ROLES,
  attributes: ATTRIBUTES,
  result: { scoreFields: SCORE_FIELDS },
  standings: {
    /*
     * THREE POINTS FOR A WIN. Not cricket's two — the change that reshaped how
     * football is played, and the reason `PointsPolicy` being an injected value
     * rather than a constant is the one piece of foresight this programme
     * inherited rather than built.
     *
     * A no-result shares a point like a draw. Most leagues replay an abandoned
     * match instead, and when one asks for that it is a value here, not a fork.
     */
    points: { win: 3, tie: 1, loss: 0, noResult: 1 },
    /* Goal difference, then goals scored — the order every league uses. */
    tiebreakers: [difference("goals", "GD", { key: "goal_difference" }), total("goals", "GF")],
    summariseSide: summariseFields("{goals}"),
  },
  terms: TERMS,
};
