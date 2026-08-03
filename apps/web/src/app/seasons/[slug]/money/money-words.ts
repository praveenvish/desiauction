/**
 * The money surfaces' shared vocabulary.
 *
 * Kept in its own module so the case review can speak the console's language
 * without importing the console — and with it every settlement server action
 * the console binds.
 *
 * `CREATED` and `CAPTURED` are payment-gateway enums. Printed in caps beside a
 * cash payment somebody counted by hand at a school ground they say nothing,
 * and "captured" in particular is jargon for the single most important fact on
 * the screen: the money arrived.
 */
export const PAYMENT_STATE: Record<string, string> = {
  created: "Recorded",
  authorized: "Authorized",
  captured: "Received",
  refunded: "Refunded",
  failed: "Failed",
  disputed: "Disputed",
};

/** The case status, said the way the stepper and both screens say it. */
export const CASE_STATE: Record<string, string> = {
  opened: "Opened",
  verified: "Verified",
  discrepant: "Discrepant",
  settling: "Collecting",
  settled: "Settled",
  closed: "Reconciled",
  voided: "Voided",
};
