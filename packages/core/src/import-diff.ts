/**
 * RE-IMPORTING THE SAME ROSTER, WHICH IS THE NORMAL CASE.
 *
 * Pure: no IO, no storage, no ambient time.
 *
 * A club sends the sheet once, then sends it again with the corrections. The
 * commit path only ever INSERTED, skipping anything already registered — so the
 * second file did nothing at all and reported the whole roster as "duplicates".
 * Every correction an organizer made in the spreadsheet stayed in the
 * spreadsheet, which is precisely the failure this import exists to end.
 *
 * THREE RULES DECIDE EVERYTHING BELOW.
 *
 * 1. AN ABSENT COLUMN NEVER ERASES. The file supplies only what it maps; a form
 *    with no jersey-size question must not blank the sizes somebody typed in by
 *    hand. `null` from the parser means "not supplied", never "set to empty".
 *
 * 2. FILL BLANKS BY DEFAULT. The safe reading of a re-import is "add what is
 *    missing". Overwriting a value a human edited in the app — because a stale
 *    sheet still holds the old one — is a silent revert, and the organizer who
 *    made that edit is the one person who will not think to check. `file-wins`
 *    exists, and it is a choice somebody makes on purpose.
 *
 * 3. STATUS IS NOT THE FILE'S BUSINESS. An approved player is not un-approved
 *    by a re-upload, and a rejection is an organizer's decision that a
 *    spreadsheet does not get to overturn. The single exception is `withdrawn`,
 *    which reinstates — the same one exit the machine already allows, applied
 *    here for the same reason it is applied on the public path.
 */

import type { CsvRegistrationRow } from "./registration-csv";

/** How a re-import treats a value the file and the record disagree about. */
export type ImportPolicy = "fill-blanks" | "file-wins";

/** The stored values a re-import compares itself against. */
export interface ExistingRegistration {
  status: string;
  role: string | null;
  basePriceBand: string | null;
  dateOfBirth: string | null;
  battingStyle: string | null;
  bowlingStyle: string | null;
  feeStatus: string | null;
  feeAmountPaise: number | null;
  feeReference: string | null;
  note: string | null;
  fatherName: string | null;
  jerseyName: string | null;
  jerseyNumber: string | null;
  tshirtSize: string | null;
  trouserSize: string | null;
}

export interface FieldChange {
  field: string;
  /** Human label for the diff table. */
  label: string;
  from: string | null;
  to: string;
}

export type ImportRowPlan =
  | { kind: "new" }
  | { kind: "unchanged" }
  | { kind: "changed"; changes: FieldChange[] }
  /** Withdrawn, and back: reinstated, carrying whatever the file also updates. */
  | { kind: "reinstate"; changes: FieldChange[] };

/**
 * Every field a re-import may touch, and how to read it from both sides.
 *
 * One table rather than a chain of ifs, because the failure this guards against
 * is a field being added to the import and forgotten HERE — quietly excluded
 * from the diff, so the preview under-reports what the commit will do.
 */
interface Comparable {
  field: string;
  label: string;
  fromFile: (row: CsvRegistrationRow) => string | null;
  fromRecord: (existing: ExistingRegistration) => string | null;
}

const COMPARABLE: readonly Comparable[] = [
  { field: "role", label: "Playing role", fromFile: (r) => r.role, fromRecord: (e) => e.role },
  {
    field: "basePriceBand",
    label: "Base price band",
    fromFile: (r) => r.basePriceBand,
    fromRecord: (e) => e.basePriceBand,
  },
  {
    field: "dateOfBirth",
    label: "Date of birth",
    fromFile: (r) => r.dateOfBirth,
    fromRecord: (e) => e.dateOfBirth,
  },
  {
    field: "battingStyle",
    label: "Batting style",
    fromFile: (r) => r.battingStyle,
    fromRecord: (e) => e.battingStyle,
  },
  {
    field: "bowlingStyle",
    label: "Bowling style",
    fromFile: (r) => r.bowlingStyle,
    fromRecord: (e) => e.bowlingStyle,
  },
  {
    field: "feeStatus",
    label: "Fee status",
    fromFile: (r) => r.feeStatus,
    fromRecord: (e) => e.feeStatus,
  },
  {
    field: "feeAmountPaise",
    label: "Fee amount",
    fromFile: (r) => (r.feeAmountPaise === null ? null : String(r.feeAmountPaise)),
    fromRecord: (e) => (e.feeAmountPaise === null ? null : String(e.feeAmountPaise)),
  },
  {
    field: "feeReference",
    label: "Payment reference",
    fromFile: (r) => r.feeReference,
    fromRecord: (e) => e.feeReference,
  },
  { field: "note", label: "Note", fromFile: (r) => r.note, fromRecord: (e) => e.note },
  {
    field: "fatherName",
    label: "Father's name",
    fromFile: (r) => r.fatherName,
    fromRecord: (e) => e.fatherName,
  },
  {
    field: "jerseyName",
    label: "Jersey name",
    fromFile: (r) => r.jerseyName,
    fromRecord: (e) => e.jerseyName,
  },
  {
    field: "jerseyNumber",
    label: "Jersey number",
    fromFile: (r) => r.jerseyNumber,
    fromRecord: (e) => e.jerseyNumber,
  },
  {
    field: "tshirtSize",
    label: "T-shirt size",
    fromFile: (r) => r.tshirtSize,
    fromRecord: (e) => e.tshirtSize,
  },
  {
    field: "trouserSize",
    label: "Trouser size",
    fromFile: (r) => r.trouserSize,
    fromRecord: (e) => e.trouserSize,
  },
];

/**
 * Blank and absent are the same thing to a comparison.
 *
 * A type predicate, not a boolean: the narrowing is what lets `to` stay a
 * non-null `string` on a FieldChange, so a change can never be constructed
 * claiming to set a field to nothing.
 */
function supplied(value: string | null): value is string {
  return value !== null && value.trim() !== "";
}

/**
 * What this file's row would do to this record — new, nothing, or a named list
 * of changes. Deterministic and side-effect free; the caller decides whether to
 * apply it.
 */
export function planImportRow(
  row: CsvRegistrationRow,
  existing: ExistingRegistration | null,
  policy: ImportPolicy,
): ImportRowPlan {
  if (existing === null) {
    return { kind: "new" };
  }
  const changes: FieldChange[] = [];
  for (const entry of COMPARABLE) {
    const incoming = entry.fromFile(row);
    // Rule 1: the file did not supply this column, so it has no opinion on it.
    if (!supplied(incoming)) {
      continue;
    }
    const current = entry.fromRecord(existing);
    if (current === incoming) {
      continue;
    }
    // Rule 2: fill blanks unless the organizer asked for the file to win.
    if (policy === "fill-blanks" && supplied(current)) {
      continue;
    }
    changes.push({ field: entry.field, label: entry.label, from: current, to: incoming });
  }
  // Rule 3: withdrawn is the one status a file may move, and only back to live.
  if (existing.status === "withdrawn") {
    return { kind: "reinstate", changes };
  }
  return changes.length === 0 ? { kind: "unchanged" } : { kind: "changed", changes };
}

export interface ImportDiffRow {
  line: number;
  name: string;
  phone: string;
  plan: ImportRowPlan;
}

export interface ImportDiff {
  rows: ImportDiffRow[];
  counts: { new: number; changed: number; unchanged: number; reinstate: number };
}

/** Plan a whole file against what is already stored, keyed by normalized phone. */
export function planImport(
  rows: readonly CsvRegistrationRow[],
  existingByPhone: ReadonlyMap<string, ExistingRegistration>,
  policy: ImportPolicy,
): ImportDiff {
  const counts = { new: 0, changed: 0, unchanged: 0, reinstate: 0 };
  const planned = rows.map((row) => {
    const plan = planImportRow(row, existingByPhone.get(row.phone) ?? null, policy);
    counts[plan.kind] += 1;
    return { line: row.line, name: row.name, phone: row.phone, plan };
  });
  return { rows: planned, counts };
}
