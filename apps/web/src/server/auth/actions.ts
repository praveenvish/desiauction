"use server";

import { normalizePhone } from "@desiauction/core";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { people, withTenantDb } from "@desiauction/db";
import { eq } from "drizzle-orm";

import { env } from "../../env";
import { db, dbHandle } from "../db";
import { requestOtp, verifyOtp } from "./otp";
import { createOtpSenderFromEnv, OtpSendError } from "./otp-sender";
import { safeNext } from "./redirect";
import {
  finishAuthentication,
  finishEnrollment,
  listPasskeys,
  removePasskey,
  renamePasskey,
  startAuthentication,
  startEnrollment,
  type PasskeySummary,
} from "./passkeys";
import { listSecurityEvents, logSecurityEvent, type SecurityEvent } from "./security-events";
import {
  createSession,
  getSessionByToken,
  listSessions,
  revokeSession,
  SESSION_COOKIE,
  type SessionSummary,
} from "./sessions";

const CHALLENGE_COOKIE = "da_pk_challenge";

async function setChallenge(challenge: string): Promise<void> {
  (await cookies()).set(CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 300,
    path: "/",
  });
}

async function takeChallenge(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(CHALLENGE_COOKIE)?.value ?? null;
  store.delete(CHALLENGE_COOKIE);
  return value;
}

async function requestIp(): Promise<string | null> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip");
  // Loopback is the server/proxy itself, never a client — no IP context.
  return ip === null || ip === "127.0.0.1" || ip === "::1" ? null : ip;
}

async function issueSessionCookie(personId: string): Promise<void> {
  const agent = (await headers()).get("user-agent");
  const session = await createSession(db, personId, agent);
  (await cookies()).set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    expires: session.expiresAt,
    path: "/",
  });
}

// Server actions = the internal RPC surface (C-14, IP-2_DESIGN D7).
// PX-3: the sender is selected by validated env — DevInboxSender in dev,
// the MSG91 adapter in production. Auth logic never changed (the ED-1 port).
const sender = createOtpSenderFromEnv(env, db);

export interface AuthFormState {
  step: "phone" | "code";
  phone: string;
  next?: string;
  error?: string;
}

/** Open-redirect-free return targets: relative paths only (IP-2 §6).
 * PX-2: the authenticated landing is /home — /account is never a login
 * destination (PX-1 01 §5). */
function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function requestOtpAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const phone = formString(formData, "phone");
  let result: Awaited<ReturnType<typeof requestOtp>>;
  try {
    result = await requestOtp(db, sender, phone, await requestIp());
  } catch (error) {
    // PX-3: provider failure (or open breaker) is an honest, retryable state —
    // never a crash screen on the front door.
    if (error instanceof OtpSendError) {
      return {
        step: "phone",
        phone,
        ...(_previous.next !== undefined ? { next: _previous.next } : {}),
        error: "We couldn't send the code right now. Wait a minute and try again.",
      };
    }
    throw error;
  }
  if (!result.ok) {
    const message =
      result.reason === "invalid-phone"
        ? "Enter a 10-digit Indian mobile number."
        : result.reason === "cooldown"
          ? "Code already sent — wait 30 seconds before requesting again."
          : "Too many codes requested. Try again in an hour.";
    return {
      step: "phone",
      phone,
      ...(_previous.next !== undefined ? { next: _previous.next } : {}),
      error: message,
    };
  }
  const normalized = normalizePhone(phone);
  return {
    step: "code",
    phone: normalized.ok ? normalized.phone : phone,
    ...(_previous.next !== undefined ? { next: _previous.next } : {}),
  };
}

export async function verifyOtpAction(
  previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const code = formString(formData, "code");
  const result = await verifyOtp(db, previous.phone, code);
  if (!result.ok) {
    return { step: "code", phone: previous.phone, error: "That code didn't work. Try again." };
  }
  await logSecurityEvent(result.personId, "auth.login.otp");
  await issueSessionCookie(result.personId);
  redirect(safeNext(previous.next));
}

// --- Passkeys (M-IP2-2) -----------------------------------------------------

export async function startPasskeyEnrollmentAction(): Promise<PublicKeyCredentialCreationOptionsJSON | null> {
  const session = await currentSession();
  if (session === null) {
    return null;
  }
  const options = await startEnrollment(db, session.personId);
  await setChallenge(options.challenge);
  return options;
}

export async function finishPasskeyEnrollmentAction(
  response: RegistrationResponseJSON,
  deviceName: string,
): Promise<{ ok: boolean }> {
  const session = await currentSession();
  const challenge = await takeChallenge();
  if (session === null || challenge === null) {
    return { ok: false };
  }
  try {
    return await finishEnrollment(db, session.personId, challenge, response, deviceName);
  } catch {
    return { ok: false };
  }
}

export async function startPasskeyLoginAction(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const options = await startAuthentication();
  await setChallenge(options.challenge);
  return options;
}

export async function finishPasskeyLoginAction(
  response: AuthenticationResponseJSON,
): Promise<{ ok: boolean }> {
  const challenge = await takeChallenge();
  if (challenge === null) {
    return { ok: false };
  }
  let result: { ok: true; personId: string } | { ok: false };
  try {
    result = await finishAuthentication(db, challenge, response);
  } catch {
    return { ok: false };
  }
  if (!result.ok) {
    return { ok: false };
  }
  await issueSessionCookie(result.personId);
  return { ok: true };
}

export async function renamePasskeyAction(passkeyId: string, name: string): Promise<void> {
  const session = await currentSession();
  if (session !== null) {
    await renamePasskey(db, session.personId, passkeyId, name);
  }
}

export async function removePasskeyAction(passkeyId: string): Promise<void> {
  const session = await currentSession();
  if (session !== null) {
    await removePasskey(db, session.personId, passkeyId);
  }
}

// --- Account security surface ------------------------------------------------

export interface AccountSecurity {
  passkeys: PasskeySummary[];
  sessions: (SessionSummary & { current: boolean })[];
  events: SecurityEvent[];
}

export async function accountSecurity(): Promise<AccountSecurity | null> {
  const session = await currentSession();
  if (session === null) {
    return null;
  }
  const [passkeys, sessionList, events] = await Promise.all([
    listPasskeys(db, session.personId),
    listSessions(db, session.personId),
    listSecurityEvents(session.personId),
  ]);
  return {
    passkeys,
    sessions: sessionList.map((entry) => ({ ...entry, current: entry.id === session.sessionId })),
    events,
  };
}

export async function revokeSessionAction(sessionId: string): Promise<void> {
  const session = await currentSession();
  if (session === null) {
    return;
  }
  const owned = await listSessions(db, session.personId);
  if (owned.some((entry) => entry.id === sessionId)) {
    await revokeSession(db, sessionId);
    await logSecurityEvent(session.personId, "auth.session.revoked");
  }
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token !== undefined) {
    const session = await getSessionByToken(db, token);
    if (session !== null) {
      await revokeSession(db, session.sessionId);
    }
  }
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function currentSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token === undefined) {
    return null;
  }
  return getSessionByToken(db, token);
}

// --- Profile (PX-3) -----------------------------------------------------------
// The one authorized identity write (PX-1 01 §7.2): sets the EXISTING
// people.name column inside the person's tenant boundary. No new identity model.

export interface ProfileFormState {
  error?: string;
  saved?: boolean;
}

export async function updateProfileAction(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/account");
  }
  const name = formString(formData, "name").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) {
    return { error: "Names are 2–60 characters." };
  }
  await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    db.update(people).set({ name }).where(eq(people.id, session.personId)),
  );
  await logSecurityEvent(session.personId, "profile.name.updated");
  return { saved: true };
}
