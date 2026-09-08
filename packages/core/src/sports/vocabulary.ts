import type { VocabularyTerm } from "./types";

/**
 * BUILDING A VOCABULARY, ONCE.
 *
 * Every pack needs to turn "here are my keys, and here is what each one is
 * called and answers to" into `VocabularyTerm[]`. All four wrote the same
 * eight-line helper to do it, which is the duplication this entire programme
 * was started to remove — found, this time, in the files doing the removing.
 *
 * With these, a pack declares its words and nothing else: no generics, no map,
 * no local helper. That is what makes a new pack copyable by somebody who is
 * not a TypeScript programmer.
 */

export interface TermDetail {
  readonly label: string;
  /**
   * The spellings a person actually writes on a registration form. Case,
   * spaces, hyphens and underscores are normalised away before matching, so
   * "All Rounder", "all-rounder" and "allrounder" are ONE entry, not three.
   */
  readonly aliases: readonly string[];
}

/**
 * Keys plus a detail record, in the keys' order.
 *
 * The `Record<K, …>` is what makes the compiler insist every key is described:
 * add a role to the tuple and forget its label, and the build fails here rather
 * than the screen showing a snake_case token to a spectator.
 */
export function termsOf<K extends string>(
  keys: readonly K[],
  details: Record<K, TermDetail>,
): readonly VocabularyTerm[] {
  return keys.map((key) => ({ key, label: details[key].label, aliases: details[key].aliases }));
}

/**
 * Curated attribute options that carry no aliases of their own.
 *
 * A parser matches an option's TOKEN and its LABEL automatically, so a style
 * whose label is the only other spelling anybody uses ("Off-Break") needs no
 * alias list. Use `termsOf` instead when the options genuinely have nicknames.
 */
export function optionsOf<K extends string>(
  keys: readonly K[],
  labels: Record<K, string>,
): readonly VocabularyTerm[] {
  return keys.map((key) => ({ key, label: labels[key], aliases: [] }));
}
