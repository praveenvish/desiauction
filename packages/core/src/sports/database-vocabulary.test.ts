import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CRICKET } from "./cricket";
import { roleKeys } from ".";

/**
 * THE COPY THE PACK CANNOT DELETE.
 *
 * `sport-vocabulary.test.ts` hunts second copies of the role list and, when
 * this was written, found six. It could not find the two that matter most,
 * because they are not in its scan roots and could never be removed anyway:
 *
 *   packages/db/src/schema.ts   registrations.role         enum
 *   packages/db/src/schema.ts   player_profiles.default_role enum
 *
 * `packages/db` is a LEAF — the `db-is-a-leaf` dependency rule permits it
 * drizzle, postgres and ulidx and nothing else, so the schema physically cannot
 * import the pack. That rule is right and this test does not argue with it. A
 * column's permitted values are a fact about the database, and the database is
 * the one place in this system that must be able to state its own constraints
 * without asking an application package for permission.
 *
 * So the copy stays and the DRIFT goes. Reading the schema as text is the only
 * check available that does not violate the boundary it is protecting, and it
 * is the same technique the vocabulary guardrail already uses — deliberately
 * with `readFileSync`, never grep, for the reason recorded there.
 *
 * WHEN THIS FAILS, IT IS USUALLY RIGHT AND YOU HAVE WORK TO DO. Adding a role
 * to the pack is not a code change, it is a MIGRATION: the two enums above, and
 * the CHECK constraints behind them in `0036_player_profiles.sql` and
 * `0044_closed_sets_and_indexes.sql`, all describe the same closed set. Phase 2
 * opens `registrations.role` (nullable, no enum) precisely so this stops being
 * true — and when it does, this test should be rewritten to assert the new
 * arrangement, not deleted.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "../../../..");
const SCHEMA = resolve(REPO, "packages/db/src/schema.ts");

/**
 * The string list from `<field>: text("<column>", { enum: [...] })`.
 *
 * Deliberately anchored on the drizzle call rather than on a bare `enum:` — the
 * schema has many enums and only the two named below describe a playing role.
 * Returns null when the column is not found in that shape at all, which is a
 * failure worth reporting distinctly: it means the schema was restructured and
 * this test has quietly stopped looking at anything.
 */
function columnEnum(source: string, column: string): string[] | null {
  const call = new RegExp(
    `text\\(\\s*["']${column}["']\\s*,\\s*\\{[^}]*?enum:\\s*\\[([^\\]]*)\\]`,
    "s",
  );
  const found = call.exec(source);
  if (found === null) {
    return null;
  }
  return [...(found[1] ?? "").matchAll(/["']([^"']+)["']/g)].map((m) => m[1] as string);
}

describe("the database's role vocabulary matches the pack's", () => {
  const source = readFileSync(SCHEMA, "utf8");
  const expected = roleKeys(CRICKET);

  it("finds both role columns in the shape this test can read", () => {
    // Guards the assertions below: a regex that silently matches nothing would
    // make every test in this file pass by looking at an empty list.
    expect(columnEnum(source, "role"), "registrations.role").not.toBeNull();
    expect(columnEnum(source, "default_role"), "player_profiles.default_role").not.toBeNull();
  });

  it("registrations.role permits exactly the pack's roles, in the pack's order", () => {
    expect(columnEnum(source, "role")).toEqual([...expected]);
  });

  it("player_profiles.default_role permits exactly the pack's roles", () => {
    expect(columnEnum(source, "default_role")).toEqual([...expected]);
  });

  /*
   * The schema is only half of it. The CHECK constraints are the half Postgres
   * actually enforces, and a schema edited without a migration is a column that
   * accepts a value the database then refuses — at 11pm, on a registration
   * somebody is trying to submit.
   */
  it("names the migrations that must change alongside the enums", () => {
    const constraints = [
      "packages/db/migrations/0036_player_profiles.sql",
      "packages/db/migrations/0044_closed_sets_and_indexes.sql",
    ];
    for (const file of constraints) {
      const sql = readFileSync(resolve(REPO, file), "utf8");
      // Historical DDL is immutable, so this asserts only that these files are
      // still where the constraints live — the pointer a future migration
      // needs, not a claim that their text should track the pack forever.
      expect(sql, `${file} no longer holds a role CHECK`).toMatch(/CHECK[\s\S]*?role/i);
    }
  });
});
