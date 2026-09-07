import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * WHERE THE DATABASE STILL NAMES A SPORT, AND WHERE IT NO LONGER MAY.
 *
 * Phase 0 wrote this test to stop `registrations.role` and
 * `player_profiles.default_role` drifting from the cricket pack — two copies a
 * leaf package cannot delete, because `db-is-a-leaf` forbids `packages/db` from
 * importing core and that rule is right.
 *
 * PHASE 2 SPLIT THOSE TWO APART, and the test says so rather than being
 * deleted:
 *
 *   · `registrations.role` is now OPEN — no enum, nullable. It has to be: the
 *     legal values are football's or cricket's depending on the season, and a
 *     column-level list could only ever name one sport's. The pack validates it
 *     instead, because the pack is the only thing that knows which season this
 *     registration belongs to.
 *   · `player_profiles.default_role` is STILL cricket's four. That is not an
 *     oversight and not drift — it is the Phase 3 boundary. A person-level
 *     default role assumes a person plays ONE sport, which is exactly the
 *     assumption Phase 3 removes by splitting the person from the player
 *     (`player_sport_profiles`). Until then the column means "this person's
 *     default CRICKET role", and this test holds it to that.
 *
 * When Phase 3 lands, the second assertion is the one that must change.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "../../../..");
const SCHEMA = resolve(REPO, "packages/db/src/schema.ts");

/** The string list from `text("<column>", { enum: [...] })`, or null if none. */
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

describe("the database's role vocabulary", () => {
  const source = readFileSync(SCHEMA, "utf8");

  it("leaves registrations.role OPEN — no column-level list can name two sports", () => {
    expect(
      columnEnum(source, "role"),
      "an enum here would refuse every football role the pack allows",
    ).toBeNull();
  });

  it("lets registrations.role be absent, because some sports have no roles", () => {
    // `required` is a per-sport fact the pack declares. Cricket and football
    // both say true; pickleball has no meaningful playing role at all, and a
    // NOT NULL column would force it to invent one.
    const declaration = /role: text\("role"\)([^,]*),/.exec(source);
    expect(declaration, "registrations.role is no longer a plain text column").not.toBeNull();
    expect(declaration?.[1] ?? "", "role must not be notNull").not.toContain("notNull");
  });

  /*
   * Phase 3 moved this column out of `player_profiles` entirely. What replaced
   * it must not re-introduce the problem: a per-sport role is validated by that
   * sport's pack, and a column-level list could only ever name one sport's.
   */
  it("leaves the per-sport default_role open too, and off the person", () => {
    expect(columnEnum(source, "default_role"), "no enum on the per-sport role").toBeNull();
    const personTable = source.slice(
      source.indexOf('pgTable("player_profiles"'),
      source.indexOf('pgTable("player_sport_profiles"'),
    );
    expect(personTable, "a person's row holds no sport vocabulary").not.toMatch(/default_role/);
  });

  it("names the migrations that opened the column, for whoever changes it next", () => {
    const opened = readFileSync(
      resolve(REPO, "packages/db/migrations/0047_second_sport.sql"),
      "utf8",
    );
    expect(opened).toMatch(/registrations_role_check/);
    expect(opened).toMatch(/DROP NOT NULL/);
  });
});
