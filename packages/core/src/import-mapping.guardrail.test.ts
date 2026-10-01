import { describe, expect, it } from "vitest";

import {
  IMPORT_ALIAS_CLAIMS,
  IMPORT_FIELDS,
  attributeAliasClaims,
  normalizeHeader,
  type ImportField,
} from "./import-mapping";
import { SPORTS } from "./sports";

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

/**
 * THE SAME RULE, FOR EVERY SPORT'S OWN ATTRIBUTES.
 *
 * A pack's `headerAliases` are looked up AFTER the fixed table, so an alias a
 * fixed field also claims is dead — the column goes to the fixed field and the
 * attribute never sees it. And two attributes of one pack claiming one header
 * is the last-wins trap above, one level down.
 */
describe("every sport's attribute aliases", () => {
  const fixed = new Map(IMPORT_ALIAS_CLAIMS);

  it("are never shadowed by a fixed field", () => {
    const shadowed = SPORTS.flatMap((pack) =>
      attributeAliasClaims(pack)
        .filter(([alias]) => fixed.has(alias))
        .map(([alias, field]) => `${pack.key}: ${alias} → ${fixed.get(alias) ?? ""}, not ${field}`),
    );
    expect(shadowed).toEqual([]);
  });

  it("never claim one header for two attributes of the same pack", () => {
    const shared = SPORTS.flatMap((pack) => {
      const byAlias = new Map<string, Set<string>>();
      for (const [alias, field] of attributeAliasClaims(pack)) {
        byAlias.set(alias, (byAlias.get(alias) ?? new Set()).add(field));
      }
      return [...byAlias.entries()]
        .filter(([, fields]) => fields.size > 1)
        .map(([alias, fields]) => `${pack.key}: ${alias} → ${[...fields].join(" AND ")}`);
    });
    expect(shared).toEqual([]);
  });

  it("of a column-stored attribute are all read by that column's fixed field", () => {
    // Cricket's styles are fixed fields, not `attr:` ones — so every wording
    // the pack gives them must already land there, or the pack is promising a
    // header the import does not keep.
    const missed = SPORTS.flatMap((pack) =>
      pack.attributes.flatMap((attribute) => {
        const storage = attribute.storage;
        if (storage.kind !== "column") {
          return [];
        }
        expect(IMPORT_FIELDS).toContain(storage.column as ImportField);
        return [attribute.key, attribute.label, ...attribute.headerAliases]
          .map(normalizeHeader)
          .filter((alias) => fixed.get(alias) !== storage.column)
          .map((alias) => `${pack.key}: ${alias}`);
      }),
    );
    expect(missed).toEqual([]);
  });
});
