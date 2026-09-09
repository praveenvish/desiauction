import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SPORTS } from ".";

/**
 * THE TWO PROMISES `ADDING_A_SPORT.md` MAKES, HELD TO BY SOMETHING.
 *
 * That document tells whoever wants the fifth sport that it costs one file of
 * values plus one line of SQL. Both halves of that sentence were true when it
 * was written and neither was checked by anything, which is the state a claim
 * is in just before it stops being true.
 *
 *   1. A PACK IS DATA. Every pack contains zero functions — that is what makes
 *      the file copyable by somebody who is not a TypeScript programmer, and
 *      what keeps the arithmetic that is easy to get wrong (the divide-by-zero
 *      in `ratio()` that sorts an unbeaten team to the BOTTOM of the table) in
 *      one reviewed place instead of re-derived per sport. The fifth pack can
 *      quietly reintroduce an inline `compute:` and nothing would notice; the
 *      document would simply become false.
 *
 *   2. A REGISTERED PACK IS A SPORT YOU CAN PICK. Adding a pack is three steps,
 *      and the type system covers only the first two. Miss the migration and
 *      `pnpm verify` still says green while the sport does not exist in the
 *      product — the picker reads the `sports` TABLE, so a pack nothing seeded
 *      is invisible to every organizer. That is the worst shape a failure can
 *      take: silent, green, and only discovered by the person it was built for.
 *
 * Both are static scans, because the alternative — an integration test — would
 * put a database between `packages/core` and a fact about its own source, and
 * `core-is-pure` is right to forbid the import that would take.
 *
 * READ WITH readFileSync, NEVER grep: a file holding a literal control byte is
 * classified as binary and skipped in silence, so a grep-based guardrail passes
 * by refusing to look. Same rule as `sport-vocabulary.test.ts`.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "../../../..");
const PACK_DIR = resolve(REPO, "packages/core/src/sports");
const MIGRATIONS = resolve(REPO, "packages/db/migrations");

/**
 * A pack is a file that writes an object literal as a `SportPack`.
 *
 * Deliberately NOT a list of filenames and NOT a naming convention. An
 * allowlist of files is what `sport-vocabulary.test.ts` used to carry, and it
 * failed the build the day kabaddi arrived purely for existing; a
 * `${key}.ts` rule would refuse a pack whose key is `box_cricket`. The type
 * annotation is the actual definition of a pack, so it is what gets matched —
 * a fifth pack is covered the moment it is written, wherever it lives and
 * whatever it is called.
 *
 * The `{` is load-bearing. Without it the matcher also caught `index.ts`, whose
 * `DEFAULT_SPORT: SportPack = CRICKET` names a pack rather than declaring one —
 * and that file legitimately holds functions, so the scan failed the registry
 * for being a registry.
 */
const IS_PACK = /:\s*SportPack\s*=\s*\{/;

interface Pack {
  readonly file: string;
  readonly source: string;
}

const packs: Pack[] = readdirSync(PACK_DIR)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .map((name) => ({ file: name, source: readFileSync(resolve(PACK_DIR, name), "utf8") }))
  .filter((entry) => IS_PACK.test(entry.source));

/**
 * Comments are prose and prose may say anything.
 *
 * `volleyball.ts` explains that "`tiebreakers` already takes any function of
 * the totals" — a sentence about the contract, in a file that contains no
 * function. A scan that read the raw text would fail that pack for describing
 * itself accurately, and the fix somebody would reach for is deleting the
 * explanation, which is the opposite of what this file is for.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * SQL has comments too, and this scan learned that the hard way.
 *
 * The first version read the raw file, so commenting a seed out left it still
 * counted — the exact mutation this guardrail exists to catch was the one it
 * could not see. Migrations here are heavily commented by design (0047 spends
 * forty lines explaining why the default became a lie), so an example INSERT
 * inside an explanation is a realistic thing to write.
 *
 * Only `--` to end of line and block comments: a label containing a double
 * hyphen would confuse this, and no sport has one.
 */
function withoutSqlComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Every `INSERT INTO "sports"` any migration has ever written. */
interface SeededSport {
  readonly key: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly order: number;
  readonly migration: string;
}

/**
 * Every row of every `INSERT INTO "sports"`, including the multi-row form.
 *
 * This used to be one regex matching a single `VALUES (...)` tuple, which read
 * the FIRST row of a multi-row insert and silently ignored the rest — so a
 * migration seeding three sports registered one and the other two failed this
 * test for a reason that was not their fault. A guardrail that partially reads
 * its input is the same defect it exists to catch, so it is now two steps: find
 * each statement, then take every tuple inside it.
 */
const STATEMENT = /INSERT INTO "sports"[^;]*?VALUES([^;]*);/gi;
const TUPLE = /\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(true|false)\s*,\s*(\d+)\s*\)/g;

const seeded: SeededSport[] = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .flatMap((name) =>
    [
      ...withoutSqlComments(readFileSync(resolve(MIGRATIONS, name), "utf8")).matchAll(STATEMENT),
    ].flatMap((statement) =>
      [...(statement[1] ?? "").matchAll(TUPLE)].map((row) => ({
        key: row[1] as string,
        label: row[2] as string,
        enabled: row[3] === "true",
        order: Number(row[4]),
        migration: name,
      })),
    ),
  );

describe("a pack is data, not code", () => {
  it("finds every registered sport's pack, so nothing is scanned vacuously", () => {
    // The scan is only worth its assertions if it is actually looking at all of
    // them. A pack the matcher missed would pass this file in silence.
    expect(packs.length, `matched ${packs.map((p) => p.file).join(", ")}`).toBe(SPORTS.length);
  });

  it.each(packs.map((pack) => pack.file))("%s declares no functions of its own", (file) => {
    const source = withoutComments(packs.find((pack) => pack.file === file)?.source ?? "");
    expect(
      source,
      "an arrow function here is arithmetic a later pack will re-derive wrongly — declare it with a helper from tiebreakers.ts instead",
    ).not.toMatch(/=>/);
    expect(source, "a pack states values; the library holds the behaviour").not.toMatch(
      /\bfunction\b/,
    );
  });
});

describe("a registered pack is a sport somebody can pick", () => {
  const byKey = new Map(seeded.map((row) => [row.key, row]));

  it.each(SPORTS.map((sport) => sport.key))("%s was switched on by a migration", (key) => {
    expect(
      byKey.get(key),
      "the pack exists and the picker reads the sports TABLE, so without this row the sport is invisible to every organizer while the build stays green",
    ).toBeDefined();
    expect(byKey.get(key)?.enabled, "seeded but disabled is the same silence").toBe(true);
  });

  it("seeds no sport this platform has no pack for", () => {
    // The other direction, and the worse one: a row with no pack is a sport an
    // organizer can SELECT and nothing can then validate a registration for.
    const keys = new Set(SPORTS.map((sport) => sport.key));
    expect(seeded.filter((row) => !keys.has(row.key)).map((row) => row.migration)).toEqual([]);
  });

  it("spells the sport the same in the migration as in the pack", () => {
    // Two labels, one name. The picker renders the DB's; every season-scoped
    // surface renders the pack's. Drift shows one visitor "Box Cricket" and the
    // next "Box cricket" for the same competition.
    expect(SPORTS.map((sport) => [sport.key, byKey.get(sport.key)?.label])).toEqual(
      SPORTS.map((sport) => [sport.key, sport.label]),
    );
  });

  it("gives each sport its own place in the order", () => {
    // sort_order decides the picker's order. Ties leave it to the database,
    // which is free to return them differently between two reads — a list that
    // reshuffles under somebody mid-choice.
    const orders = seeded.map((row) => row.order);
    expect(orders.length, "two sports share a sort_order").toBe(new Set(orders).size);
  });
});
