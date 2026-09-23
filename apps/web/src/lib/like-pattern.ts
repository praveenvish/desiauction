/**
 * WHAT SOMEBODY TYPES INTO A SEARCH BOX IS TEXT, NOT A PATTERN.
 *
 * Every search here is `ilike(column, "%" + term + "%")`, and in a LIKE
 * pattern `%` and `_` are wildcards. Unescaped, a search for "u_19" matched
 * "u119", and a lone "%" or "_" matched every row — on the public directory
 * that is a one-character way to page through everything, and on the heavier
 * admin screens a cheap way to make Postgres do the most work it can. Three
 * modules had grown their own copy of this function and six search sites had
 * none (gate P3); this is the one copy.
 *
 * Backslash is Postgres's default LIKE escape (no ESCAPE clause needed), so it
 * is escaped too — otherwise a trailing "\" would escape the closing `%`.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** "contains this text, literally" — the pattern every search box wants. */
export function containsPattern(term: string): string {
  return `%${escapeLike(term)}%`;
}
