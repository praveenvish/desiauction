import { termsOf, type TermDetail } from "./vocabulary";
import { difference, summariseFields, total } from "./tiebreakers";

import type { RoleVocabulary, ScoreFieldSpec, SportPack, Terminology } from "./types";

/**
 * HOCKEY — the fifth pack, and the one that cost nothing at all.
 *
 * Cricket built the contract; football forced three additions; kabaddi added
 * nothing; volleyball was the first with a different SHAPE and was taken
 * unchanged. This one is the case the whole programme was aiming at: field
 * hockey is India's other national game, and adding it was a file of values,
 * two lines in the registry and one INSERT. No schema, no UI, no engine, no
 * helper — every function it needs already existed for football.
 *
 * That is the claim `ADDING_A_SPORT.md` makes to whoever wants the sixth. This
 * file is the evidence, and it is boring on purpose.
 */

export const HOCKEY_ROLE_KEYS = ["goalkeeper", "defender", "midfielder", "forward"] as const;
export type HockeyRole = (typeof HOCKEY_ROLE_KEYS)[number];

/**
 * FOUR ROLES, which are football's four and not by accident: both sports run
 * a keeper, a back line, a middle and a front. The ALIASES are where the two
 * part company — hockey's own vocabulary is full of words football never uses.
 *
 * "Full back", "half" and "link" are the traditional hockey names for the same
 * three lines. "Drag flicker" is a defender: the specialist who takes penalty
 * corners is almost always one, and a club sheet that lists them that way is
 * naming a skill, not a position. Placing them anywhere else would put the
 * team's set-piece taker in the wrong line during an auction.
 */
const ROLE_TERMS: Record<HockeyRole, TermDetail> = {
  goalkeeper: {
    label: "Goalkeeper",
    aliases: ["gk", "keeper", "goalie", "goal keeper", "custodian"],
  },
  defender: {
    label: "Defender",
    aliases: [
      "def",
      "back",
      "full back",
      "fullback",
      "left back",
      "right back",
      "centre back",
      "center back",
      "sweeper",
      "drag flicker",
      "drag flick",
    ],
  },
  midfielder: {
    label: "Midfielder",
    aliases: ["mid", "half", "halfback", "half back", "link", "link man", "centre half"],
  },
  forward: {
    label: "Forward",
    aliases: ["fwd", "striker", "attacker", "winger", "left wing", "right wing", "centre forward"],
  },
};

const ROLES: RoleVocabulary = { required: true, values: termsOf(HOCKEY_ROLE_KEYS, ROLE_TERMS) };

/**
 * ONE NUMBER A SIDE. 30 is the typo net, not a rulebook: a hockey scoreline
 * passes ten only in a mismatch and never twenty, so a two-figure entry is a
 * slipped finger long before it is a result.
 */
const SCORE_FIELDS: readonly ScoreFieldSpec[] = [{ key: "goals", label: "Goals", min: 0, max: 30 }];

const TERMS: Terminology = {
  participant: ["Player", "Players"],
  squad: "Squad",
  fixture: "Match",
  /** Cricket's Ground, kabaddi's Mat, volleyball's Court — and football's word. */
  ground: "Pitch",
};

export const HOCKEY: SportPack = {
  key: "hockey",
  label: "Hockey",
  roles: ROLES,
  /*
   * NO ATTRIBUTES, and for a reason particular to this sport rather than an
   * omission. Cricket records a batting hand and football a preferred foot;
   * hockey has no equivalent, because the RULES remove it — a hockey stick has
   * only one playing face and left-handed sticks are illegal, so every player
   * plays right-handed whatever they write with. There is no handedness to
   * record, which is why no club sheet records one.
   */
  attributes: [],
  result: { scoreFields: SCORE_FIELDS },
  standings: {
    /** The ordinary 3/1/0, which hockey shares with football. */
    points: { win: 3, tie: 1, loss: 0, noResult: 1 },
    tiebreakers: [difference("goals", "GD"), total("goals", "GF")],
    summariseSide: summariseFields("{goals}"),
  },
  terms: TERMS,
};
