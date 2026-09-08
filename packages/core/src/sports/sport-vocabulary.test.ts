import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SPORTS } from ".";

/**
 * THE SPORT VOCABULARY BOUNDARY (Phase 0).
 *
 * A sport's words belong to its pack. They did not: the four playing roles were
 * declared in `player-profile.ts`, again in `competition.ts`, again in
 * `apps/web/src/lib/playing-roles.ts` and a fourth time inside
 * `teams-panel.tsx` — and because nobody could see all four at once, two of
 * them spelled `all_rounder` "All-rounder" and two spelled it "All rounder".
 * A player read as one thing on their share card and another in the
 * registrations table, for as long as that lasted.
 *
 * Copies are the disease and drift is the symptom, so this test hunts copies.
 *
 * WHAT COUNTS AS A COPY, precisely — a single domain value in ordinary use is
 * not one, and flagging it would make the test noise:
 *   A. two or more distinct role tokens in one file — that is a list or a map,
 *      never a use;
 *   B. a role LABEL in quotes — the prose spelling belongs to the pack alone,
 *      and this is the offence that actually shipped;
 *   C. any batting/bowling style token — the style enums have exactly one home.
 *
 * READ WITH readFileSync, NEVER grep. `player-profile.ts` holds a deliberate
 * control-character class (`no-control-regex`, in `validateProfileLocation`),
 * which makes grep classify the file as binary and skip it in silence — and
 * that file is where most of this vocabulary used to live. A grep-based version
 * of this test would have passed by refusing to look at the one file that
 * mattered.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "../../../..");

const SCAN_ROOTS = [
  resolve(REPO, "apps/web/src"),
  resolve(REPO, "packages/core/src"),
  resolve(REPO, "packages/auction/src"),
  resolve(REPO, "packages/settlement/src"),
  resolve(REPO, "packages/financial-operations/src"),
  resolve(REPO, "packages/ui/src"),
];

/**
 * The complete set of legitimate holders.
 *
 *   sports/cricket.ts        — the pack itself, which is the point;
 *   ui/identity/player-card  — `packages/ui` is FORBIDDEN to import core by the
 *                              `no-ui-to-core` dependency rule, so its badge
 *                              marks (BAT / BOWL / AR / WK) are a presentation
 *                              enum that cannot read the pack even in principle.
 *                              Its tokens deliberately differ from the stored
 *                              ones and no product surface passes it a real
 *                              registration;
 *   gallery/identity-demo    — sample data for the component gallery, which
 *                              exists to render components without a database.
 */
/*
 * Every pack, by DIRECTORY rather than by name. Naming them one at a time was
 * an artifact of there being one: the third pack failed this test purely for
 * existing, which is friction a phase whose whole claim is "adding a sport is a
 * pack file" should not have. `sports/` IS the sanctioned home for a sport's
 * words — that is the rule, so that is what the allowlist says.
 */
const PACK_DIR = "packages/core/src/sports/";

const ALLOWED = new Set([
  "packages/ui/src/identity/player-card.tsx",
  "apps/web/src/app/gallery/identity-demo.tsx",
  "apps/web/src/content/marketing.ts",
]);

/*
 * EVERY pack's words, not just cricket's. A second pack that nobody guards is a
 * second vocabulary free to spread exactly the way the first one did — which is
 * the whole failure this test was written after.
 */
const ROLE_TOKENS = SPORTS.flatMap((pack) => pack.roles.values.map((role) => role.key));
const ROLE_LABELS = SPORTS.flatMap((pack) => pack.roles.values.map((role) => role.label));
const STYLE_TOKENS = SPORTS.flatMap((pack) =>
  pack.attributes.flatMap((attribute) => attribute.options.map((option) => option.key)),
);

/** A token or label sitting in quotes, which is how a copied list is written. */
function quoted(values: readonly string[]): RegExp {
  const escaped = values.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`["'\`](?:${escaped.join("|")})["'\`]`, "g");
}

const QUOTED_ROLE = quoted(ROLE_TOKENS);
/* Both spellings of the role that drifted, so the losing one cannot come back. */
const QUOTED_LABEL = quoted([...ROLE_LABELS, "All rounder", "Wicket keeper"]);
const QUOTED_STYLE = quoted(STYLE_TOKENS);

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

function sourceFiles(): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    walk(root, files);
  }
  return files.filter((file) => {
    const repoPath = relative(REPO, file);
    return !ALLOWED.has(repoPath) && !repoPath.startsWith(PACK_DIR) && !/\.test\.tsx?$/.test(file);
  });
}

/**
 * Code only. A doc comment EXPLAINING the drift — the ones in this pack and in
 * `player-profile.ts` do exactly that — is not a copy of anything, and a scan
 * that flags prose teaches the next reader to delete the explanation.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function matches(source: string, pattern: RegExp): string[] {
  return [...code(source).matchAll(new RegExp(pattern.source, "g"))].map((match) => match[0]);
}

describe("a sport's words live in its pack and nowhere else", () => {
  it("finds no second copy of the playing-role list", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const found = new Set(matches(readFileSync(file, "utf8"), QUOTED_ROLE));
      if (found.size > 1) {
        offenders.push(`${relative(REPO, file)} — ${[...found].join(" ")}`);
      }
    }
    expect(offenders, "read roles from the sport pack, do not re-list them").toEqual([]);
  });

  it("finds no role label written outside the pack", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      for (const hit of new Set(matches(readFileSync(file, "utf8"), QUOTED_LABEL))) {
        offenders.push(`${relative(REPO, file)} — ${hit}`);
      }
    }
    expect(offenders, "call roleLabel(); a second spelling is how the last one drifted").toEqual(
      [],
    );
  });

  it("finds no batting or bowling style token outside the pack", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      for (const hit of new Set(matches(readFileSync(file, "utf8"), QUOTED_STYLE))) {
        offenders.push(`${relative(REPO, file)} — ${hit}`);
      }
    }
    expect(offenders, "read styles from the sport pack").toEqual([]);
  });

  /* A rename of the pack must not quietly turn this whole test into a no-op. */
  it("still sees the pack itself, so a rename cannot blind the scan", () => {
    const pack = readFileSync(resolve(REPO, "packages/core/src/sports/cricket.ts"), "utf8");
    const second = readFileSync(resolve(REPO, "packages/core/src/sports/football.ts"), "utf8");
    expect(
      matches(second, QUOTED_ROLE).length,
      "football's own tokens are scanned",
    ).toBeGreaterThan(1);
    expect(matches(pack, QUOTED_ROLE).length).toBeGreaterThan(1);
    expect(matches(pack, QUOTED_LABEL).length).toBeGreaterThan(0);
    expect(matches(pack, QUOTED_STYLE).length).toBeGreaterThan(0);
  });

  /* The scan is worthless if the walk silently covers nothing. */
  it("actually walks the product", () => {
    expect(sourceFiles().length).toBeGreaterThan(200);
  });
});
