import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// IP-1_DESIGN §14 DoD: no palette literal outside tokens — enforced, not
// hoped. Every color in component source must be a semantic token reference;
// var(--x, fallback) fallbacks are stripped before scanning (the one
// sanctioned use: ::backdrop cannot reliably inherit custom properties).

const SRC = join(__dirname);
const HEX = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
const SKIP = new Set(["generated", "fonts"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return SKIP.has(entry) ? [] : sourceFiles(path);
    }
    if (/\.(tsx?|css)$/.test(entry) && !/\.test\./.test(entry) && !entry.endsWith(".d.ts")) {
      return [path];
    }
    return [];
  });
}

describe("token purity", () => {
  it("no hex color literals exist outside the token pipeline", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const content = readFileSync(file, "utf8").replace(/var\(--[a-z-]+,\s*[^)]+\)/g, "var()");
      content.split("\n").forEach((line, index) => {
        if (HEX.test(line)) {
          offenders.push(`${file.replace(SRC, "src")}:${String(index + 1)}  ${line.trim()}`);
        }
      });
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  /**
   * The space scale is deliberately gappy — it runs 0, 05, 1..6, 8, 10, 12, 16,
   * 20, 24, with NO --space-7 and NO --space-9. Reaching for one of the missing
   * rungs fails in the worst possible way: an unresolvable var() makes the whole
   * declaration invalid at computed-value time, so `padding: var(--space-3)
   * var(--space-7)` does not fall back to the first value — it drops the padding
   * entirely, silently, with no console warning and no build error. Cheap to
   * mistype, expensive to spot by eye. Caught here instead.
   */
  it("every --space reference resolves to a rung the scale actually defines", () => {
    const scale = new Set(
      readFileSync(join(SRC, "generated", "primitives.css"), "utf8").match(/--space-[0-9]+(?=:)/g),
    );
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          for (const ref of line.match(/--space-[0-9]+/g) ?? []) {
            if (!scale.has(ref)) {
              offenders.push(`${file.replace(SRC, "src")}:${String(index + 1)}  ${ref}`);
            }
          }
        });
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
