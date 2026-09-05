/**
 * THE SPORT REGISTRY.
 *
 * One place that knows which sports exist, and a small set of pure readers that
 * work against ANY pack. Every helper here takes the pack as its first argument
 * rather than reaching for a default, because that is the shape Phase 1 needs
 * when `competitions.sport` arrives and a caller has a real key in hand. Until
 * then callers pass `DEFAULT_SPORT` and nothing about the product changes.
 *
 * Pure: no IO, no clock, no database. The registry is vocabulary, and
 * vocabulary is a constant.
 */

import { CRICKET } from "./cricket";

import type { AttributeSpec, SportPack, VocabularyTerm } from "./types";

export type {
  AttributeSpec,
  AttributeStorage,
  RoleVocabulary,
  ScoreFieldSpec,
  SportPack,
  VocabularyTerm,
} from "./types";
export {
  CRICKET,
  CRICKET_ROLE_KEYS,
  CRICKET_BATTING_STYLE_KEYS,
  CRICKET_BOWLING_STYLE_KEYS,
} from "./cricket";
export type { CricketRole, CricketBattingStyle, CricketBowlingStyle } from "./cricket";

/** Every sport the platform can run. One entry, honestly, until one is asked for. */
export const SPORTS: readonly SportPack[] = [CRICKET];

/**
 * The pack every caller resolves to until competitions carry a sport (Phase 1).
 *
 * Named rather than assumed: when the column lands, the compiler shows you each
 * place that still hardcodes a sport, and every one of them is a real question
 * about which competition's pack applies.
 */
export const DEFAULT_SPORT_KEY = "cricket";
export const DEFAULT_SPORT: SportPack = CRICKET;

export function isSportKey(value: string): boolean {
  return SPORTS.some((pack) => pack.key === value);
}

/** The pack behind a key, or null — the caller's cue to refuse, not to guess. */
export function sportPack(key: string): SportPack | null {
  return SPORTS.find((pack) => pack.key === key) ?? null;
}

/**
 * THE PACK BEHIND A STORED SPORT KEY (Phase 1).
 *
 * `sportPack` returns null so a CALLER validating input can refuse. This one
 * never refuses, because its callers are read paths rendering a page: a season
 * whose sport has no pack should degrade to the default's labels, not to a 500.
 *
 * In practice the fallback is unreachable — `competitions.sport` carries a
 * foreign key to the `sports` catalogue, and a catalogue row only exists for a
 * pack that shipped. It is here for the one case the FK cannot cover: a pack
 * file deleted while its catalogue row is still enabled, which is a deploy
 * mistake and should look like stale labels rather than an outage.
 */
export function sportPackFor(key: string | null | undefined): SportPack {
  return (key === null || key === undefined ? null : sportPack(key)) ?? DEFAULT_SPORT;
}

/**
 * Comparable form of a vocabulary value.
 *
 * Case, spaces, hyphens and underscores are noise: a form builder writes "All
 * Rounder", a spreadsheet writes "all-rounder", the database holds
 * "all_rounder", and all three are one answer. Carried over unchanged from
 * `player-profile.ts`, where it was called `normalizeStyleKey`.
 */
export function normalizeVocabularyKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, "");
}

/**
 * Token, label and every alias, all pointing at the token.
 *
 * Built once per term list and cached against the list's own identity, so a
 * pack pays for its maps on first use and never again.
 */
const LOOKUPS = new WeakMap<readonly VocabularyTerm[], ReadonlyMap<string, string>>();

function lookupFor(terms: readonly VocabularyTerm[]): ReadonlyMap<string, string> {
  const cached = LOOKUPS.get(terms);
  if (cached !== undefined) {
    return cached;
  }
  const map = new Map<string, string>();
  for (const term of terms) {
    map.set(normalizeVocabularyKey(term.key), term.key);
    map.set(normalizeVocabularyKey(term.label), term.key);
    for (const alias of term.aliases) {
      map.set(normalizeVocabularyKey(alias), term.key);
    }
  }
  LOOKUPS.set(terms, map);
  return map;
}

function termLabel(terms: readonly VocabularyTerm[], key: string): string | null {
  return terms.find((term) => term.key === key)?.label ?? null;
}

// --- Roles -------------------------------------------------------------------

/** The stored role tokens, in the order the pack declares them. */
export function roleKeys(pack: SportPack): readonly string[] {
  return pack.roles.values.map((role) => role.key);
}

/** Is this one of the pack's roles? Exact token match, never a spelling. */
export function isRoleIn(pack: SportPack, value: string): boolean {
  return pack.roles.values.some((role) => role.key === value);
}

/**
 * The canonical role behind a token, a label, or the way it is written on a
 * registration form — else null, which is the caller's cue to REPORT the value
 * back rather than drop the row.
 */
export function parseRoleIn(pack: SportPack, value: string): string | null {
  return lookupFor(pack.roles.values).get(normalizeVocabularyKey(value)) ?? null;
}

/**
 * The one spelling of a role that any surface shows.
 *
 * An unknown token comes back readable ("left_wing" -> "left wing") rather than
 * raw. Cricket cannot currently store an unknown role — the column's enum
 * refuses one — but a sport whose roles are open-ended can, and a screen
 * printing a snake_case token at a spectator is a bug waiting for Phase 2.
 */
export function roleLabelIn(pack: SportPack, role: string): string {
  return termLabel(pack.roles.values, role) ?? role.replace(/_/g, " ");
}

// --- Attributes --------------------------------------------------------------

export function attributeSpec(pack: SportPack, key: string): AttributeSpec | null {
  return pack.attributes.find((attribute) => attribute.key === key) ?? null;
}

/** The curated option tokens for one attribute; empty for free text or unknown. */
export function attributeOptionKeys(pack: SportPack, key: string): readonly string[] {
  return attributeSpec(pack, key)?.options.map((option) => option.key) ?? [];
}

export function isAttributeValueIn(pack: SportPack, key: string, value: string): boolean {
  return attributeOptionKeys(pack, key).includes(value);
}

/** As `parseRoleIn`, for one attribute's options. Null means "could not place". */
export function parseAttributeIn(pack: SportPack, key: string, value: string): string | null {
  const spec = attributeSpec(pack, key);
  if (spec === null) {
    return null;
  }
  return lookupFor(spec.options).get(normalizeVocabularyKey(value)) ?? null;
}

/**
 * Label a value belonging to ANY of the pack's attributes.
 *
 * The pack's option key sets are disjoint, so one formatter serves the showcase,
 * the player page and the share card without being told which attribute it is
 * looking at. Unknown and legacy values pass through unchanged; null stays null.
 */
export function attributeOptionLabel(pack: SportPack, value: string | null): string | null {
  if (value === null) {
    return null;
  }
  for (const attribute of pack.attributes) {
    const label = termLabel(attribute.options, value);
    if (label !== null) {
      return label;
    }
  }
  return value;
}

// --- Results -----------------------------------------------------------------

/**
 * Is every supplied score component inside the range a person could plausibly
 * write? Absent values are not implausible — a fixture may record no score at
 * all, and "did not say" is different from "said something impossible".
 */
export function scoreWithinBounds(
  pack: SportPack,
  score: Readonly<Record<string, number | null | undefined>>,
): boolean {
  for (const field of pack.result.scoreFields) {
    const value = score[field.key];
    if (value != null && (value < field.min || value > field.max)) {
      return false;
    }
  }
  return true;
}
