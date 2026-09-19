import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The passkey challenge cookie, SIGNED and DATED.
 *
 * The challenge used to ride in a plain cookie, and `finish*` trusted whatever
 * that cookie held. A cookie is the caller's to set, so anyone who captured ONE
 * assertion (an extension, a proxy or body log, a trace payload) could put the
 * challenge inside it into their own cookie and replay it — indefinitely, since
 * synced passkeys report a signature counter of 0 and the counter check offers
 * nothing. The server never said which challenges it had issued.
 *
 * Now it does, statelessly: the value is `challenge.expiry.mac`, the MAC keyed
 * by a server secret. A challenge the server did not mint in the last five
 * minutes fails here before the WebAuthn library ever sees it.
 */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function mac(key: string, challenge: string, expiresAt: number): string {
  return createHmac("sha256", key)
    .update(`passkey-challenge:${challenge}:${String(expiresAt)}`)
    .digest("base64url");
}

export function sealChallenge(key: string, challenge: string, now: number = Date.now()): string {
  const expiresAt = now + CHALLENGE_TTL_MS;
  return `${challenge}.${String(expiresAt)}.${mac(key, challenge, expiresAt)}`;
}

export function openChallenge(
  key: string,
  sealed: string,
  now: number = Date.now(),
): string | null {
  const parts = sealed.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [challenge = "", expiry = "", given = ""] = parts;
  const expiresAt = Number(expiry);
  if (challenge === "" || !Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    return null;
  }
  const expected = Buffer.from(mac(key, challenge, expiresAt));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  return challenge;
}
