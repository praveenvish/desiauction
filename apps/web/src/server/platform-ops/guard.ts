import { currentSession } from "../auth/actions";
import { steppedUpRecently } from "../auth/step-up";
import { hasPlatformCapability, type PlatformCapability } from "../admin/capabilities";
import { grantsOfPerson } from "../request-cache";

/*
 * THE ONE DOOR EVERY ADMIN WRITE GOES THROUGH (AC-1.1).
 *
 * `server/platform-ops` is the only home for writes made from /admin, and the
 * dependency rule `admin-writes-only-through-platform-ops` keeps it that way.
 * Every writer here starts with `operatorFor`, which answers three questions
 * on the server, every time, before anything is written:
 *
 *   1. Is this person allowed?   — an ACTIVE platform grant carrying the
 *      capability, on the pinned singleton scope (`hasPlatformCapability`).
 *   2. Is it them at the keyboard? — a step-up code entered on THIS session in
 *      the last ten minutes (`steppedUpRecently`). If not, the screen opens
 *      "Confirm it's you" and retries.
 *   3. Why?                       — a written reason, 10–500 characters, which
 *      lands in the audit row and the email to the person affected.
 *
 * A hidden button is never the control; this is.
 */

export interface Operator {
  readonly personId: string;
  readonly sessionId: string;
  readonly name: string | null;
  /** The reason, trimmed, when one was required. */
  readonly reason: string;
}

export type OperatorRefusal =
  | { ok: false; error: string; stepUp?: false }
  /** The screen should open "Confirm it's you" and retry. */
  | { ok: false; error: string; stepUp: true };

export const REASON_MIN = 10;
export const REASON_MAX = 500;

export async function operatorFor(
  capability: PlatformCapability,
  options: { reason?: string | null; requireReason?: boolean } = {},
): Promise<{ ok: true; operator: Operator } | OperatorRefusal> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: "You've been signed out. Sign in again." };
  }
  if (!hasPlatformCapability(await grantsOfPerson(session.personId), capability)) {
    // Deliberately plain: the screen that offered this already knew.
    return { ok: false, error: "You don't have permission to do that." };
  }
  const reason = (options.reason ?? "").trim();
  if (
    options.requireReason !== false &&
    (reason.length < REASON_MIN || reason.length > REASON_MAX)
  ) {
    return {
      ok: false,
      error: `Write a reason (${String(REASON_MIN)}–${String(REASON_MAX)} characters). It is kept in the audit log and sent to the person affected.`,
    };
  }
  if (!steppedUpRecently(session)) {
    return { ok: false, error: "Confirm it's you to continue.", stepUp: true };
  }
  return {
    ok: true,
    operator: {
      personId: session.personId,
      sessionId: session.sessionId,
      name: session.name,
      reason,
    },
  };
}
