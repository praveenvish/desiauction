"use client";

import {
  IMPORT_FIELDS,
  IMPORT_FIELD_LABELS,
  REQUIRED_IMPORT_FIELDS,
  type ColumnMapping,
  type ImportField,
} from "@desiauction/core";
import { Badge } from "@desiauction/ui";

import type { ImportInspection } from "../../../../server/competition/actions";

/**
 * THE STEP THAT MAKES A MAPPING CHECKABLE.
 *
 * Their column on the left, OUR field as a dropdown on the right, and — the
 * part that matters — the file's own first value sitting between them. A
 * mapping screen without sample data asks the organizer to trust a guess about
 * columns they cannot see; with it, "Mobile Number → Mobile number → 9876543210"
 * is verified at a glance and a wrong guess is obvious rather than discovered
 * three weeks later in an auction.
 *
 * Every column is listed, including the ones going nowhere. A column silently
 * dropped is the same class of failure as a value silently dropped, which this
 * import has already been burned by twice (the styles, then the dates).
 */
export function ColumnMapper({
  inspection,
  mapping,
  onChange,
}: {
  inspection: ImportInspection;
  mapping: ColumnMapping;
  onChange: (next: ColumnMapping) => void;
}) {
  const fieldAt = (index: number): ImportField | "" => {
    const hit = IMPORT_FIELDS.find((field) => mapping[field] === index);
    return hit ?? "";
  };

  const assign = (index: number, field: ImportField | ""): void => {
    // A column holds at most one field, and a field at most one column — so
    // taking a field away from whoever held it is part of assigning it. Built
    // by filtering rather than deleting: the entries that survive are stated,
    // which is easier to read than a copy with holes punched in it.
    const next: ColumnMapping = {};
    for (const key of IMPORT_FIELDS) {
      const at = mapping[key];
      if (at !== undefined && at !== index) {
        next[key] = at;
      }
    }
    if (field !== "") {
      next[field] = index;
    }
    onChange(next);
  };

  const missing = REQUIRED_IMPORT_FIELDS.filter((field) => mapping[field] === undefined);

  return (
    <div className="io-panel" data-testid="column-mapper">
      <p className="dash-hint">
        Each column of your file, and where it lands. We&apos;ve filled in what we recognised —
        check the sample value beside each one.
      </p>

      {missing.length > 0 ? (
        <p role="alert" className="reg-warning" data-testid="mapping-missing">
          Still needed: {missing.map((field) => IMPORT_FIELD_LABELS[field]).join(", ")}.
        </p>
      ) : null}

      {(inspection.detected?.conflicts ?? []).map((conflict) => (
        <p role="alert" className="reg-warning" key={conflict.field} data-testid="mapping-conflict">
          {conflict.headers.join(" and ")} both look like{" "}
          {IMPORT_FIELD_LABELS[conflict.field].toLowerCase()} — pick the one to use.
        </p>
      ))}

      <div className="table-scroll">
        <table className="reg-table" data-testid="mapping-table">
          <thead>
            <tr>
              <th>Your column</th>
              <th>First value</th>
              <th>Goes to</th>
            </tr>
          </thead>
          <tbody>
            {inspection.headers.map((header, index) => {
              const current = fieldAt(index);
              const noise = inspection.detected?.columns[index]?.noise === true;
              const selectId = `map-col-${String(index)}`;
              return (
                <tr key={index}>
                  <td data-label="Your column">
                    <label htmlFor={selectId}>{header === "" ? "(unnamed)" : header}</label>
                    {noise && current === "" ? <Badge tone="neutral">ignored</Badge> : null}
                  </td>
                  <td data-label="First value" className="mapping-sample">
                    {inspection.sample[index] === undefined || inspection.sample[index] === "" ? (
                      <span className="dash-hint">—</span>
                    ) : (
                      inspection.sample[index]
                    )}
                  </td>
                  <td data-label="Goes to">
                    <select
                      id={selectId}
                      className="mapping-select"
                      data-testid={`mapping-select-${String(index)}`}
                      value={current}
                      onChange={(event) => {
                        assign(index, event.target.value as ImportField | "");
                      }}
                    >
                      <option value="">Don&apos;t import</option>
                      {IMPORT_FIELDS.map((field) => (
                        <option key={field} value={field}>
                          {IMPORT_FIELD_LABELS[field]}
                          {REQUIRED_IMPORT_FIELDS.includes(field) ? " (required)" : ""}
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
