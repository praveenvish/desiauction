"use client";

import { normalizeHeader, type UnplacedValue, type ValueMaps } from "@desiauction/core";
import { Badge } from "@desiauction/ui";

/**
 * THE OTHER HALF OF COLUMN MAPPING.
 *
 * `ColumnMapper` translates the file's HEADERS into ours. It does nothing about
 * what is written UNDER them, and for a closed vocabulary that is the half that
 * actually stops an import. A club whose price bands are "Category 1/2/3"
 * against a season configured for A/B/C got `unknown base price band` on all
 * two hundred rows, and the product's only answer was: leave, edit the
 * spreadsheet in Excel, come back. Same for a team called "Arrows" where the
 * season spells it "Andheri Arrows".
 *
 * WHAT ALIASES CANNOT DO. `parseRoleIn` knows "CB" and "Wicket Keeper Batsman";
 * `parseFeeStatus` knows "done". Those are predictable and shipped in the repo.
 * What no table here could ever know is a vocabulary invented per season — the
 * bands this organizer configured last week, the names they gave four teams
 * yesterday. Those need a person, once, and then remembering.
 *
 * NOTHING IS PRE-SELECTED. Every row opens on "Leave it" rather than a guess,
 * for the reason the column mapper gives about guessing twice: a wrong answer
 * here writes one player into another's band or another's squad, quietly, on a
 * screen the organizer was told to trust. "Category 1" → A is obvious to a
 * human and unguessable by us.
 */
export function ValueMapper({
  unplaced,
  valueMaps,
  onChange,
}: {
  unplaced: readonly UnplacedValue[];
  valueMaps: ValueMaps;
  onChange: (next: ValueMaps) => void;
}) {
  if (unplaced.length === 0) {
    return null;
  }

  const choose = (entry: UnplacedValue, to: string): void => {
    // Keyed the way `applyMapping` reads it back — normalized, so the same
    // value spelled with different spacing or case in another row is placed
    // too. A club's sheet holds "Category 1" and "category 1"; the organizer
    // answered once and meant both.
    const key = normalizeHeader(entry.value);
    // Built by FILTERING rather than deleting, the same way `ColumnMapper`
    // builds a mapping: the entries that survive are stated outright, which is
    // easier to read than a copy with holes punched in it.
    const field = Object.fromEntries(
      Object.entries(valueMaps[entry.field] ?? {})
        .filter(([at]) => at !== key)
        .concat(to === "" ? [] : [[key, to]]),
    );
    const next = Object.fromEntries(
      Object.entries(valueMaps)
        .filter(([name]) => name !== entry.field)
        .concat(Object.keys(field).length === 0 ? [] : [[entry.field, field]]),
    ) as ValueMaps;
    onChange(next);
  };

  const rows = unplaced.reduce((total, entry) => total + entry.rows, 0);

  return (
    <div className="io-panel" data-testid="value-mapper">
      <p className="dash-hint">
        {/* The count is the argument for doing this at all: it is the number of
            rows that will be refused, and it is usually most of the file. */}
        {unplaced.length === 1 ? "One value" : `${String(unplaced.length)} values`} in this file
        {unplaced.length === 1 ? " is" : " are"} not one this season uses, across{" "}
        {rows === 1 ? "1 row" : `${String(rows)} rows`}. Say what each one means and we&apos;ll
        remember it for next time.
      </p>
      <div className="io-table-wrap">
        <table className="mapping-table">
          <thead>
            <tr>
              <th>Column</th>
              <th>Your value</th>
              <th>Rows</th>
              <th>Means</th>
            </tr>
          </thead>
          <tbody>
            {unplaced.map((entry) => {
              const chosen = valueMaps[entry.field]?.[normalizeHeader(entry.value)] ?? "";
              const selectId = `map-val-${entry.field}-${normalizeHeader(entry.value)}`;
              return (
                <tr key={`${entry.field}:${entry.value}`}>
                  <td data-label="Column">{entry.fieldLabel}</td>
                  <td data-label="Your value" className="mapping-sample">
                    <label htmlFor={selectId}>{entry.value}</label>
                  </td>
                  <td data-label="Rows">
                    <Badge tone={chosen === "" ? "warning" : "success"}>{String(entry.rows)}</Badge>
                  </td>
                  <td data-label="Means">
                    <select
                      id={selectId}
                      className="mapping-select"
                      data-testid={`value-select-${entry.field}-${normalizeHeader(entry.value)}`}
                      value={chosen}
                      onChange={(event) => {
                        choose(entry, event.target.value);
                      }}
                    >
                      {/* Leaving it is a real choice: the rows stay refused and
                          the organizer takes the rest, which is what
                          `skipInvalid` is for. */}
                      <option value="">Leave it (these rows stay refused)</option>
                      {entry.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
