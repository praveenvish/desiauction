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
 * TABLE TENNIS — badminton's structure with table tennis's own vocabulary.
 *
 * The tie shape is the same (rubbers, then games) and needed no more of the
 * contract than badminton did. What is genuinely different is how the sport
 * describes a PLAYER: table tennis classifies by playing style rather than by
 * which rubber somebody turns out in, and by grip, which nothing else here has.
 */

export const TABLE_TENNIS_ROLE_KEYS = ["attacker", "defender", "all_round"] as const;
export type TableTennisRole = (typeof TABLE_TENNIS_ROLE_KEYS)[number];

export const TABLE_TENNIS_GRIP_KEYS = ["shakehand", "penhold"] as const;

/**
 * STYLE, NOT POSITION — the one place this pack parts company with badminton.
 *
 * A table tennis roster does not describe a player by the rubber they play; it
 * describes how they play. An attacker loops and hits from the table, a
 * defender chops from deep, and an all-rounder does both — and those three are
 * what an owner is actually short of, because a squad of nothing but choppers
 * loses to anyone who serves short.
 */
const ROLE_TERMS: Record<TableTennisRole, TermDetail> = {
  attacker: {
    label: "Attacker",
    aliases: ["attack", "attacking", "looper", "loop", "hitter", "offensive", "offense", "offence"],
  },
  defender: {
    label: "Defender",
    aliases: ["defence", "defense", "defensive", "chopper", "chop", "blocker", "counter hitter"],
  },
  all_round: {
    label: "All-round",
    aliases: ["all round", "allround", "all rounder", "both", "utility", "control"],
  },
};

const ROLES: RoleVocabulary = {
  required: true,
  values: termsOf(TABLE_TENNIS_ROLE_KEYS, ROLE_TERMS),
};

/**
 * GRIP, which is table tennis's own per-player fact and has no equivalent in
 * any pack here. It decides which strokes a player has: a penholder's backhand
 * is a different shot from a shakehander's, and a roster notes it the way
 * cricket notes a bowling style.
 */
const ATTRIBUTES: readonly AttributeSpec[] = [
  {
    key: "grip",
    label: "Grip",
    storage: { kind: "json" },
    headerAliases: ["grip", "grip style", "hold", "bat grip"],
    options: optionsOf(TABLE_TENNIS_GRIP_KEYS, {
      shakehand: "Shakehand",
      penhold: "Penhold",
    }),
  },
];

const SCORE_FIELDS: readonly ScoreFieldSpec[] = [
  { key: "rubbers", label: "Rubbers", min: 0, max: 9 },
  { key: "games", label: "Games", min: 0, max: 45 },
];

const TERMS: Terminology = {
  participant: ["Player", "Players"],
  squad: "Squad",
  fixture: "Tie",
  /** Not a court and not a ground. The venue noun for this sport is the table. */
  ground: "Table",
};

export const TABLE_TENNIS: SportPack = {
  key: "table_tennis",
  label: "Table tennis",
  roles: ROLES,
  attributes: ATTRIBUTES,
  result: { scoreFields: SCORE_FIELDS },
  standings: {
    points: { win: 2, tie: 1, loss: 0, noResult: 1 },
    tiebreakers: [difference("rubbers", "RD"), difference("games", "GD")],
    summariseSide: summariseFields("{rubbers} ({games})"),
  },
  terms: TERMS,
};
