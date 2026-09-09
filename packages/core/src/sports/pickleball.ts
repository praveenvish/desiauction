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
 * PICKLEBALL — the third racquet pack, and the one that proves the shape is
 * now boring.
 *
 * Badminton established that a team tie is rubbers and games, table tennis
 * showed the same skeleton carrying a different vocabulary, and this one is a
 * file of values on top of both. That is the state a contract should reach: the
 * third sport of a family costs nothing to think about.
 */

export const PICKLEBALL_ROLE_KEYS = ["singles", "doubles", "all_court"] as const;
export type PickleballRole = (typeof PICKLEBALL_ROLE_KEYS)[number];

export const PICKLEBALL_HAND_KEYS = ["right", "left"] as const;

/**
 * Doubles is the DEFAULT here, not the specialism, which is the one way this
 * differs from badminton in practice — almost all pickleball is played four to
 * a court. The roles are the same three because a team tie still has to fill a
 * singles rubber, and an owner is still short of whoever can play it.
 */
const ROLE_TERMS: Record<PickleballRole, TermDetail> = {
  singles: { label: "Singles", aliases: ["single", "singles specialist", "one v one", "1v1"] },
  doubles: {
    label: "Doubles",
    aliases: ["double", "doubles specialist", "mixed", "mixed doubles", "two v two", "2v2"],
  },
  all_court: {
    label: "All-court",
    aliases: ["all court", "allcourt", "both", "utility", "singles and doubles"],
  },
};

const ROLES: RoleVocabulary = { required: true, values: termsOf(PICKLEBALL_ROLE_KEYS, ROLE_TERMS) };

const ATTRIBUTES: readonly AttributeSpec[] = [
  {
    key: "playing_hand",
    label: "Playing hand",
    storage: { kind: "json" },
    headerAliases: ["playing hand", "hand", "handedness", "paddle hand"],
    options: optionsOf(PICKLEBALL_HAND_KEYS, { right: "Right handed", left: "Left handed" }),
  },
];

const SCORE_FIELDS: readonly ScoreFieldSpec[] = [
  { key: "rubbers", label: "Rubbers", min: 0, max: 9 },
  { key: "games", label: "Games", min: 0, max: 30 },
];

const TERMS: Terminology = {
  participant: ["Player", "Players"],
  squad: "Squad",
  fixture: "Tie",
  ground: "Court",
};

export const PICKLEBALL: SportPack = {
  key: "pickleball",
  label: "Pickleball",
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
