import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * THE GENDER MODULE BOUNDARY (PI-1 DoD §5).
 *
 * Gender may DECIDE something in exactly one place: core's eligibility engine.
 * The moment `if (gender === …)` appears in a read model, an action or a page,
 * the single-evaluator design is dead and the scattering the brief's §7 warns
 * about has begun — one surface per bug, forever. This test walks the source
 * the way the UI guardrails walk theirs, and fails on any new comparison.
 *
 * The allowlist is the complete set of legitimate touchers:
 *   eligibility.ts        — the evaluator itself;
 *   player-profile.ts     — the label helper (display words, not decisions);
 *   player/actions.ts     — the input boundary (validating the enum and
 *                           keeping self-described words only when that option
 *                           was picked — coercion, not a decision about a
 *                           person);
 *   cricket-profile-panel — the form's own disclosure (show the self-describe
 *                           box when that option is picked — input UX);
 *   *.test.ts / *.test.tsx — tests exercise the evaluator on purpose.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = resolve(HERE, "../..");
const REPO = resolve(WEB_SRC, "../../..");

const SCAN_ROOTS = [
  WEB_SRC,
  resolve(REPO, "packages/core/src"),
  resolve(REPO, "packages/auction/src"),
  resolve(REPO, "packages/settlement/src"),
  resolve(REPO, "packages/financial-operations/src"),
  resolve(REPO, "packages/ui/src"),
];

const ALLOWED = new Set([
  "packages/core/src/eligibility.ts",
  "packages/core/src/player-profile.ts",
  "apps/web/src/server/player/actions.ts",
  "apps/web/src/app/account/cricket-profile-panel.tsx",
]);

// Comparisons against the gender VALUE literals, either side. Null checks and
// existence checks are not decisions and stay unflagged.
const GENDER_DECISION =
  /(?:===|!==|==|!=)\s*["'`](?:male|female|non_binary|self_described|unspecified)["'`]|["'`](?:male|female|non_binary|self_described|unspecified)["'`]\s*(?:===|!==|==|!=)/;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
}

describe("gender decides things in eligibility.ts and nowhere else", () => {
  it("finds no gender comparison outside the allowlist", () => {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) {
      walk(root, files);
    }
    const offenders: string[] = [];
    for (const file of files) {
      const repoPath = relative(REPO, file);
      if (ALLOWED.has(repoPath) || /\.test\.tsx?$/.test(file)) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      for (const [index, line] of source.split("\n").entries()) {
        if (GENDER_DECISION.test(line)) {
          offenders.push(`${repoPath}:${String(index + 1)} — ${line.trim()}`);
        }
      }
    }
    expect(offenders, "route every gender rule through core/eligibility.ts").toEqual([]);
  });

  it("still sees the evaluator itself, so an engine rename cannot blind the scan", () => {
    const engine = readFileSync(resolve(REPO, "packages/core/src/eligibility.ts"), "utf8");
    expect(GENDER_DECISION.test(engine)).toBe(true);
  });
});
