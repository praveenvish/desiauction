"use client";

import {
  IMPORT_FIELD_LABELS,
  editCsvRow,
  tokenizeCsv,
  type ColumnMapping,
  type ImportField,
} from "@desiauction/core";
import { Button } from "@desiauction/ui";
import { useState } from "react";

import type { ImportPreview } from "../../../../server/competition/actions";

type RowError = ImportPreview["errors"][number];

/** How many problems to list before "and N more". */
const LISTED = 20;

/**
 * THE ROWS THAT NEED A PERSON, BY PERSON.
 *
 * These used to read "Line 51: duplicate phone in file (also line 50)", which
 * sends an organizer back to their spreadsheet to count rows. Now each problem
 * leads with the player's name and the row number their own sheet shows (the
 * parser's line numbering is the sheet's: header on row 1), and — the part that
 * saves a round trip — the cells that failed can be corrected right here. A
 * fix rewrites that row of the file in the dialog and the preview re-checks
 * it; nothing is saved until the organizer presses Import.
 */
export function ImportErrors({
  errors,
  text,
  mapping,
  onFix,
}: {
  errors: RowError[];
  /** The file as it currently stands in the dialog. */
  text: string;
  mapping: ColumnMapping;
  /** Called with the corrected file. */
  onFix: (next: string) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const records = tokenizeCsv(text).filter(
    (fields) => !(fields.length === 1 && fields[0]?.trim() === ""),
  );
  const header = (records[0] ?? []).map((cell) => cell.trim().toLowerCase());
  /*
   * Where a canonical field lives in THIS file. The organizer's mapping when
   * there is one; otherwise the file's own header, which is the case for a
   * sheet already in our column names.
   */
  const columnOf = (field: string): number | undefined => {
    const mapped = mapping[field as ImportField];
    if (Object.keys(mapping).length > 0) {
      return mapped;
    }
    const at = header.indexOf(field);
    return at === -1 ? undefined : at;
  };

  return (
    <div className="import-errors-panel" data-testid="import-errors">
      <ul className="import-errors">
        {errors.slice(0, LISTED).map((error) => {
          const editable = (error.fields ?? []).filter((field) => columnOf(field) !== undefined);
          return (
            <li key={error.line} data-testid={`import-error-${String(error.line)}`}>
              <span className="import-error-who">
                <strong>{error.name ?? "A player"}</strong>{" "}
                <span className="dash-hint">(row {error.line} of your sheet)</span>
              </span>
              <span>{error.message}</span>
              {editable.length > 0 && editing !== error.line ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(error.line);
                  }}
                  data-testid={`import-fix-${String(error.line)}`}
                >
                  Fix here
                </Button>
              ) : null}
              {editing === error.line ? (
                <RowFix
                  fields={editable}
                  values={editable.map(
                    (field) => records[error.line - 1]?.[columnOf(field) ?? -1] ?? "",
                  )}
                  onCancel={() => {
                    setEditing(null);
                  }}
                  onSave={(values) => {
                    const edits = new Map<number, string>();
                    editable.forEach((field, index) => {
                      const column = columnOf(field);
                      if (column !== undefined) {
                        edits.set(column, values[index] ?? "");
                      }
                    });
                    const next = editCsvRow(text, error.line, edits);
                    setEditing(null);
                    if (next !== null) {
                      onFix(next);
                    }
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {errors.length > LISTED ? (
        <p className="dash-hint">
          and {errors.length - LISTED} more not listed here — fix these first, or import the rest
          and come back to them.
        </p>
      ) : null}
    </div>
  );
}

function RowFix({
  fields,
  values,
  onCancel,
  onSave,
}: {
  fields: string[];
  values: string[];
  onCancel: () => void;
  onSave: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState(values);
  return (
    <form
      className="import-row-fix"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      {fields.map((field, index) => {
        const id = `row-fix-${field}`;
        return (
          <label key={field} htmlFor={id} className="io-inline">
            <span>{IMPORT_FIELD_LABELS[field as ImportField]}</span>
            <input
              id={id}
              className="import-row-fix-input"
              value={draft[index] ?? ""}
              onChange={(event) => {
                const next = [...draft];
                next[index] = event.target.value;
                setDraft(next);
              }}
            />
          </label>
        );
      })}
      <div className="io-row">
        <Button type="submit" size="sm" data-testid="import-fix-save">
          Save fix
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
