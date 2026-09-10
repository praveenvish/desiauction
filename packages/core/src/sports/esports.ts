import { termsOf, type TermDetail } from "./vocabulary";
import { difference, summariseFields } from "./tiebreakers";

import type { RoleVocabulary, ScoreFieldSpec, SportPack, Terminology } from "./types";

/**
 * ESPORTS — the first pack where a role is OPTIONAL, and the first to rename a
 * squad.
 *
 * `RoleVocabulary.required` has been part of the contract since Phase 0 and no
 * shipped pack has ever set it false; the branch was reachable only from a
 * synthetic test pack. It is false here because it has to be. "Esports" is not
 * one game: a Valorant roster has duelists and controllers, a BGMI squad has
 * assaulters and snipers, and a FIFA ladder has neither because it is one
 * person. A pack that forced a position on all three would make an organizer
 * invent one, which is the mistake kabaddi's pack declined to make about
 * attributes.
 *
 * So the four below are offered and not demanded. They are the roles the TEAM
 * SHOOTER formats share — the ones India actually runs — and a league whose
 * game has no positions leaves the column blank and imports cleanly.
 */

export const ESPORTS_ROLE_KEYS = ["igl", "entry", "anchor", "sniper"] as const;
export type EsportsRole = (typeof ESPORTS_ROLE_KEYS)[number];

const ROLE_TERMS: Record<EsportsRole, TermDetail> = {
  igl: {
    label: "In-game leader",
    aliases: ["in game leader", "igl", "shotcaller", "shot caller", "captain", "leader"],
  },
  entry: {
    label: "Entry fragger",
    aliases: ["entry fragger", "entry", "fragger", "assaulter", "assault", "rusher", "duelist"],
  },
  /*
   * ANCHOR, not "Support" — which is what this role is called almost
   * everywhere, and exactly why it cannot be the label here. The product has a
   * Support page in its own navigation, and `sport-vocabulary.test.ts` refuses
   * a role label that appears outside the pack for good reason: two meanings of
   * one word on one screen is how vocabulary drifts. "Anchor" is BGMI's term
   * for the same job, which is the format India actually runs, and "support"
   * stays as an alias so a roster spelled that way still imports.
   */
  anchor: {
    label: "Anchor",
    aliases: ["anchor", "support", "controller", "initiator", "sentinel", "utility"],
  },
  sniper: { label: "Sniper", aliases: ["sniper", "awper", "awp", "marksman", "scout"] },
};

const ROLES: RoleVocabulary = {
  /*
   * FALSE, and the first pack to say so. See the header: the games this covers
   * do not agree on whether a player has a position at all, and a 1v1 FIFA
   * ladder has none by construction.
   */
  required: false,
  values: termsOf(ESPORTS_ROLE_KEYS, ROLE_TERMS),
};

/**
 * TWO NUMBERS A SIDE, the same shape volleyball needed.
 *
 * `maps` decides the match — a best-of-three or best-of-five — and `rounds` is
 * the running total across them, which is what separates teams level on maps.
 * A scorer reading a finished series has both in front of them.
 *
 * Bounds are the typo net: seven maps is the longest series anyone plays, and
 * 200 rounds is far past a best-of-five of any round-based title while still
 * catching a slipped digit.
 */
const SCORE_FIELDS: readonly ScoreFieldSpec[] = [
  { key: "maps", label: "Maps", min: 0, max: 7 },
  { key: "rounds", label: "Rounds", min: 0, max: 200 },
];

const TERMS: Terminology = {
  participant: ["Player", "Players"],
  /**
   * THE FIRST PACK TO CHANGE THIS WORD. Every other sport fields a Squad;
   * esports fields a Roster, and that is the word on every org's own site.
   */
  squad: "Roster",
  fixture: "Match",
  /** Not a place. Cricket's Ground, kabaddi's Mat — and a server. */
  ground: "Server",
};

export const ESPORTS: SportPack = {
  key: "esports",
  label: "Esports",
  roles: ROLES,
  /*
   * NO ATTRIBUTES, though the temptation here is real.
   *
   * The one fact every esports roster records is the IN-GAME NAME, and it is
   * not an attribute: `attributes` are CURATED OPTIONS — a batting hand, a
   * preferred foot, a set of values a dropdown can offer — and an IGN is free
   * text unique to one person. The registration desk's `jersey_name` ("name on
   * the shirt") is already exactly that field and is what an organizer should
   * map an IGN column onto.
   *
   * Platform (PC / mobile / console) is a curated set and was considered, but
   * it is a fact about the TOURNAMENT rather than the player — a BGMI event is
   * mobile for everybody in it — so it would be the same answer on every row.
   */
  attributes: [],
  result: { scoreFields: SCORE_FIELDS },
  standings: {
    /*
     * 3 / 1 / 0. A drawn series is reachable here, unlike volleyball's or
     * basketball's: plenty of round-based titles allow a drawn map and plenty
     * of leagues let a best-of-two finish 1-1.
     */
    points: { win: 3, tie: 1, loss: 0, noResult: 1 },
    /** Map difference, then round difference — the order esports tables use. */
    tiebreakers: [
      difference("maps", "MD", { key: "map_difference" }),
      difference("rounds", "RD", { key: "round_difference" }),
    ],
    summariseSide: summariseFields("{maps} ({rounds})"),
  },
  terms: TERMS,
  /*
   * WHAT THIS PACK DOES NOT COVER, and it is the format India runs most.
   *
   * BATTLE ROYALE — BGMI, Free Fire — has no two-sided fixture at all. Sixteen
   * to twenty-five squads drop into ONE lobby and are scored on placement plus
   * kills; there is no home and no away.
   *
   * IT NOW HAS ITS OWN PACK. `battle-royale.ts` (SP-1 Phase 5) declares
   * `fixtureShape: "lobby"`, which 0058 gave the contract: a lobby fixture
   * carries no team ids, its squads live in `fixture_participants`, and its
   * result is a placement each rather than one scoreline against another. The
   * paragraph that used to stand here said no pack file could fix it, which was
   * true — the fix was a shape, not a file.
   *
   * This pack stays where it is. Team shooters and battle royale are different
   * competitions with different score sheets, and folding both into one
   * "esports" would put an `if` in front of every rule in it.
   */
};
