import type { Db } from "@desiauction/db";
import { confirmationToken } from "./confirmation-token";
import { confirmationContext } from "./confirmation";
export function confirmationNoticeAddress(raw: unknown) {
  if (typeof raw !== "string") return null;
  const parts =
    /^match\.confirm_request:([0-9A-HJKMNP-TV-Z]{26}):([1-9]\d*):([1-9]\d*):([0-9A-HJKMNP-TV-Z]{26}):([0-9A-HJKMNP-TV-Z]{26})$/.exec(
      raw.replace(/^email:/, ""),
    );
  if (!parts) return null;
  const [, fixtureId, attemptText, seqText, teamId, personId] = parts;
  if (!fixtureId || !teamId || !personId) return null;
  const attempt = Number(attemptText),
    lastSeq = Number(seqText);
  return Number.isSafeInteger(attempt) && Number.isSafeInteger(lastSeq)
    ? { fixtureId, attempt, lastSeq, teamId, personId }
    : null;
}
export async function eligibleConfirmationNotice(
  db: Db,
  address: NonNullable<ReturnType<typeof confirmationNoticeAddress>>,
  now = new Date(),
) {
  return confirmationContext(db, address.personId, confirmationToken(address, now), now);
}
