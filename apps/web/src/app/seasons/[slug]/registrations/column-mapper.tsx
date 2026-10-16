"use client";

import {
  IMPORT_FIELD_LABELS,
  RECOMMENDED_IMPORT_FIELDS,
  REQUIRED_IMPORT_FIELDS,
  type ColumnMapping,
  type ImportFieldOption,
  type MappableField,
} from "@desiauction/core";
import { Badge, Button } from "@desiauction/ui";

import type { ImportInspection } from "../../../../server/competition/actions";

/**
 * What a field is called in this season — the inspection's list knows the
 * sport's own attributes; the fixed labels cover a field it does not list.
 */
export function fieldLabel(field: MappableField, fields: readonly ImportFieldOption[]): string {
  return (
    fields.find((option) => option.field === field)?.label ??
    (IMPORT_FIELD_LABELS as Record<string, string>)[field] ??
    field
  );
}

/** The fields a mapping sends somewhere, in the order the screen lists them. */
function mappedIn(mapping: ColumnMapping): MappableField[] {
  return (Object.keys(mapping) as MappableField[]).filter((field) => mapping[field] !== undefined);
}

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
  const fields = inspection.fields;
  const fieldAt = (index: number): MappableField | "" => {
    const hit = mappedIn(mapping).find((field) => mapping[field] === index);
    return hit ?? "";
  };

  const assign = (index: number, field: MappableField | ""): void => {
    // A column holds at most one field, and a field at most one column — so
    // taking a field away from whoever held it is part of assigning it. Built
    // by filtering rather than deleting: the entries that survive are stated,
    // which is easier to read than a copy with holes punched in it.
    const next: ColumnMapping = {};
    for (const key of mappedIn(mapping)) {
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
  // Not required — a list of names imports — but never left unsaid.
  const unmatched = RECOMMENDED_IMPORT_FIELDS.filter((field) => mapping[field] === undefined);

  return (
    <div className="io-panel" data-testid="column-mapper">
      <p className="dash-hint">
        Each column of your file, and where it lands. We&apos;ve filled in what we recognised —
        check the sample value beside each one.
      </p>

      {missing.length > 0 ? (
        <p role="alert" className="reg-warning" data-testid="mapping-missing">
          Still needed: {missing.map((field) => fieldLabel(field, fields)).join(", ")}.
        </p>
      ) : null}

      {missing.length === 0 && unmatched.length > 0 ? (
        <p className="dash-hint" data-testid="mapping-optional-missing">
          No {unmatched.map((field) => fieldLabel(field, fields).toLowerCase()).join(" or ")} column
          picked.{" "}
          {unmatched.includes("phone") ? "Players will be added without a phone number. " : ""}
          {unmatched.includes("role") ? "Set each player's role before the auction. " : ""}
          If your file has {unmatched.length === 1 ? "this column" : "these columns"}, pick{" "}
          {unmatched.length === 1 ? "it" : "them"} below.
        </p>
      ) : null}

      {(inspection.detected?.conflicts ?? []).map((conflict) => (
        <p role="alert" className="reg-warning" key={conflict.field} data-testid="mapping-conflict">
          {conflict.headers.join(" and ")} both look like{" "}
          {fieldLabel(conflict.field, fields).toLowerCase()} — pick the one to use.
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
                        assign(index, event.target.value as MappableField | "");
                      }}
                    >
                      <option value="">Don&apos;t import</option>
                      {fields.map((option) => (
                        <option key={option.field} value={option.field}>
                          {option.label}
                          {option.required ? " (required)" : ""}
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
    // A file with no phone or role column imports, but the table is where the
    // organizer can point a column the guess missed at it — so it stays open.
    RECOMMENDED_IMPORT_FIELDS.some((field) => mapping[field] === undefined) ||
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
  const matched = inspection.fields
    .filter((option) => mapping[option.field] !== undefined)
    .map(({ field }) => ({
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
            {entry.header} → {fieldLabel(entry.field, inspection.fields)}
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
