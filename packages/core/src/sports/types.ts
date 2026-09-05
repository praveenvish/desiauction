/**
 * WHAT A SPORT IS ALLOWED TO VARY.
 *
 * The auction is sport-agnostic and always was: lots key on a registration id,
 * bids move paise, and nothing between `openLot` and the gavel has ever known
 * what the person on the block plays. The three things a sport DOES contribute
 * were scattered instead — four copies of the playing-role list, two spellings
 * of "All-rounder", the style enums, the alias tables that let a Google Form
 * import succeed, and the score bounds that catch a scorer's typo.
 *
 * This interface is the whole surface. A pack declares vocabulary; it never
 * declares behaviour, and it never reaches for IO or a clock. Everything a pack
 * says is data the rest of the product READS — which is what makes a second
 * sport a file rather than a fork.
 *
 * WHAT IS DELIBERATELY NOT HERE (yet):
 *   · terminology ("player" vs "athlete", "match" vs "tie") — 95 components
 *     say "player" today and none of them read a dictionary; declaring one
 *     nobody consumes would be an abstraction pretending to be a feature. It
 *     lands with the second sport, which is when a wrong guess gets corrected;
 *   · the standings tiebreaker chain — `compareStandings` still walks
 *     points -> net run rate -> wins directly. Generalizing it needs a second
 *     sport to prove the shape;
 *   · anything with a database column behind it. This registry is pure
 *     vocabulary and ships with zero migrations.
 */

import type { PointsPolicy, TiebreakerSpec } from "../standings";

/**
 * How a value is written by a person, versus how we store it.
 *
 * Every vocabulary term carries its own aliases because the import path is
 * where a sport meets reality: a club's registration form says "WK", "Wicket
 * Keeper Batsman" or "stumper", and all three are one stored token. The RH-1
 * rehearsal measured what happens without this — 73 rows imported, 73 styles
 * supplied, 0 stored, and a preview that cheerfully reported "0 errors".
 */
export interface VocabularyTerm {
  /** The stored token. snake_case, stable forever — this is what the DB holds. */
  readonly key: string;
  /** The one spelling every surface shows. There is exactly one. */
  readonly label: string;
  /**
   * Spellings a person actually writes. Case, spaces, hyphens and underscores
   * are normalized away before lookup, so "All Rounder", "all-rounder" and
   * "allrounder" are ONE entry here, not three.
   */
  readonly aliases: readonly string[];
}

/**
 * The playing roles of a sport, and whether it has any.
 *
 * `required: false` is not a formality. Pickleball and table tennis have no
 * meaningful playing role; football has a dozen positions that group into
 * three; kabaddi has two. A four-value NOT NULL enum is wrong in three
 * different directions at once, and the column has to learn to say nothing.
 */
export interface RoleVocabulary {
  /** Does a registration in this sport have to state a role? */
  readonly required: boolean;
  readonly values: readonly VocabularyTerm[];
}

/**
 * Where an attribute's value physically lives.
 *
 * Cricket's `batting_style` and `bowling_style` are real columns with ten
 * consumers, an import mapper and a share card behind them. Moving them into
 * JSON would buy tidiness and risk a regression in the ONE sport that has
 * users, so they stay exactly where they are and the pack records the fact.
 * Every sport added from here on writes to `registrations.attributes` instead
 * (Phase 2), and no surface has to know which is which.
 */
export type AttributeStorage =
  { readonly kind: "column"; readonly column: string } | { readonly kind: "json" };

/** One structured, optional thing a sport knows about a participant. */
export interface AttributeSpec {
  readonly key: string;
  readonly label: string;
  readonly storage: AttributeStorage;
  /** The curated values. An attribute with no options is free text. */
  readonly options: readonly VocabularyTerm[];
  /**
   * Spellings this attribute's COLUMN goes by on a club's registration form.
   *
   * Roles learned this in Phase 0 and attributes had not: an import whose
   * header says "Preferred foot" or "Strong foot" is the same column, and a
   * mapper that knows only the canonical key makes the organizer rename
   * spreadsheet headings by hand — the most repeated task in the product,
   * performed outside it.
   */
  readonly headerAliases: readonly string[];
}

/**
 * One number on a scoreline, and the range a human could plausibly write.
 *
 * The bounds are a typo net, not a rulebook: they exist so a scorer who types
 * an extra digit is stopped before the league table is wrong. Ten wickets is a
 * real limit; 2000 runs is not, and does not pretend to be.
 */
export interface ScoreFieldSpec {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  /**
   * How a SCORER types this, when that differs from how it is stored.
   *
   * Cricket stores balls and every scorer in the world writes overs — "18.3"
   * meaning eighteen overs and three balls. Storing what they type would make
   * net run rate wrong by ~8% per fractional over, and asking them for balls
   * would make the form unusable. So the two are separated: this is the label
   * and the hint the form shows, `parse` below turns what they wrote into what
   * is stored, and the key is what the table computes on.
   */
  readonly entry?: { readonly label: string; readonly help?: string };
  /**
   * Scorer's text to stored number; null when it cannot be read. Omitted means
   * a plain non-negative integer. SERVER-SIDE ONLY — a function cannot cross
   * into a client component, which is why `entry` above is plain data.
   */
  readonly parse?: (raw: string) => number | null;
}

/**
 * WHAT THIS SPORT CALLS THINGS.
 *
 * Phase 0 refused to declare this, on the grounds that 95 components said
 * "player" and none of them read a dictionary — an abstraction nobody consumes
 * is a feature pretending. A second pack is what makes it real: "ground" is
 * wrong for football and "pitch" is wrong for cricket, and the surfaces that
 * show either must ask.
 *
 * Kept deliberately SMALL. Only the nouns that are actually wrong in another
 * sport are here; "team", "season", "auction", "owner", "paddle" and "bid" are
 * the auction's own words and mean the same everywhere, which is the whole
 * reason this platform generalises at all.
 */
export interface Terminology {
  /** Singular and plural: ["Player", "Players"]. */
  readonly participant: readonly [string, string];
  /** What a set of them is called: "Squad". */
  readonly squad: string;
  /** One contest: "Match", "Tie", "Bout". */
  readonly fixture: string;
  /** Where it is played: "Ground", "Pitch", "Court", "Mat". */
  readonly ground: string;
}

/**
 * A SPORT, COMPLETE.
 *
 * One file per sport in `packages/core/src/sports/`. Adding one is a pack, a
 * set of aliases and a seed fixture — not a project.
 */
export interface SportPack {
  /** Stored token; becomes `competitions.sport` in Phase 1. */
  readonly key: string;
  readonly label: string;
  readonly roles: RoleVocabulary;
  readonly attributes: readonly AttributeSpec[];
  readonly result: {
    /** Per-side score components. Cricket: runs, wickets, balls. */
    readonly scoreFields: readonly ScoreFieldSpec[];
  };
  readonly standings: {
    /** What a win, tie, loss and no-result are worth in this sport's leagues. */
    readonly points: PointsPolicy;
    /**
     * Ordered tiebreaks after points — NRR for cricket, goal difference then
     * goals for in football. Phase 0 left `compareStandings` walking cricket's
     * chain directly and said a second sport would prove the shape. It did.
     */
    readonly tiebreakers: readonly TiebreakerSpec[];
    /**
     * A side's totals on one line, so the table shows the numbers BEHIND each
     * tiebreak and a reader can check it rather than trust it.
     *
     * Sport-specific because the honest rendering is: cricket reads "180/20.0"
     * (runs off overs, and overs are balls), football simply "12". A generic
     * "runs: 180, balls: 120" would be correct and unreadable, which is how a
     * league table stops being checked.
     */
    readonly summariseSide: (totals: Readonly<Record<string, number>>) => string;
  };
  readonly terms: Terminology;
}
