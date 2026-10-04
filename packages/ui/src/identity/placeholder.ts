/**
 * The premium branded placeholder generator (C-25, IP-1_DESIGN §10).
 *
 * Pure and deterministic: the same seed always yields the same mark, across
 * sessions and machines. No human-figure silhouette is representable in this
 * API — a player without a photo gets a branded floodlit mark, never a grey
 * person-shape. Rendering consumes theme-stable `--identity-*` tokens so a
 * player's identity does not change when the theme flips.
 */

export type PlaceholderPattern = "beams" | "arcs" | "crease" | "contour";

export interface PlaceholderIdentity {
  /** Script-aware initials, at most 2 letters; null when unknowable. */
  initials: string | null;
  /** Devanagari names render in the Devanagari-capable display stack. */
  script: "latin" | "devanagari";
  pattern: PlaceholderPattern;
  /** Which of the two accent tones carries the identity edge. */
  accent: "primary" | "soft";
  /** Deterministic 0..359 rotation used by the pattern variant. */
  angle: number;
}

const PATTERNS: readonly PlaceholderPattern[] = ["beams", "arcs", "crease", "contour"];

/** FNV-1a 32-bit — tiny, stable, good spread for our 4×2×360 space. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * A word's first LETTER: a Devanagari word gives its base letter without vowel
 * signs ("रोहित" → "र"). Mirrors `initialsOf` in @desiauction/core (this package
 * does not depend on core): one rule for the badge here, the poster circle and
 * the email, so a player's initials are the same everywhere.
 */
function firstLetter(word: string): string {
  return /[\p{L}\p{N}]/u.exec(word)?.[0] ?? "";
}

/** Script-aware initials: the first letters of the first and last words. */
export function initialsFor(name: string): {
  initials: string | null;
  script: "latin" | "devanagari";
} {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => firstLetter(word) !== "");
  if (words.length === 0) {
    return { initials: null, script: "latin" };
  }
  const script = DEVANAGARI.test(name) ? "devanagari" : "latin";
  const first = firstLetter(words[0] ?? "");
  const last = words.length > 1 ? firstLetter(words[words.length - 1] ?? "") : "";
  const raw = `${first}${last}`;
  if (raw === "") {
    return { initials: null, script };
  }
  return { initials: script === "latin" ? raw.toUpperCase() : raw, script };
}

/**
 * seed: stable player id (ULID) when one exists; the name otherwise.
 * name: display name the initials derive from.
 */
export function placeholderIdentity(seed: string, name: string): PlaceholderIdentity {
  const hash = fnv1a(seed === "" ? name : seed);
  const { initials, script } = initialsFor(name);
  const pattern = PATTERNS[hash % PATTERNS.length] ?? "beams";
  return {
    initials,
    script,
    pattern,
    accent: (hash >>> 4) % 2 === 0 ? "primary" : "soft",
    angle: (hash >>> 8) % 360,
  };
}
