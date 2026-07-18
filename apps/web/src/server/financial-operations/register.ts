import type { RegisterRow } from "./views";

/**
 * The documents register's presentation contract (PX-8 §1/§5).
 *
 * Pure and side-effect free so the regression suite can attack it directly, and
 * in a PLAIN module because a server component validates against it — a data
 * export from a `"use client"` module reaches the server as a client-reference
 * proxy, not the value (the PX-7 finding, regression-locked).
 */

export const DOC_KIND_LABEL: Record<string, string> = {
  receipt: "Receipt",
  "tax-invoice": "Tax invoice",
  correction: "Correction",
};

export interface FinanceView {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
}

/** The saved views a finance desk actually keeps open. */
export const FINANCE_VIEWS: readonly FinanceView[] = [
  { key: "all", label: "All documents", hint: "Every document this organization has issued" },
  { key: "receipts", label: "Receipts", hint: "What was issued against collected money" },
  { key: "invoices", label: "Tax invoices", hint: "What was billed" },
  { key: "corrections", label: "Corrections", hint: "Documents that correct another" },
];

export function isFinanceView(value: string): boolean {
  return FINANCE_VIEWS.some((view) => view.key === value);
}

const VIEW_KIND: Record<string, string> = {
  receipts: "receipt",
  invoices: "tax-invoice",
  corrections: "correction",
};

/**
 * Upholds: filtering NARROWS a register and never invents a row. An unknown view
 * or kind shows everything rather than hiding a document behind a typo.
 *
 * Search reaches what a finance operator actually remembers: the document
 * number, the party, the settlement reference the document was made from, and
 * the content digest they were given to check.
 */
export function filterRegister(
  rows: readonly RegisterRow[],
  view: string,
  kind: string,
  query: string,
): readonly RegisterRow[] {
  const needle = query.trim().toLowerCase();
  const viewKind = VIEW_KIND[view];
  return rows.filter((row) => {
    if (viewKind !== undefined && row.kind !== viewKind) {
      return false;
    }
    if (kind !== "" && row.kind !== kind) {
      return false;
    }
    if (needle === "") {
      return true;
    }
    return (
      String(row.number).includes(needle) ||
      row.partyLabel.toLowerCase().includes(needle) ||
      row.docId.toLowerCase().includes(needle) ||
      (row.sourceRef ?? "").toLowerCase().includes(needle) ||
      row.contentDigest.toLowerCase().includes(needle) ||
      (DOC_KIND_LABEL[row.kind] ?? row.kind).toLowerCase().includes(needle)
    );
  });
}
