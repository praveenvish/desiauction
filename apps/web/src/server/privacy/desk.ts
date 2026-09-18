import { declineRequest, openRequests, recentDecisions, type DecidedRow } from "./requests";
import { erasurePreflight, executeErasure, REFUSAL_TEXT, type ErasureRefusal } from "./erasure";
import { asPerson } from "../tenant";

/**
 * The privacy desk's reads and decisions, for an operator ALREADY gated on
 * `platform:privacy` by the caller. Kept out of `server/admin` so the source
 * scan that proves administration holds no write stays true: the desk page and
 * its actions only gate and delegate to here.
 */

export interface DeskRow {
  id: string;
  personId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  reason: string | null;
  requestedAt: Date;
  /** Null when the erasure can go ahead; otherwise why it cannot, in words. */
  blocked: string | null;
  /** How many clubs the erasure will touch. */
  clubs: number;
}

export interface ErasureDesk {
  open: DeskRow[];
  decided: DecidedRow[];
}

export async function erasureDesk(operatorId: string): Promise<ErasureDesk> {
  const [open, decided] = await asPerson(operatorId, (db) =>
    Promise.all([openRequests(db), recentDecisions(db)]),
  );
  const rows: DeskRow[] = [];
  for (const row of open) {
    const preflight = await erasurePreflight(operatorId, row.personId);
    rows.push({
      ...row,
      blocked: preflight.ok ? null : REFUSAL_TEXT[preflight.reason],
      clubs: preflight.ok ? preflight.clubs : 0,
    });
  }
  return { open: rows, decided };
}

export type DeskResult = { ok: true; message: string } | { ok: false; error: string };

export async function eraseForRequest(
  operatorId: string,
  requestId: string,
  note: string | null,
): Promise<DeskResult> {
  const result = await executeErasure({ operatorId, requestId, note });
  if (result.ok) {
    return {
      ok: true,
      message:
        result.clubs === 0
          ? "Account erased."
          : `Account erased across ${String(result.clubs)} club${result.clubs === 1 ? "" : "s"}.`,
    };
  }
  if (result.reason === "no_open_request") {
    return { ok: false, error: "That request has already been decided." };
  }
  return { ok: false, error: REFUSAL_TEXT[result.reason satisfies ErasureRefusal] };
}

export async function declineForRequest(
  operatorId: string,
  requestId: string,
  note: string,
): Promise<DeskResult> {
  if (note.trim() === "") {
    return { ok: false, error: "Say why — the person reads this on their account page." };
  }
  const declined = await asPerson(operatorId, (db) =>
    declineRequest(db, { requestId, operatorId, note }),
  );
  return declined
    ? { ok: true, message: "Request declined. The person sees your reason on their account." }
    : { ok: false, error: "That request has already been decided." };
}
