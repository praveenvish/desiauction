import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { woffToSfnt } from "./woff";

/**
 * DEVANAGARI, SHAPED THE WAY A BROWSER SHAPES IT.
 *
 * Satori — the rasterizer behind every poster and share image — places one
 * glyph per character, in the order the characters were typed. Devanagari is
 * not written that way: the vowel sign ि is typed AFTER its consonant and drawn
 * BEFORE it, and a consonant + virama + consonant is drawn as one joined
 * letter. So "कपिल" came out "कपलि" and "ऋद्धि" came out "ऋदधि", on every
 * poster a Hindi-speaking club ever made.
 *
 * HarfBuzz — the shaping engine inside Chrome and Android — does that work
 * here, from the same Anek Devanagari face the posters already carry, and
 * hands back the glyphs in drawing order with their positions. Each CLUSTER
 * (a letter with its signs, a joined letter) comes back as one outline, so
 * whatever draws it next can never split one apart.
 */

/** A path command in font units, y up — the convention of a font's own outlines. */
export interface OutlineCommand {
  readonly type: "M" | "L" | "Q" | "C" | "Z";
  readonly values: readonly number[];
}

export interface ShapedCluster {
  /** Identical clusters share a key, so a poster draws each one once. */
  readonly key: string;
  /** Pen advance in font units, kerning included. */
  readonly advance: number;
  /** Every glyph of the cluster, already moved to where HarfBuzz placed it. */
  readonly outline: readonly OutlineCommand[];
}

export interface Shaper {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  shape(run: string): ShapedCluster[];
}

/**
 * A run this module shapes: Devanagari letters and signs, the dandas and Vedic
 * marks Devanagari shares, and the joiners that steer conjunct forms (ZWJ, ZWNJ). Spaces, digits and
 * Latin are left for the rasterizer's own fonts.
 */
export const DEVANAGARI_RUN = /[\p{Script_Extensions=Devanagari}‌‍]+/gu;

const HAS_DEVANAGARI = /\p{Script=Devanagari}/u;

export function hasDevanagari(text: string): boolean {
  return HAS_DEVANAGARI.test(text);
}

const FONT = join(process.cwd(), "public", "fonts", "poster", "anek-devanagari-600.woff");

let loading: Promise<Shaper> | null = null;

/** One HarfBuzz instance per process: the wasm and the face load once. */
export function devanagariShaper(): Promise<Shaper> {
  loading ??= load().catch((error: unknown) => {
    // A failed load is not cached, so a transient read error is retried.
    loading = null;
    throw error;
  });
  return loading;
}

async function load(): Promise<Shaper> {
  const hb = await import("harfbuzzjs");
  const sfnt = woffToSfnt(await readFile(FONT));
  const face = new hb.Face(new hb.Blob(sfnt));
  const font = new hb.Font(face);
  const extents = font.hExtents();
  const outlines = new Map<number, OutlineCommand[]>();
  const outlineOf = (glyph: number): OutlineCommand[] => {
    let commands = outlines.get(glyph);
    if (commands === undefined) {
      commands = parsePath(font.glyphToPath(glyph));
      outlines.set(glyph, commands);
    }
    return commands;
  };

  return {
    unitsPerEm: face.upem,
    ascender: extents.ascender,
    descender: extents.descender,
    shape(run: string): ShapedCluster[] {
      const buffer = new hb.Buffer();
      buffer.addText(run);
      buffer.guessSegmentProperties();
      hb.shape(font, buffer);
      const infos = buffer.getGlyphInfos();
      const positions = buffer.getGlyphPositions();

      // Glyphs sharing a cluster value belong together: HarfBuzz merges a
      // reordered vowel sign into the cluster of the letter it now precedes.
      const clusters: ShapedCluster[] = [];
      let start = 0;
      while (start < infos.length) {
        const id = infos[start]?.cluster;
        let end = start;
        while (end < infos.length && infos[end]?.cluster === id) {
          end++;
        }
        let pen = 0;
        const outline: OutlineCommand[] = [];
        const parts: string[] = [];
        for (let at = start; at < end; at++) {
          const glyph = infos[at]?.codepoint ?? 0;
          const position = positions[at];
          const dx = pen + (position?.xOffset ?? 0);
          const dy = position?.yOffset ?? 0;
          outline.push(...moved(outlineOf(glyph), dx, dy));
          parts.push(`${String(glyph)}@${String(dx)},${String(dy)}`);
          pen += position?.xAdvance ?? 0;
        }
        clusters.push({ key: `${parts.join(" ")}+${String(pen)}`, advance: pen, outline });
        start = end;
      }
      return clusters;
    },
  };
}

function moved(commands: readonly OutlineCommand[], dx: number, dy: number): OutlineCommand[] {
  if (dx === 0 && dy === 0) {
    return [...commands];
  }
  return commands.map((command) => ({
    type: command.type,
    values: command.values.map((value, index) => value + (index % 2 === 0 ? dx : dy)),
  }));
}

/** HarfBuzz's `glyphToPath` output: absolute M/L/Q/C/Z, numbers comma- or space-separated. */
export function parsePath(path: string): OutlineCommand[] {
  const commands: OutlineCommand[] = [];
  for (const match of path.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
    const type = match[1] as OutlineCommand["type"];
    const values = (match[2] ?? "").match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
    commands.push({ type, values });
  }
  return commands;
}
