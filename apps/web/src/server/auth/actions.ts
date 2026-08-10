"use server";

import { normalizePhone } from "@desiauction/core";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { people, withTenantDb } from "@desiauction/db";
import { eq } from "drizzle-orm";

import { env } from "../../env";
import { db, dbHandle } from "../db";
import { createPlayerSmsSender } from "../competition/registration-notify";
import { maySend } from "../messaging/consent";
import { SMS_TEMPLATES, renderTemplate } from "../messaging/templates";
import { requestOtp, verifyOtp } from "./otp";
import {
  confirmEmailVerification,
  requestEmailVerification,
  type EmailVerificationResult,
} from "./email-change";
import { createCodeMailer, MailSendError } from "./email-sender";
import { confirmPhoneChange, requestPhoneChange } from "./phone-change";
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
import {
  countSecurityEvents,
  listSecurityEvents,
  logSecurityEvent,
  type SecurityEvent,
} from "./security-events";
import {
  createSession,
  getSessionByToken,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  RETURNING_COOKIE,
  SESSION_COOKIE,
  type SessionSummary,
} from "./sessions";
import { describeUserAgent } from "./user-agent";

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
): Promise<ActionResult> {
  const session = await currentSession();
  const challenge = await takeChallenge();
  if (session === null) {
    return { ok: false, error: SESSION_LAPSED };
  }
  if (challenge === null) {
    return {
      ok: false,
      error: "That enrollment took too long. Tap Add passkey and try again.",
    };
  }
  const named = deviceName.trim().replace(/\s+/g, " ");
  if (named === "") {
    // A blank name silently became "Passkey". Two devices both called "Passkey"
    // defeat the entire point of the list they appear in.
    return { ok: false, error: "Name this device first — you'll need to tell them apart." };
  }
  try {
    const result = await finishEnrollment(db, session.personId, challenge, response, named);
    return result.ok ? { ok: true } : { ok: false, error: "That passkey couldn't be verified." };
  } catch {
    return { ok: false, error: "We couldn't save that passkey. Try again." };
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

/**
 * Every destructive action on this surface returns a RESULT.
 *
 * These three used to return `Promise<void>`. A failure was therefore not
 * merely unreported — it was unrepresentable: the caller did `.then(refresh)`
 * and a lapsed session, a row that had already gone, or a database error all
 * looked exactly like success. Removing your only passwordless credential is
 * not an operation that may fail silently.
 */
export interface ActionResult {
  ok: boolean;
  /** A sentence for a human. Present only when `ok` is false. */
  error?: string;
}

const SESSION_LAPSED = "Your session has expired. Sign in again to make this change.";

export async function renamePasskeyAction(passkeyId: string, name: string): Promise<ActionResult> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: SESSION_LAPSED };
  }
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed === "") {
    return { ok: false, error: "Give this device a name." };
  }
  if (trimmed.length > 60) {
    return { ok: false, error: "That's a bit long — 60 characters or fewer." };
  }
  try {
    await renamePasskey(db, session.personId, passkeyId, trimmed);
  } catch {
    return { ok: false, error: "We couldn't rename that passkey. Try again." };
  }
  return { ok: true };
}

export async function removePasskeyAction(passkeyId: string): Promise<ActionResult> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: SESSION_LAPSED };
  }
  try {
    await removePasskey(db, session.personId, passkeyId);
  } catch {
    return { ok: false, error: "We couldn't remove that passkey. Try again." };
  }
  return { ok: true };
}

// --- Account security surface ------------------------------------------------

export interface SessionView extends SessionSummary {
  current: boolean;
  /** "Chrome on macOS" — see `describeUserAgent`. Null when unparseable. */
  device: string | null;
}

export interface AccountSecurity {
  passkeys: PasskeySummary[];
  sessions: SessionView[];
  events: SecurityEvent[];
  /** How many events exist in total, so the panel can admit what it hides. */
  eventsTotal: number;
}

/**
 * How many security events the account panel loads. Ten was the old hard cap
 * and it could not show a passkey removal from last week, because ten sign-ins
 * had happened since. Fifty is loaded and the panel paginates locally; the
 * total is carried alongside so nothing is silently truncated.
 */
const ACCOUNT_EVENT_WINDOW = 50;

export async function accountSecurity(): Promise<AccountSecurity | null> {
  const session = await currentSession();
  if (session === null) {
    return null;
  }
  const [passkeys, sessionList, events, eventsTotal] = await Promise.all([
    listPasskeys(db, session.personId),
    listSessions(db, session.personId),
    listSecurityEvents(session.personId, ACCOUNT_EVENT_WINDOW),
    countSecurityEvents(session.personId),
  ]);
  // `listSessions` returns newest-first; this device is pinned above that,
  // wherever it happens to fall by last-seen. The one row a person needs to
  // recognise before revoking anything must not require scrolling to find.
  const viewed: SessionView[] = sessionList.map((entry) => ({
    ...entry,
    current: entry.id === session.sessionId,
    device: describeUserAgent(entry.userAgent),
  }));
  return {
    passkeys,
    sessions: [...viewed.filter((entry) => entry.current), ...viewed.filter((e) => !e.current)],
    events,
    eventsTotal,
  };
}

export async function revokeSessionAction(sessionId: string): Promise<ActionResult> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: SESSION_LAPSED };
  }
  // Ownership is proved against the caller's OWN session list, never against
  // the id they sent — a tampered id belonging to another account simply is
  // not in this set. Verified by security.regression: the victim's session
  // stays live.
  const owned = await listSessions(db, session.personId);
  if (!owned.some((entry) => entry.id === sessionId)) {
    return { ok: false, error: "That device is no longer signed in." };
  }
  try {
    await revokeSession(db, sessionId);
  } catch {
    return { ok: false, error: "We couldn't sign that device out. Try again." };
  }
  await logSecurityEvent(session.personId, "auth.session.revoked");
  return { ok: true };
}

/**
 * The one control that makes a long session list actionable. A person who
 * cannot tell 141 identical rows apart can still say "keep this device, drop
 * everything else" — which is the answer they actually want when they suspect
 * something is wrong.
 */
export async function revokeOtherSessionsAction(): Promise<ActionResult & { revoked?: number }> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: SESSION_LAPSED };
  }
  let revoked: number;
  try {
    revoked = await revokeOtherSessions(db, session.personId, session.sessionId);
  } catch {
    return { ok: false, error: "We couldn't sign the other devices out. Try again." };
  }
  if (revoked > 0) {
    await logSecurityEvent(session.personId, "auth.session.revoked");
  }
  return { ok: true, revoked };
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

/**
 * Sign out and come BACK to where you were.
 *
 * The invitation landings need this: an invite link is a bearer token, and the
 * person opening it on a shared handset is quite often signed in as somebody
 * else. "Not you? Sign out" has to return them to the same link afterwards,
 * which plain `logoutAction` (always /login) cannot do.
 *
 * `next` is not trusted: only a same-origin absolute path is honoured, and the
 * backslash form is rejected too — `\\evil.com` is a protocol-relative URL to
 * every browser (the open-redirect PX-11 closed).
 */
export async function logoutToAction(next: string): Promise<void> {
  const safe = safeNext(next);
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token !== undefined) {
    const session = await getSessionByToken(db, token);
    if (session !== null) {
      await revokeSession(db, session.sessionId);
    }
  }
  store.delete(SESSION_COOKIE);
  redirect(safe);
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
  /**
   * This save SET the name for the first time rather than changing one. The
   * toast said "Name updated" to people who had never had a name — the same
   * error the ledger used to make (see `profile.name.set`).
   */
  firstTime?: boolean;
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
  const isFirstName = session.name === null || session.name.trim() === "";
  await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    db.update(people).set({ name }).where(eq(people.id, session.personId)),
  );
  await logSecurityEvent(
    session.personId,
    isFirstName ? "profile.name.set" : "profile.name.updated",
  );
  if (fromOnboarding) {
    // The exit used to be a client effect: render the saved state, run an
    // effect, then router.push("/home") — measured at ~1.9s of the user staring
    // at a finished form. The server already knows where this goes.
    //
    // And it now goes BACK to wherever the name gate interrupted, not always
    // /home: an owner who accepted an invitation and was stopped for their name
    // on the way into the auction room belongs in the auction room. The field
    // is user-controlled, so it goes through the PX-11 allowlist, which folds
    // anything unexpected (including absent) to /home.
    redirect(safeNext(formString(formData, "next")));
  }
  return { saved: true, firstTime: isFirstName };
}

/**
 * CHANGING THE MOBILE ON AN ACCOUNT.
 *
 * The product's one credential, and until now a permanent one: `people.phone`
 * was written at first sign-in and no path ever changed it. That made losing a
 * number an unrecoverable lockout, and made a carrier recycling a number an
 * account takeover — see `phone-change.ts` for both, and for what this flow can
 * and cannot fix.
 *
 * Two steps, mirroring sign-in: a code to the NEW number, then confirmation.
 * The session proves the account; the code proves the handset.
 */

export interface PhoneChangeState {
  step: "idle" | "code";
  /** The number being moved to, normalized once the request is accepted. */
  phone?: string;
  error?: string;
  done?: boolean;
}

export async function requestPhoneChangeAction(
  previous: PhoneChangeState,
  formData: FormData,
): Promise<PhoneChangeState> {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/account");
  }
  const phone = formString(formData, "phone");
  let result: Awaited<ReturnType<typeof requestPhoneChange>>;
  try {
    result = await requestPhoneChange(db, sender, {
      personId: session.personId,
      newPhone: phone,
      requestIp: await requestIp(),
    });
  } catch (error) {
    // Same contract as the front door: a melted provider is a retryable state,
    // never a crash screen — and here it is a crash screen on a settings page
    // somebody reached while already worried about their account.
    if (error instanceof OtpSendError) {
      return { step: "idle", error: "We couldn't send the code right now. Try again in a minute." };
    }
    throw error;
  }
  if (!result.ok) {
    const message: Record<typeof result.reason, string> = {
      "invalid-phone":
        phone.trim() === ""
          ? "Enter the new mobile number."
          : "That doesn't look like an Indian mobile number — 10 digits starting 6–9.",
      "same-number": "That is already the number on this account.",
      cooldown: "Code already sent — wait 30 seconds before requesting another.",
      "hourly-limit": "Too many codes for that number. Try again in an hour.",
    };
    return { step: previous.step, error: message[result.reason] };
  }
  const normalized = normalizePhone(phone);
  return { step: "code", phone: normalized.ok ? normalized.phone : phone };
}

export async function confirmPhoneChangeAction(
  previous: PhoneChangeState,
  formData: FormData,
): Promise<PhoneChangeState> {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/account");
  }
  const target = previous.phone ?? "";
  const result = await confirmPhoneChange(db, {
    personId: session.personId,
    newPhone: target,
    code: formString(formData, "code"),
  });
  if (!result.ok) {
    const message: Record<typeof result.reason, string> = {
      invalid:
        result.attemptsLeft === undefined
          ? "That code didn't match. Request a new one."
          : `That code didn't match. ${String(result.attemptsLeft)} attempts left.`,
      expired: "That code has expired. Request a new one.",
      locked: "Too many attempts. Request a new code.",
      // Named plainly rather than hidden behind "something went wrong": the
      // person is holding the handset, so they have learned a fact about a
      // number they control, and a vague refusal here is a support ticket.
      taken: "That number already signs in to another account.",
      "invalid-phone": "Start again — that number could not be read.",
      "no-person": "Sign in again and retry.",
    };
    return { step: "code", phone: target, error: message[result.reason] };
  }

  await logSecurityEvent(session.personId, "auth.phone.changed");
  /*
   * Tell the OUTGOING number, and never fail the change on it.
   *
   * This is the compensating control for the one thing this flow does not
   * verify: it does not ask for the old number, because requiring it would
   * leave "I lost my phone" exactly as unrecoverable as before. So a stolen
   * session could move a number — and the number it moved away from is told
   * while somebody can still read it.
   *
   * Best effort by construction. The change has committed; a provider outage
   * must cost a warning message, never leave the account half-moved.
   */
  try {
    await notifyPhoneChanged(result.previousPhone, result.newPhone);
  } catch {
    // Deliberately swallowed. See above.
  }
  return { step: "idle", done: true };
}

async function notifyPhoneChanged(previousPhone: string, newPhone: string): Promise<void> {
  const template = SMS_TEMPLATES["security.phone_changed"];
  const rendered = renderTemplate(template, { last4: newPhone.slice(-4) });
  if (!rendered.ok) {
    return;
  }
  // The gate still applies. Somebody who texted STOP has said they want no
  // messages, and a security notice does not outrank that — the change is on
  // their security ledger either way, which is a place they can look.
  const decision = await maySend(db, {
    contact: previousPhone,
    channel: "sms",
    category: template.category,
    scope: "security",
  });
  if (!decision.send) {
    return;
  }
  await createPlayerSmsSender(db).send(previousPhone, {
    template,
    slots: rendered.slots,
    body: rendered.body,
  });
}

/**
 * ADDING A VERIFIED EMAIL ADDRESS.
 *
 * The email delivery adapter has refused every document with `no_email_on_file`
 * since it was written, correctly: this product has never collected an address.
 * Its own comment named the three missing pieces — a column, a form field and a
 * verification flow — and this is the last of them.
 *
 * The address is written only once a code sent to that mailbox comes back. An
 * unverified address is a liability rather than a channel: a mistyped domain
 * would put a club's receipt, with a name and an amount on it, into a
 * stranger's inbox.
 */

/** The address on the account, and whether it has been confirmed. */
export async function accountEmail(): Promise<{ email: string | null; verified: boolean }> {
  const session = await currentSession();
  if (session === null) {
    return { email: null, verified: false };
  }
  const [row] = await db
    .select({ email: people.email, verifiedAt: people.emailVerifiedAt })
    .from(people)
    .where(eq(people.id, session.personId))
    .limit(1);
  return { email: row?.email ?? null, verified: row?.verifiedAt != null };
}

export interface EmailChangeState {
  step: "idle" | "code";
  email?: string;
  error?: string;
  done?: boolean;
}

export async function requestEmailVerificationAction(
  previous: EmailChangeState,
  formData: FormData,
): Promise<EmailChangeState> {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/account");
  }
  const raw = formString(formData, "email");
  const result = await requestEmailVerification(db, { personId: session.personId, email: raw });
  if (!result.ok) {
    const message: Record<typeof result.reason, string> = {
      "invalid-email":
        raw.trim() === "" ? "Enter an email address." : "That doesn't look like an email address.",
      "same-email": "That address is already confirmed on this account.",
      "hourly-limit": "Too many confirmation emails. Try again in an hour.",
    };
    return { step: previous.step, error: message[result.reason] };
  }
  try {
    await createCodeMailer(db).send(result.email, result.code);
  } catch (error) {
    if (error instanceof MailSendError) {
      // The code is already minted and will simply go unused. Saying so beats a
      // crash screen, and beats a code step for a message that never arrived.
      return { step: "idle", error: "We couldn't send that email right now. Try again shortly." };
    }
    throw error;
  }
  return { step: "code", email: result.email };
}

export async function confirmEmailVerificationAction(
  previous: EmailChangeState,
  formData: FormData,
): Promise<EmailChangeState> {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/account");
  }
  const result: EmailVerificationResult = await confirmEmailVerification(db, {
    personId: session.personId,
    code: formString(formData, "code"),
  });
  if (!result.ok) {
    const message: Record<typeof result.reason, string> = {
      invalid:
        result.attemptsLeft === undefined
          ? "That code didn't match. Request a new one."
          : `That code didn't match. ${String(result.attemptsLeft)} attempts left.`,
      expired: "That code has expired. Request a new one.",
      locked: "Too many attempts. Request a new code.",
      // Named plainly: the person holds the mailbox, so they have learned a
      // fact about an address they control.
      taken: "That address is already confirmed on another account.",
    };
    return { step: "code", email: previous.email ?? "", error: message[result.reason] };
  }
  await logSecurityEvent(session.personId, "profile.email.verified");
  revalidatePath("/account");
  return { step: "idle", done: true, email: result.email };
}
