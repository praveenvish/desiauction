import { createHmac } from "node:crypto";

import { env } from "../../env";
import { authCodeSecret } from "./auth-secret";

/**
 * HOW A SHORT CODE IS STORED (security review, launch Phase 5).
 *
 * Every sign-in and change code is six digits: a million possibilities. Stored
 * as a bare sha256 — three copies of it, one per flow — a read of `otp_codes`
 * or `email_verifications` (a backup, a replica, a leaked dump) turned every
 * live code back into digits in well under a second. Keyed with a server secret
 * the database never holds, the stored value is useless without that secret.
 *
 * The digest also names WHAT the code proves: the purpose, and the subject it
 * was sent for. For a phone or email CHANGE the subject includes the account
 * that asked, so a code minted for one account's change cannot confirm
 * another's — the phone-change lookup matched by phone alone, which let a code
 * requested from one account complete a change on a different, stolen session.
 *
 * Changing this scheme invalidates codes in flight (they live minutes).
 *
 * The root is `AUTH_CODE_SECRET` when one is set and the engine's secret when
 * it is not (auth-secret.ts): the engine never needs to read a sign-in code,
 * so it should not be holding the key to them.
 */
const KEY = `short-code-digest:${authCodeSecret(env)}`;

export type CodePurpose =
  | "otp:login"
  | "otp:phone_change"
  | "otp:step_up"
  | "email:login"
  | "email:email_change"
  | "email:step_up";

export function codeDigest(purpose: CodePurpose, subject: string, code: string): string {
  return createHmac("sha256", KEY).update(`${purpose}\0${subject}\0${code}`).digest("hex");
}

/** The subject of a change code: the account that asked, and where it went. */
export function boundSubject(personId: string, destination: string): string {
  return `${personId}|${destination}`;
}
