import { describe, expect, it } from "vitest";

import { IMPORT_ALIAS_CLAIMS, IMPORT_FIELDS } from "./import-mapping";

/**
 * ONE ALIAS, ONE FIELD.
 *
 * `FIELD_BY_ALIAS` is built with `flatMap` into a `Map`, so two fields listing
 * the same header is not an error — the last one wins, silently, and a column
 * the organizer never looked at is read into the wrong field. A wrong guess
 * here writes one player's data into another player's row, which is the exact
 * failure the mapping module's own comment says it exists to prevent ("a
 * mapping screen that is usually right and occasionally silently wrong is worse
 * than one that asks").
 *
 * With 22 fields and 140-odd aliases, nobody can check this by reading, and it
 * gets harder with every column added. So it is checked here — the same
 * guardrail the sport registry has for role aliases, for the same reason.
 *
 * There is deliberately NO test that every field has a label:
 * `IMPORT_FIELD_LABELS` is a `Record<ImportField, string>`, so a missing one
 * does not compile. A test that cannot fail is noise dressed as coverage.
 */
describe("the header alias table", () => {
  it("never lets two fields claim one header", () => {
    const byAlias = new Map<string, string[]>();
    for (const [alias, field] of IMPORT_ALIAS_CLAIMS) {
      byAlias.set(alias, [...(byAlias.get(alias) ?? []), field]);
    }
    const shared = [...byAlias.entries()]
      .filter(([, fields]) => new Set(fields).size > 1)
      .map(([alias, fields]) => `${alias} → ${[...new Set(fields)].join(" AND ")}`);
    expect(shared, "the later field wins silently, so one of these is dead").toEqual([]);
  });

  it("claims its own canonical name, so our own export round-trips", () => {
    // The parser reads canonical headers directly, and the mapping screen must
    // agree: a file we exported must map onto itself with no human decision.
    const claimed = new Map(IMPORT_ALIAS_CLAIMS);
    for (const field of IMPORT_FIELDS) {
      expect(claimed.get(field.replace(/_/g, " ")), `${field} does not claim its own name`).toBe(
        field,
      );
    }
  });
});
