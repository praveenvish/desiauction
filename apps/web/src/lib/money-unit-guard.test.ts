import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NO SEASON SURFACE WRITES "₹" ITSELF (0091).
 *
 * A season's auction counts in rupees or in points, and every screen that shows
 * a purse, a bid or a price must say it in that season's unit — through
 * `useMoney()` (client), `moneyFormat(unit)` (server) or core's `formatAmount`.
 * The rupee-only helpers print "₹" whatever the season is, and so does a "₹"
 * typed into a label: one of either and a points league reads money it does
 * not owe on its purse board.
 *
 * Seventy-odd files printed rupees when the unit arrived. This keeps the next
 * one out: inside the trees below, a rupee-only helper or a literal "₹" in code
 * (comments are fine) fails — unless rupees are the truth there in every
 * season, which is said where it happens: a `rupees-always: <why>` comment on
 * the line or the line above. Registration fees are real money even in a
 * points league; the settlement books are never opened by one. Files that are
 * wholly books sit on the list below instead.
 *
 * Read with readFileSync, not grep: a stray control byte makes grep skip a file
 * in silence.
 */

const SRC = join(__dirname, "..");

/** Where auction amounts are shown. Marketing, pricing and /gallery are not. */
const ROOTS = [
  "app/seasons",
  "app/home",
  "app/admin/live",
  "app/admin/auctions",
  "app/auctions",
  "app/c",
  "app/tournaments",
  "app/me",
  "app/reports",
  "app/owner-join",
  "app/inbox",
  "components/auction",
  "components/season-hero",
  "server/auction",
  "server/home",
  "server/console",
];

/**
 * Whole files that are the settlement books — never reachable for a points
 * season (the Money tab is gone and every settlement command refuses).
 */
const ALLOW = new Set<string>([
  "app/seasons/[slug]/money/money-panel.tsx",
  "app/seasons/[slug]/money/money-words.ts",
  "app/seasons/[slug]/money/case/[caseId]/case-panel.tsx",
]);

/** Said on the line, or the line above: rupees are right here in every season. */
const MARKER = "rupees-always:";

/** Calls, not imports: an import prints nothing, and every call is vouched for alone. */
const RUPEE_ONLY = [
  /\bexactINR\(/,
  /\bcompactINR\(/,
  /\bcompactFloorINR\(/,
  /\bledgerINR\(/,
  /\bformatPaiseINR\(/,
];

function filesUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** The code with comments blanked out — "₹" in a comment is prose, not output. */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

describe("money-unit guard", () => {
  const files = ROOTS.flatMap((root) => filesUnder(join(SRC, root)));

  it("scans the season surfaces", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no season surface prints rupees whatever the unit", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(SRC, file);
      if (ALLOW.has(rel)) continue;
      const source = readFileSync(file, "utf8");
      const raw = source.split("\n");
      codeOf(source)
        .split("\n")
        .forEach((line, index) => {
          const vouched =
            (raw[index] ?? "").includes(MARKER) || (raw[index - 1] ?? "").includes(MARKER);
          if (vouched) return;
          if (line.includes("₹") || RUPEE_ONLY.some((pattern) => pattern.test(line))) {
            offenders.push(`${rel}:${String(index + 1)}  ${line.trim().slice(0, 100)}`);
          }
        });
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("every allowlisted file still exists", () => {
    const present = new Set(files.map((file) => relative(SRC, file)));
    expect([...ALLOW].filter((rel) => !present.has(rel))).toEqual([]);
  });
});
