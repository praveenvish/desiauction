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
  RETURNING_COOKIE,
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
  const store = await cookies();
  store.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    expires: session.expiresAt,
    path: "/",
  });
  store.set(RETURNING_COOKIE, "1", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
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
  /**
   * The code in hand is burned (five wrong guesses). The only way forward is a
   * fresh code, so the form stops offering another guess and points at Resend.
   * Without this the page said "try again" about the one thing that could never
   * work again, while the correct code sat in the user's SMS app.
   */
  locked?: boolean;
  /**
   * This failure is not the user's to fix (the hourly ceiling). The form renders
   * a door to /support beside the message instead of leaving a dead end.
   */
  supportLink?: boolean;
}

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
  const carriedNext = _previous.next !== undefined ? { next: _previous.next } : {};
  const normalized = normalizePhone(phone);
  if (!result.ok) {
    if (result.reason === "cooldown") {
      // THE COOLDOWN BELONGS ON THE CODE STEP. A cooldown means a live code was
      // sent to this handset in the last 30 seconds — the user is holding it.
      // Returning them to phone entry gave them the one screen with no field to
      // type it into, which is how a refresh (or an app-switch to read the SMS,
      // which is the mandatory middle step on a phone) turned into a dead end.
      // The resend path has always done this correctly; this is the same
      // behaviour on the fresh-request path, not a new one.
      return {
        step: "code",
        phone: normalized.ok ? normalized.phone : phone,
        ...carriedNext,
        error: "Code already sent — wait 30 seconds before requesting again.",
      };
    }
    if (result.reason === "hourly-limit") {
      return {
        step: "phone",
        phone,
        ...carriedNext,
        error:
          "Too many codes for this number. Try again in an hour, or contact support if you're locked out.",
        supportLink: true,
      };
    }
    // Blank and malformed are different mistakes and deserve different
    // sentences: one is "you haven't answered yet", the other is "what you
    // typed cannot be a number", and only the second needs the rule spelled out.
    return {
      step: "phone",
      phone,
      ...carriedNext,
      error:
        phone.trim() === ""
          ? "Enter your mobile number."
          : "That doesn't look like an Indian mobile number — 10 digits starting 6–9.",
    };
  }
  return {
    step: "code",
    phone: normalized.ok ? normalized.phone : phone,
    ...carriedNext,
  };
}

export async function verifyOtpAction(
  previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const code = formString(formData, "code");
  const result = await verifyOtp(db, previous.phone, code);
  if (!result.ok) {
    // Three different failures used to share one sentence — "That code didn't
    // work. Try again." — and only ONE of them was fixed by trying again. The
    // other two (expired, burned) sent the user back into a loop that could
    // never succeed. `next` now survives the failure too; losing it meant a
    // mistyped digit silently forgot where the person was headed.
    const base = {
      step: "code" as const,
      phone: previous.phone,
      ...(previous.next !== undefined ? { next: previous.next } : {}),
    };
    if (result.reason === "locked") {
      return {
        ...base,
        error: "Too many attempts on this code. Tap 'Resend code' to get a new one.",
        locked: true,
      };
    }
    if (result.reason === "expired") {
      return { ...base, error: "That code has expired. Tap 'Resend code' for a fresh one." };
    }
    return {
      ...base,
      error:
        result.attemptsLeft === undefined
          ? "That code isn't right. Check the latest SMS, or resend."
          : `That code isn't right. ${String(result.attemptsLeft)} ${
              result.attemptsLeft === 1 ? "attempt" : "attempts"
            } left.`,
    };
  }
  await logSecurityEvent(result.personId, "auth.login.otp");
  await issueSessionCookie(result.personId);
  const target = safeNext(previous.next);
  // A brand-new (nameless) account used to be verified, sent to /home, and
  // bounced from there to /onboarding — two round trips to reach the one screen
  // it was always going to. Only the DEFAULT destination is re-pointed: a token
  // flow (`/join/...`, `/owner-join/...`) still lands exactly where it was
  // going, because onboarding must never hijack an invite.
  if (target === "/home" && (result.name === null || result.name.trim() === "")) {
    redirect("/onboarding");
  }
  redirect(target);
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
  /** What was typed, echoed back so a rejected submit does not wipe the field. */
  name?: string;
}

/**
 * Serves two forms: the onboarding gate and /account's profile panel. They
 * differ in exactly one way — onboarding has somewhere to go afterwards — so the
 * onboarding form declares itself with a hidden `onboarding=1` and the action
 * finishes the journey server-side. /account keeps its `{ saved: true }` toast.
 */
export async function updateProfileAction(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const fromOnboarding = formString(formData, "onboarding") === "1";
  const session = await currentSession();
  if (session === null) {
    // Send them back to the form they were actually filling in. The old target
    // was always /account — for someone whose session lapsed halfway through
    // onboarding that is a page they had never opened, and (nameless) not the
    // step they owe the product. `/home` remains the only invented default
    // (PX-1 01 §5); this is the page the person was on, not a new landing.
    redirect(fromOnboarding ? "/login?next=/onboarding" : "/login?next=/account");
  }
  const raw = formString(formData, "name");
  const name = raw.trim().replace(/\s+/g, " ");
  // "Names are 2–60 characters." was the answer to a question the user had not
  // been asked: on a blank submit it read as a rule they had broken.
  if (name === "") {
    return { error: "Enter your name.", name: raw };
  }
  if (name.length < 2) {
    return { error: "That's a bit short — 2 characters or more.", name: raw };
  }
  if (name.length > 60) {
    return { error: "That's a bit long — 60 characters or fewer.", name: raw };
  }
  await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    db.update(people).set({ name }).where(eq(people.id, session.personId)),
  );
  await logSecurityEvent(session.personId, "profile.name.updated");
  if (fromOnboarding) {
    // The exit used to be a client effect: render the saved state, run an
    // effect, then router.push("/home") — measured at ~1.9s of the user staring
    // at a finished form. The server already knows where this goes.
    redirect("/home");
  }
  return { saved: true };
}
