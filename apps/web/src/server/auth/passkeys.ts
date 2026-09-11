import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { newId, passkeyCredentials, people, type Db } from "@desiauction/db";
import { and, eq } from "drizzle-orm";

import { env } from "../../env";
import { logSecurityEvent } from "./security-events";

// Passkey ceremonies (IP-2_DESIGN D4). Challenges travel in a short-lived
// httpOnly cookie between the two halves of each ceremony; simplewebauthn
// verifies signatures against them. rpID/origins come from validated env.

const RP_NAME = "DesiAuction";

export async function startEnrollment(db: Db, personId: string) {
  const [person] = await db.select().from(people).where(eq(people.id, personId)).limit(1);
  if (person === undefined) {
    throw new Error("person not found");
  }
  const existing = await db
    .select()
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.personId, personId));
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: env.RP_ID,
    /*
     * WHAT THE AUTHENTICATOR SHOWS THE PERSON when it asks "which account?".
     *
     * Phone was the only possible answer until 0062; an email-anchored person
     * has none. Falls back to the address, then to the person id — never to an
     * empty string, because a passkey listed as "" in a password manager is one
     * nobody can tell apart from another account's.
     */
    userName: person.phone ?? person.email ?? personId,
    userDisplayName: person.name ?? person.phone ?? person.email ?? personId,
    attestationType: "none",
    excludeCredentials: existing.map((credential) => ({ id: credential.credentialId })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
}

export async function finishEnrollment(
  db: Db,
  personId: string,
  expectedChallenge: string,
  response: RegistrationResponseJSON,
  deviceName: string,
): Promise<{ ok: boolean }> {
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: env.RP_ORIGINS,
    expectedRPID: env.RP_ID,
  });
  if (!verification.verified) {
    return { ok: false };
  }
  const { credential } = verification.registrationInfo;
  await db.insert(passkeyCredentials).values({
    id: newId(),
    personId,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports?.join(",") ?? null,
    name: deviceName.trim() === "" ? "Passkey" : deviceName.trim().slice(0, 60),
  });
  await logSecurityEvent(personId, "auth.passkey.enrolled", { device: deviceName });
  return { ok: true };
}

export function startAuthentication() {
  return generateAuthenticationOptions({
    rpID: env.RP_ID,
    userVerification: "preferred",
  });
}

export async function finishAuthentication(
  db: Db,
  expectedChallenge: string,
  response: AuthenticationResponseJSON,
): Promise<{ ok: true; personId: string } | { ok: false }> {
  const [credential] = await db
    .select()
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.credentialId, response.id))
    .limit(1);
  if (credential === undefined) {
    return { ok: false };
  }
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: env.RP_ORIGINS,
    expectedRPID: env.RP_ID,
    credential: {
      id: credential.credentialId,
      publicKey: Buffer.from(credential.publicKey, "base64url"),
      counter: credential.counter,
      transports: credential.transports?.split(",") as never,
    },
  });
  if (!verification.verified) {
    // PI-1 audit-gap closure: the ceremony reached a KNOWN credential and
    // failed to verify — that is an attempt against this person's account,
    // and their ledger should show it. Unknown credentials stay silent above
    // (no person to attribute; fail-closed before any cryptography).
    await logSecurityEvent(credential.personId, "auth.passkey.failed", {
      device: credential.name,
    });
    return { ok: false };
  }
  await db
    .update(passkeyCredentials)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(passkeyCredentials.id, credential.id));
  await logSecurityEvent(credential.personId, "auth.login.passkey", {
    device: credential.name,
  });
  return { ok: true, personId: credential.personId };
}

export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export async function listPasskeys(db: Db, personId: string): Promise<PasskeySummary[]> {
  return db
    .select({
      id: passkeyCredentials.id,
      name: passkeyCredentials.name,
      createdAt: passkeyCredentials.createdAt,
      lastUsedAt: passkeyCredentials.lastUsedAt,
    })
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.personId, personId));
}

export async function renamePasskey(
  db: Db,
  personId: string,
  passkeyId: string,
  name: string,
): Promise<void> {
  await db
    .update(passkeyCredentials)
    .set({ name: name.trim().slice(0, 60) })
    .where(and(eq(passkeyCredentials.id, passkeyId), eq(passkeyCredentials.personId, personId)));
  await logSecurityEvent(personId, "auth.passkey.renamed");
}

export async function removePasskey(db: Db, personId: string, passkeyId: string): Promise<void> {
  await db
    .delete(passkeyCredentials)
    .where(and(eq(passkeyCredentials.id, passkeyId), eq(passkeyCredentials.personId, personId)));
  await logSecurityEvent(personId, "auth.passkey.removed");
}
