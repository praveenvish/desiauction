import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * NO INTERNAL LINK WITH AN EMPTY SEGMENT.
 *
 * The owner's "My plan" door shipped as `/seasons//auction/plan` — the season
 * slug lost from a template literal — on BOTH the auction page and the live
 * room, and stayed broken from 2026-09-03 until a read-through found it: the
 * e2e opened /auction/plan by URL and never clicked the button. A path literal
 * with `//` after its first segment is never intended, so the source says so.
 *
 * Reads files with readFileSync, not grep (a control byte makes grep skip a
 * file silently).
 */
const ROOTS = [join(__dirname), join(__dirname, "..", "components")];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(tsx?|mts)$/.test(entry) && !entry.includes(".test.") ? [full] : [];
  });
}

describe("internal links", () => {
  it("no path literal has an empty segment after its first", () => {
    const offenders: string[] = [];
    for (const file of ROOTS.flatMap(sources)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/[`"']\/[a-z][a-z0-9-]*\/\/[a-z$]/g)) {
        offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
