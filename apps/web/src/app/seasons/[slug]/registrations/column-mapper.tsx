"use client";

import {
  IMPORT_FIELDS,
  IMPORT_FIELD_LABELS,
  REQUIRED_IMPORT_FIELDS,
  type ColumnMapping,
  type ImportField,
} from "@desiauction/core";
import { Badge, Button } from "@desiauction/ui";

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
        <table className="reg-table import-table mapping-table" data-testid="mapping-table">
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

/**
 * Does this mapping need a person's decision before it can be trusted?
 *
 * A required field nobody claimed, or two columns that both looked like one
 * field. Anything else — including columns going nowhere, like a form's photo
 * upload or its "I agree" question — is a mapping the summary can simply
 * state.
 */
export function mappingNeedsReview(inspection: ImportInspection, mapping: ColumnMapping): boolean {
  return (
    REQUIRED_IMPORT_FIELDS.some((field) => mapping[field] === undefined) ||
    (inspection.detected?.conflicts.length ?? 0) > 0
  );
}

/**
 * THE MAPPING, IN ONE BREATH.
 *
 * When every column landed somewhere sensible, the nine-row table is a wall to
 * scroll past on the way to the Import button — and this is a screen an
 * organizer meets every few days for a whole registration window. So the
 * common case is one sentence naming what went where and what was left out,
 * with the table one click away. The table is never skipped when it has a
 * question to ask (`mappingNeedsReview`).
 */
export function MappingSummary({
  inspection,
  mapping,
  onReview,
}: {
  inspection: ImportInspection;
  mapping: ColumnMapping;
  onReview: () => void;
}) {
  const matched = IMPORT_FIELDS.filter((field) => mapping[field] !== undefined).map((field) => ({
    field,
    header: inspection.headers[mapping[field] ?? -1] ?? "",
  }));
  const used = new Set(matched.map((entry) => mapping[entry.field]));
  const skipped = inspection.headers.filter(
    (header, index) => !used.has(index) && header.trim() !== "",
  );
  return (
    <div className="mapping-summary" data-testid="mapping-summary">
      <p>
        <strong>
          {matched.length} column{matched.length === 1 ? "" : "s"} matched
        </strong>
        {" — "}
        {matched.map((entry, index) => (
          <span key={entry.field}>
            {index > 0 ? " · " : ""}
            {entry.header} → {IMPORT_FIELD_LABELS[entry.field]}
          </span>
        ))}
      </p>
      {skipped.length > 0 ? <p className="dash-hint">Not imported: {skipped.join(" · ")}</p> : null}
      <Button variant="ghost" size="sm" onClick={onReview} data-testid="mapping-review">
        Change column matching
      </Button>
    </div>
  );
}
