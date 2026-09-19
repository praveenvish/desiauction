import type { FeeStatus } from "@desiauction/core";

import type { RegistrationRow } from "../../../../server/competition/registrations";

/**
 * The player desk's words, in one place — the table, the sheet and the team
 * roster all describe the same registration and must describe it the same way.
 */

export type Row = RegistrationRow;

export const STATUS_TONE = {
  draft: "neutral",
  submitted: "info",
  approved: "success",
  rejected: "danger",
  waitlisted: "warning",
  withdrawn: "neutral",
} as const;

/** "rejected" is the machine's word; a person was DECLINED. */
export const STATUS_LABEL: Record<Row["status"], string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Declined",
  waitlisted: "Waitlisted",
  withdrawn: "Withdrawn",
};

/**
 * The desk's four states, in the words a person uses.
 *
 * "Refunded" is a real state and not a synonym for pending: the money came and
 * went, which a club chasing payments needs to see as settled rather than as
 * outstanding.
 */
export const FEE_LABEL: Record<FeeStatus, string> = {
  pending: "Not paid",
  paid: "Paid",
  waived: "Waived",
  refunded: "Refunded",
};

export const FEE_TONE: Record<FeeStatus, "warning" | "success" | "info" | "neutral"> = {
  pending: "warning",
  paid: "success",
  waived: "info",
  refunded: "neutral",
};

/** What a rejection reason is called where a human reads it. */
export const REASON_LABEL: Record<string, string> = {
  duplicate: "Already registered",
  ineligible: "Not eligible",
  withdrew: "Player withdrew",
  capacity: "Season is full",
  other: "Other",
};

/**
 * DA-22: the toast built its verb as `${action}d`, which spelled "rejectd" and
 * "waitlistd". Approve was correct by luck.
 */
export const PAST_TENSE: Record<string, string> = {
  approve: "approved",
  reject: "declined",
  waitlist: "waitlisted",
  restore: "restored",
};

/**
 * DA-35: the timeline printed raw enum tails — "IMPORTED · APPROVE ·
 * MARKS_SET · WAITLIST" — and named no actor.
 */
export const TIMELINE_VERB: Record<string, string> = {
  "registration.submitted": "Registered",
  "registration.added": "Added by the organizer",
  "registration.imported": "Imported from a CSV",
  "registration.approve": "Approved",
  "registration.reject": "Declined",
  "registration.waitlist": "Waitlisted",
  "registration.withdraw": "Withdrawn",
  "registration.restore": "Restored to review",
  "registration.marks_set": "Squad marks changed",
  "registration.team_assigned": "Assigned to a team",
  "registration.note": "Note",
  "registration.notified": "Player notified by SMS",
  "registration.notify_failed": "SMS to the player failed",
  "registration.notify_suppressed": "No SMS sent (no number or opted out)",
  "registration.exported": "Included in a CSV export",
  "registration.details_edited": "Details edited",
};

/** The fields a details edit names in its audit row, as a person reads them. */
export const EDITED_FIELD_LABEL: Record<string, string> = {
  name: "name",
  role: "role",
  basePriceBand: "price band",
  dateOfBirth: "date of birth",
  attributes: "playing style",
  fatherName: "father's name",
  jerseyName: "jersey name",
  jerseyNumber: "jersey number",
  tshirtSize: "t-shirt size",
  trouserSize: "trouser size",
  note: "note",
  feeStatus: "fee status",
  feeAmount: "fee amount",
  feeReference: "fee reference",
};

/** Triage is possible only from these — the machine's own edges. */
export function canTriage(row: Pick<Row, "status">): boolean {
  return row.status === "submitted" || row.status === "waitlisted";
}

/** Back to review — the one exit from a decline or a withdrawal. */
export function canRestore(row: Pick<Row, "status">): boolean {
  return row.status === "rejected" || row.status === "withdrawn";
}
