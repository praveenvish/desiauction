import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../env";
import type { TrustRevision } from "./trust-ledger";
const TTL = 7 * 24 * 60 * 60 * 1000;
const secret = () => env.SCORING_HANDOVER_SECRET ?? "dev-scoring-handover-secret-local-only";
const sign = (payload: string) =>
  createHmac("sha256", secret()).update(payload).digest("base64url");
export interface ConfirmationAddress extends TrustRevision {
  fixtureId: string;
  teamId: string;
}
export function confirmationToken(address: ConfirmationAddress, now = new Date()) {
  const payload = [
    "confirm",
    "1",
    address.fixtureId,
    address.attempt,
    address.lastSeq,
    address.teamId,
    now.getTime() + TTL,
  ].join(".");
  return Buffer.from(`${payload}.${sign(payload)}`).toString("base64url");
}
export function readConfirmationToken(token: unknown, now = new Date()) {
  if (typeof token !== "string" || token.length > 400 || !/^[A-Za-z0-9_-]+$/.test(token))
    return null;
  const decoded = Buffer.from(token, "base64url").toString("utf8");
  if (Buffer.from(decoded).toString("base64url") !== token) return null;
  const parts =
    /^confirm\.1\.([0-9A-HJKMNP-TV-Z]{26})\.([1-9]\d*)\.([1-9]\d*)\.([0-9A-HJKMNP-TV-Z]{26})\.([1-9]\d*)\.([A-Za-z0-9_-]{43})$/.exec(
      decoded,
    );
  if (!parts) return null;
  const [, fixtureId, attemptText, seqText, teamId, expiryText, signature] = parts;
  if (!fixtureId || !attemptText || !seqText || !teamId || !expiryText || !signature) return null;
  const attempt = Number(attemptText),
    lastSeq = Number(seqText),
    expiry = Number(expiryText);
  if (
    ![attempt, lastSeq, expiry].every(Number.isSafeInteger) ||
    expiry <= now.getTime() ||
    expiry > now.getTime() + TTL
  )
    return null;
  const expected = sign(decoded.slice(0, decoded.lastIndexOf(".")));
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return {
    fixtureId,
    attempt,
    lastSeq,
    teamId,
    expiry,
    tokenHash: createHash("sha256").update(token).digest("hex"),
  };
}
