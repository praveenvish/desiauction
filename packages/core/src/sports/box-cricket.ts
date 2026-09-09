import { CRICKET } from "./cricket";
import { ballsOf } from "./overs";
import { netRate, summariseFields } from "./tiebreakers";

import type { ScoreFieldSpec, SportPack, Terminology } from "./types";

/**
 * BOX CRICKET — the pack that is mostly another pack, and says so.
 *
 * The corporate and gully format: six to eight a side, five to eight overs,
 * played inside a netted turf enclosure where the walls are in play. It is a
 * real tournament category in India — organizers run "box cricket" as a named
 * thing and would not find their event under Cricket — but it is CRICKET, and
 * pretending otherwise by retyping four roles and two style vocabularies would
 * be copying eighty lines to change two facts.
 *
 * So it borrows. `roles` and `attributes` are cricket's, by reference: the same
 * four positions, the same batting and bowling styles, the same aliases an
 * organizer's spreadsheet uses. What differs is written out below, and it is
 * exactly two things — the word for where it is played, and how big a number
 * can plausibly be.
 *
 * THAT IS THE FINDING. A format this distinct commercially turns out to differ
 * from its parent in a word and a typo net, which is worth knowing before
 * somebody proposes a `parentSport` field to inherit from. Borrowing two
 * members is not a mechanism; it is two lines.
 */

/**
 * The typo net, and the only numbers that move.
 *
 * A box innings is five to eight overs, so 300 runs is far past any real score
 * while still catching a slipped digit, and 400 balls covers the longest format
 * anyone plays. Wickets stay at ten: box sides are usually six to eight, but
 * the format is played eight, ten and eleven a side depending on the venue, and
 * a net that refuses a real scorecard is worse than one that lets a typo
 * through — this is a typo net, not a rulebook.
 */
const SCORE_FIELDS: readonly ScoreFieldSpec[] = [
  { key: "runs", label: "Runs", min: 0, max: 300 },
  { key: "wickets", label: "Wickets", min: 0, max: 10 },
  {
    key: "balls",
    label: "Balls",
    min: 0,
    max: 400,
    entry: { label: "Overs", help: "6.3 — not 6.5 for a half" },
    parse: ballsOf,
  },
];

const TERMS: Terminology = {
  participant: ["Player", "Players"],
  squad: "Squad",
  fixture: "Match",
  /**
   * THE WORD THIS PACK EXISTS FOR. Cricket's Ground, kabaddi's Mat,
   * volleyball's Court, football's Pitch — and the box, which is what everybody
   * who plays this calls the venue they booked.
   */
  ground: "Box",
};

export const BOX_CRICKET: SportPack = {
  key: "box_cricket",
  label: "Box cricket",
  /*
   * CRICKET'S OWN, by reference rather than by copy.
   *
   * A box cricket team sheet is a cricket team sheet: batters, bowlers,
   * all-rounders, a keeper, and the same batting and bowling styles spelled the
   * same ways. Retyping them here would be two vocabularies to keep in step
   * forever, and they would drift — which is the exact failure
   * `sport-vocabulary.test.ts` was written to catch when four files each held
   * their own copy of cricket's four roles.
   */
  roles: CRICKET.roles,
  attributes: CRICKET.attributes,
  result: { scoreFields: SCORE_FIELDS },
  standings: {
    points: { win: 2, tie: 1, loss: 0, noResult: 1 },
    /*
     * Net run rate, on BALLS — cricket's arithmetic, and it matters more here
     * than there. A five-over innings makes every fractional over a larger
     * share of the total, so the decimal-overs mistake `netRate` exists to
     * prevent is proportionally worse in a box than on a ground.
     */
    tiebreakers: [netRate("runs", "balls", 6, "NRR", { key: "net_run_rate" })],
    summariseSide: summariseFields("{runs}/{wickets} ({balls:overs})"),
  },
  terms: TERMS,
};
