/**
 * INITIALS — one idea of a letter for every badge, crest, poster circle and email.
 *
 * An initial is a LETTER, not a character: the leading bracket of "(settled)"
 * is skipped, and so are a Devanagari word's vowel signs, nukta and virama —
 * "रोहित" gives "र", not "रो". A bare letter is what an initial is in Hindi,
 * and it is the one form every renderer draws correctly, shaped or not.
 *
 * There used to be seven of these, each with its own idea of a letter. The
 * poster's kept A–Z only, so every Hindi name became "?" — or, for a name with
 * one English word in it, that word's letter.
 *
 * Which WORDS stays the caller's choice, because two conventions are both
 * right: a person is first and last ("Rohit Gurunath Sharma" → "RS"), a club
 * or a season is its first two words ("Demo Premier League" → "DP").
 *
 * Returns "" when the name has no letter or digit at all; each caller keeps its
 * own fallback ("?", "—", "DA").
 */
export interface InitialsOptions {
  /** "first-last" for a person (default); "first-two" for a club or season. */
  readonly words?: "first-last" | "first-two";
  /** Letters from a one-word name: 1 (default), or 2 for "Pune" → "PU". */
  readonly singleWord?: 1 | 2;
}

const LETTER = /[\p{L}\p{N}]/gu;

function lettersOf(word: string): string[] {
  return word.match(LETTER) ?? [];
}

export function initialsOf(name: string, options: InitialsOptions = {}): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map(lettersOf)
    .filter((letters) => letters.length > 0);
  const first = words[0];
  if (first === undefined) {
    return "";
  }
  let picked: string;
  if (words.length === 1) {
    picked = first.slice(0, options.singleWord ?? 1).join("");
  } else {
    const second = options.words === "first-two" ? words[1] : words[words.length - 1];
    picked = `${first[0] ?? ""}${second?.[0] ?? ""}`;
  }
  return picked.toUpperCase();
}
