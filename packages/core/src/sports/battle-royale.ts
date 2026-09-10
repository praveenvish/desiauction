import { termsOf, type TermDetail } from "./vocabulary";
import { summariseFields, total } from "./tiebreakers";

import type { RoleVocabulary, ScoreFieldSpec, SportPack, Terminology } from "./types";

/**
 * BATTLE ROYALE — the first pack whose fixtures are not two-sided.
 *
 * BGMI and Free Fire are the formats India runs most, and until now the
 * platform could not schedule one at all. Sixteen to twenty-five squads drop
 * into ONE lobby; there is no home, no away, and nothing to be "versus". Every
 * other pack here describes a duel, and `esports.ts` named this as the thing it
 * could not cover.
 *
 * What it needed was not a score field but a SHAPE. `fixtureShape: "lobby"`
 * (0058) says a fixture of this sport has many participants and no sides: the
 * fixture row carries no team ids, the squads live in `fixture_participants`,
 * and a result is where each squad finished rather than one scoreline against
 * another. The rest of this file is ordinary pack data.
 */

/*
 * THE FOUR JOBS A BR SQUAD DIVIDES, and offered rather than demanded.
 *
 * Same reasoning as `esports.ts`: plenty of squads simply do not assign
 * positions, and a pack that forced one would make an organizer invent it. The
 * aliases carry the words the two big titles use for the same job — BGMI says
 * assaulter where Free Fire says rusher — so a roster spelled either way
 * imports without anybody editing a spreadsheet.
 */
export const BATTLE_ROYALE_ROLE_KEYS = ["igl", "assaulter", "support", "sniper"] as const;
export type BattleRoyaleRole = (typeof BATTLE_ROYALE_ROLE_KEYS)[number];

const ROLE_TERMS: Record<BattleRoyaleRole, TermDetail> = {
  igl: {
    label: "In-game leader",
    aliases: ["in game leader", "igl", "shotcaller", "shot caller", "leader", "captain"],
  },
  assaulter: {
    label: "Assaulter",
    aliases: ["assaulter", "assault", "rusher", "entry", "entry fragger", "fragger"],
  },
  /*
   * "Support" is safe HERE where it was not safe in esports.ts. That pack chose
   * "Anchor" because `sport-vocabulary.test.ts` refuses a role label that also
   * appears outside the packs, and the product has a Support page — but the
   * check is per-label across all packs, so once esports took Anchor the word
   * Support was still spoken for. Keep them distinct: this pack's own label is
   * what a BGMI roster says, and both spellings alias to each other's key.
   */
  support: {
    label: "Supporter",
    aliases: ["supporter", "support", "anchor", "utility", "healer"],
  },
  sniper: { label: "Sniper", aliases: ["sniper", "marksman", "scout", "awper"] },
};

const ROLES: RoleVocabulary = {
  required: false,
  values: termsOf(BATTLE_ROYALE_ROLE_KEYS, ROLE_TERMS),
};

/**
 * ONE NUMBER PER SQUAD, and it is not the one that decides the match.
 *
 * A lobby result is a PLACEMENT plus what the squad did on the way there, and
 * placement is not a score field — it lives on the participant row, is bounded
 * by the database, and is the same quantity in every battle royale ever played.
 * Kills are the part that varies by title and by ruleset, so kills are what the
 * pack declares.
 *
 * The bound is the typo net rather than a rule: a hundred players is a full
 * lobby, so no squad can honestly finish above it, and a slipped digit on 7
 * still gets caught at 700.
 */
const SCORE_FIELDS: readonly ScoreFieldSpec[] = [
  { key: "kills", label: "Kills", min: 0, max: 100 },
];

const TERMS: Terminology = {
  participant: ["Player", "Players"],
  /** A Squad, and here the word is literal — BGMI's own term for four players. */
  squad: "Squad",
  /**
   * A MATCH IS A LOBBY, and calling it that on screen is most of what stops an
   * organizer looking for the other team. The word appears wherever the product
   * says "fixture" for cricket.
   */
  fixture: "Lobby",
  /** Not a place. Cricket's Ground, kabaddi's Mat, esports' Server — a Map. */
  ground: "Map",
};

export const BATTLE_ROYALE: SportPack = {
  key: "battle_royale",
  label: "Battle royale",
  /** THE POINT OF THIS PACK. One match, many squads, no sides. */
  fixtureShape: "lobby",
  roles: ROLES,
  /*
   * NO ATTRIBUTES, for exactly the reason esports has none: the one fact every
   * roster records is the in-game name, and that is free text unique to one
   * person rather than a curated set of options. The registration desk's
   * `jersey_name` is already that field.
   */
  attributes: [],
  result: { scoreFields: SCORE_FIELDS },
  standings: {
    /*
     * WIN / TIE / LOSS IS NOT HOW THIS SPORT SCORES, and the honest way to say
     * so is zeroes rather than a plausible-looking 3/1/0 that nothing reads.
     * `points` is required by `StandingsRules` because every duel sport needs
     * it; a lobby fold never consults it — see `foldLobby` — so any number here
     * would be dead data, and a dead 3 is the kind of thing somebody later
     * "fixes" a table around.
     */
    points: { win: 0, tie: 0, loss: 0, noResult: 0 },
    /*
     * THE BGMI ESPORTS TABLE, which Free Fire and most Indian circuits copy:
     * ten for the chicken dinner, then 6-5-4-3-2, then a single point for
     * seventh and eighth. Ninth downwards score nothing, and the two explicit
     * zeroes say so on purpose — a placement past the end of this array already
     * scores nothing, but an organizer reading the file to check their ruleset
     * should not have to infer that from an absence.
     *
     * Kills are one point each, added on top. That is the whole scoring system:
     * a squad that finishes fourth with six kills takes ten, and so does the
     * one that won with nothing.
     */
    lobby: {
      placement: [10, 6, 5, 4, 3, 2, 1, 1, 0, 0],
      perScore: { kills: 1 },
    },
    /** Level on points, the squad that fragged more is ahead. */
    tiebreakers: [total("kills", "Kills")],
    summariseSide: summariseFields("{kills} kills"),
  },
  terms: TERMS,
};
