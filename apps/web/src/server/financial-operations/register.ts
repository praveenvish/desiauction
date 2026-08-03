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

/**
 * One home for the tax posture's words. It had two: the Finance tab said
 * "Not registered for GST" while the Reconciliation tab's Posture card printed
 * the raw enum, `none`, for the same field one click away. Both now read from
 * here, so they cannot drift again.
 */
export const POSTURE_LABEL: Record<string, string> = {
  none: "Not registered for GST",
  "gst-registered": "Registered for GST",
};

export function postureLabel(posture: string | null): string {
  if (posture === null) return "Not declared";
  return POSTURE_LABEL[posture] ?? posture;
}

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

/*
 * `registerTotals` lives HERE, not in views.ts, and the reason is a build break.
 *
 * It was originally exported from views.ts and imported by finance-panel.tsx —
 * a "use client" component. views.ts imports @desiauction/db, which imports
 * `postgres`, which imports node's `net`, so the client bundle pulled a
 * database driver in behind a pure arithmetic helper and `next build` failed
 * with "Module not found: Can't resolve 'net'". lint, typecheck and the
 * integration suite all passed throughout — only a production build sees it.
 *
 * This module is already the client-safe half of the pair (see the header
 * above): plain, pure, and importing `RegisterRow` as a TYPE only, which is
 * erased at compile time.
 */
/**
 * What this organization has documented in a financial year.
 *
 * The finance desk opened with three setup cards and a register and never once
 * stated a total — on demo-club, whose books reconcile exactly (Cup Kings
 * invoiced ₹1,20,000 against receipts of ₹70,000 + ₹50,000; Cup Chargers
 * ₹80,000 against ₹80,000), the desk said none of it. The only rupee figure
 * anywhere in the workspace was on the Settlement tab.
 *
 * Deliberately NOT called "outstanding". What a team still owes is settlement's
 * question and settlement answers it; subtracting receipts from invoices here
 * would invent a second, quieter answer to it — and since tax invoices cannot
 * currently be issued at all, that subtraction would read as a debt for every
 * organization on the platform. This totals what the register actually holds.
 */
export interface RegisterTotals {
  readonly fy: string;
  readonly receiptedPaise: number;
  readonly invoicedPaise: number;
  readonly receipts: number;
  readonly invoices: number;
  readonly corrections: number;
}

export function registerTotals(rows: readonly RegisterRow[], fy: string): RegisterTotals {
  const mine = rows.filter((row) => row.fy === fy);
  const sum = (kind: string): number =>
    mine.filter((row) => row.kind === kind).reduce((total, row) => total + row.amount, 0);
  const count = (kind: string): number => mine.filter((row) => row.kind === kind).length;
  return {
    fy,
    receiptedPaise: sum("receipt"),
    invoicedPaise: sum("tax-invoice"),
    receipts: count("receipt"),
    invoices: count("tax-invoice"),
    corrections: count("correction"),
  };
}
