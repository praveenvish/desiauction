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
  /** Script-aware initials, at most 2 glyph clusters; null when unknowable. */
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

function firstGrapheme(word: string): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const first = segmenter.segment(word)[Symbol.iterator]().next();
  return first.done ? "" : first.value.segment;
}

/** Script-aware initials: first graphemes of the first and last words. */
export function initialsFor(name: string): {
  initials: string | null;
  script: "latin" | "devanagari";
} {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { initials: null, script: "latin" };
  }
  const script = DEVANAGARI.test(name) ? "devanagari" : "latin";
  const first = firstGrapheme(words[0] ?? "");
  const last = words.length > 1 ? firstGrapheme(words[words.length - 1] ?? "") : "";
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
