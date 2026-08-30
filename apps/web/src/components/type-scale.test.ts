import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Type-scale guardrail.
 *
 * Clash Display is a display face: tight apertures, near-zero sidebearings,
 * negative default tracking. It reads as premium at headline sizes and as
 * cramped everywhere else — set at 20px, "Immutable ledger" closes up until
 * the two words touch. The public surfaces the product is modelled on already
 * follow one rule, so it is enforced here rather than hoped for:
 *
 *   the display face is for >= 30px, for brand lockups, or for numerals.
 *
 * Everything else — prose headings, card titles, UI labels — is Geist Sans,
 * which is drawn for exactly that job.
 *
 * The allowlist below is the set of deliberate exceptions. Each one is short,
 * set as a graphic rather than read as running text, and named so that adding
 * to the list is a decision somebody has to write down.
 */

const REPO = join(__dirname, "..", "..", "..", "..");
const ROOTS = [join(REPO, "apps", "web", "src"), join(REPO, "packages", "ui", "src")];
const TOKENS = join(REPO, "packages", "ui", "src", "generated", "primitives.css");

/** Below this, the display face stops looking expensive and starts looking cramped. */
const DISPLAY_FLOOR_PX = 30;

/** Deliberate exceptions: brand lockups, monograms, numerals, and one specimen. */
const ALLOW = [
  // Brand lockups and monograms — a mark, not a sentence.
  ".wordmark",
  // Onboarding's lockup, which is now a LINK home — the page's only escape —
  // rather than the decorative `.onboarding-brand` it replaced. Same case: a
  // mark, not a sentence.
  ".onboarding-mark",
  // The live shell's wordmark beside the mark — a lockup, not a sentence.
  ".live-brand",
  ".home-crest",
  ".public-card-mark",
  ".mk-stage-mark",
  ".glyph",
  // Numerals set for figure impact (money, counts, dates).
  // The schedule-demo step counter — a figure in a circle, not a sentence.
  ".demo-steps li::before",
  ".home-tile-value",
  ".home-date b",
  ".mk-stat-value",
  ".mk-tier-amount",
  ".ceremony-bid",
  // The raise button's amount: a money figure on the owner's one live control,
  // set in the display face so it reads as a number to hit, not a label.
  ".paddle-raise-amount",
  // Pool counters — sold / unsold / remaining. Numerals set for figure impact,
  // the same case as .home-tile-value above.
  ".pool-stats dd",
  // The console summary row's figure. Same case again: a count, compacted to
  // 24px so a row of five tiles fits above the fold.
  ".stat-value",
  // Ceremony graphics: a stamp and the name it lands on.
  ".mk-stage-sold",
  ".mk-stage-name",
  // The design gallery's own type specimen must be able to show the face.
  ".type-sample",
];

const SKIP_DIRS = new Set(["generated", "fonts", "node_modules", ".next"]);

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return SKIP_DIRS.has(entry) ? [] : cssFiles(path);
    }
    return entry.endsWith(".css") ? [path] : [];
  });
}

/** The generated primitives are the single source for what a size token means. */
function tokenSizes(): Map<string, number> {
  const sizes = new Map<string, number>();
  const css = readFileSync(TOKENS, "utf8");
  for (const match of css.matchAll(/(--[a-z0-9-]*-size):\s*([\d.]+)px/g)) {
    sizes.set(match[1] ?? "", Number(match[2]));
  }
  return sizes;
}

/**
 * Resolve a font-size declaration to the largest px value it can render at —
 * the size at which cramping is worst, and the one a reviewer sees on a
 * desktop screen. Returns null when the value is not statically knowable.
 */
function maxPx(value: string, sizes: Map<string, number>): number | null {
  let raw = value.trim();
  const clamp = /clamp\(.*,\s*(.+)\)\s*$/.exec(raw);
  if (clamp?.[1] !== undefined) {
    raw = clamp[1].trim();
  }
  const token = /var\(\s*(--[a-z0-9-]+)/.exec(raw);
  if (token?.[1] !== undefined) {
    return sizes.get(token[1]) ?? null;
  }
  const px = /^([\d.]+)px$/.exec(raw);
  if (px?.[1] !== undefined) {
    return Number(px[1]);
  }
  const rem = /^([\d.]+)rem$/.exec(raw);
  if (rem?.[1] !== undefined) {
    return Number(rem[1]) * 16;
  }
  return null;
}

describe("type scale", () => {
  it("resolves the generated size tokens", () => {
    expect(tokenSizes().get("--text-xl-size")).toBe(20);
  });

  it("reserves the display face for headline sizes, brand marks and numerals", () => {
    const sizes = tokenSizes();
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of cssFiles(root)) {
        const css = readFileSync(file, "utf8");
        for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
          const [, rawSelector = "", body = ""] = rule;
          if (!body.includes("var(--font-display)")) {
            continue;
          }
          const selector = rawSelector.replace(/\/\*[\s\S]*?\*\//g, "").trim();
          if (ALLOW.some((allowed) => selector.includes(allowed))) {
            continue;
          }
          const declared = /font-size:\s*([^;]+);/.exec(body);
          // No font-size here means the rule inherits one; it cannot be judged
          // statically, so it is the author's call rather than a failure.
          if (declared?.[1] === undefined) {
            continue;
          }
          const size = maxPx(declared[1], sizes);
          if (size !== null && size < DISPLAY_FLOOR_PX) {
            const line = css.slice(0, rule.index).split("\n").length;
            offenders.push(
              `${file.replace(REPO, "")}:${String(line)}  ${selector} is ${String(size)}px`,
            );
          }
        }
      }
    }

    expect(
      offenders,
      `The display face is for >=${String(DISPLAY_FLOOR_PX)}px, brand lockups or numerals. ` +
        `Use var(--font-text) here, or add a named exception to ALLOW:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
