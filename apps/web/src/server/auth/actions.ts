"use server";

import { normalizePhone } from "@desiauction/core";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "../../env";
import { db } from "../db";
import { requestOtp, verifyOtp } from "./otp";
import { DevInboxSender } from "./otp-sender";
import { createSession, getSessionByToken, revokeSession, SESSION_COOKIE } from "./sessions";

// Server actions = the internal RPC surface (C-14, IP-2_DESIGN D7).
// RC-1: swap DevInboxSender for the real provider adapter; nothing else moves.
const sender = new DevInboxSender(db);

export interface AuthFormState {
  step: "phone" | "code";
  phone: string;
  error?: string;
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
  const result = await requestOtp(db, sender, phone);
  if (!result.ok) {
    const message =
      result.reason === "invalid-phone"
        ? "Enter a 10-digit Indian mobile number."
        : result.reason === "cooldown"
          ? "Code already sent — wait 30 seconds before requesting again."
          : "Too many codes requested. Try again in an hour.";
    return { step: "phone", phone, error: message };
  }
  const normalized = normalizePhone(phone);
  return { step: "code", phone: normalized.ok ? normalized.phone : phone };
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
  const agent = (await headers()).get("user-agent");
  const session = await createSession(db, result.personId, agent);
  (await cookies()).set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    expires: session.expiresAt,
    path: "/",
  });
  redirect("/account");
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
