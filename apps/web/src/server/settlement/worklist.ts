import type { DashboardCase } from "./views";

/**
 * The Settlement worklist's presentation contract (PX-7 §5/§7).
 *
 * Pure and side-effect free so the regression suite can attack it directly: a
 * filter that silently drops a case with money outstanding is a settlement
 * incident, not a cosmetic bug, and it deserves a test that does not need a
 * browser to run.
 */

/** The one place a case status becomes a word an organizer reads. */
export const CASE_STATUS_LABEL: Record<string, string> = {
  opened: "Opened",
  verified: "Verified",
  discrepant: "Discrepant",
  settling: "Collecting",
  settled: "Settled",
  closed: "Reconciled",
  voided: "Voided",
};

/**
 * The Case Review sections, in order.
 *
 * Lives HERE and not beside the panel because the page (a server component)
 * validates `?tab=` against it: a plain data export from a `"use client"` module
 * arrives on the server as a client-reference PROXY, not an array, and calling
 * `.includes` on it throws at request time. Shared data crosses the boundary
 * only through a module that is neither.
 */
export const CASE_REVIEW_TABS: readonly string[] = [
  "obligations",
  "payments",
  "timeline",
  "verification",
  "evidence",
];

export const DEFAULT_CASE_TAB = "obligations";

/** Fail-soft: an unknown or absent `?tab=` opens the case where a reader starts. */
export function caseTabFrom(requested: string | undefined): string {
  return requested !== undefined && CASE_REVIEW_TABS.includes(requested)
    ? requested
    : DEFAULT_CASE_TAB;
}

export interface SavedView {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
}

/** The saved views a settlement desk actually keeps open. */
export const SAVED_VIEWS: readonly SavedView[] = [
  { key: "attention", label: "Needs attention", hint: "Cases still waiting on a human" },
  { key: "outstanding", label: "Money outstanding", hint: "Cases where a team still owes" },
  { key: "closed", label: "Recently closed", hint: "Cases that reached Reconciled" },
  { key: "all", label: "All cases", hint: "Every case this organization has opened" },
];

export function isSavedView(value: string): boolean {
  return SAVED_VIEWS.some((view) => view.key === value);
}

/**
 * Upholds: filtering NARROWS a worklist and never invents a row. An unknown
 * view or status shows everything rather than hiding money behind a typo.
 */
export function filterCases(
  cases: readonly DashboardCase[],
  view: string,
  status: string,
  query: string,
): readonly DashboardCase[] {
  const needle = query.trim().toLowerCase();
  return cases.filter((row) => {
    if (view === "attention" && !row.needsAttention) {
      return false;
    }
    if (view === "outstanding" && row.outstanding === 0) {
      return false;
    }
    if (view === "closed" && row.status !== "closed") {
      return false;
    }
    if (status !== "" && row.status !== status) {
      return false;
    }
    if (needle === "") {
      return true;
    }
    // Search reaches what a treasurer actually remembers: the competition, the
    // case reference, and the status word they saw on screen.
    return (
      row.competitionName.toLowerCase().includes(needle) ||
      row.competitionSlug.toLowerCase().includes(needle) ||
      row.caseId.toLowerCase().includes(needle) ||
      (CASE_STATUS_LABEL[row.status] ?? row.status).toLowerCase().includes(needle)
    );
  });
}
