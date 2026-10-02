"use server";

import { headers } from "next/headers";

import { env } from "../../env";
import { clientIp } from "../../lib/client-ip";
import { db } from "../db";
import { logger } from "../logger";
import { sendSignInCodeMail } from "../messaging/notify";
import { currentRequestContext } from "../messaging/request-context";
import { currentSession } from "./actions";
import { MailSendError } from "./email-sender";
import { OtpSendError, createOtpSenderFromEnv } from "./otp-sender";
import { confirmStepUpCode, requestStepUpCode, steppedUpRecently } from "./step-up";

/*
 * "CONFIRM IT'S YOU" — the two clicks behind the step-up dialog (AC-1.1).
 *
 * Both act only on the caller's OWN session: there is no person id or session
 * id in the arguments to forge. The confirmation is useful only to a screen
 * that then retries a gated action, which checks it again on the server.
 */

const sender = createOtpSenderFromEnv(env, db);

export type StepUpRequestState =
  { ok: true; sentTo: string } | { ok: false; error: string; signedOut?: boolean };

export async function requestStepUpAction(): Promise<StepUpRequestState> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: "You've been signed out. Sign in again.", signedOut: true };
  }
  let result;
  try {
    result = await requestStepUpCode(db, sender, {
      personId: session.personId,
      requestIp: clientIp(await headers(), env.TRUSTED_PROXY_COUNT),
      globalPerHour: env.OTP_GLOBAL_HOURLY_CAP,
    });
  } catch (error) {
    if (error instanceof OtpSendError) {
      return { ok: false, error: "We couldn't send the code right now. Try again in a minute." };
    }
    throw error;
  }
  if (!result.ok) {
    const message: Record<typeof result.reason, string> = {
      "no-channel": "Add a verified email or phone to your account first.",
      cooldown: "A code was just sent. Wait a few seconds before asking again.",
      "hourly-limit": "Too many codes this hour. Try again later.",
      busy: "We're sending a lot of codes right now. Try again in a minute.",
      "invalid-phone": "Your account's phone number can't receive codes. Add a verified email.",
    };
    return { ok: false, error: message[result.reason] };
  }
  if (result.mail !== null) {
    try {
      await sendSignInCodeMail(
        db,
        result.mail.email,
        result.mail.code,
        "step_up",
        session.personId,
        await currentRequestContext(),
      );
    } catch (error) {
      if (error instanceof MailSendError) {
        logger().warn({ reason: error.message }, "step_up.email_send_failed");
        return { ok: false, error: "We couldn't send the email right now. Try again shortly." };
      }
      throw error;
    }
  }
  return { ok: true, sentTo: result.sentTo };
}

export type StepUpConfirmState = { ok: true } | { ok: false; error: string };

export async function confirmStepUpAction(code: string): Promise<StepUpConfirmState> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: "You've been signed out. Sign in again." };
  }
  if (!/^\d{6}$/.test(code.trim())) {
    return { ok: false, error: "Enter the 6-digit code." };
  }
  const result = await confirmStepUpCode(db, {
    personId: session.personId,
    sessionId: session.sessionId,
    code,
  });
  if (!result.ok) {
    const message: Record<typeof result.reason, string> = {
      invalid:
        result.attemptsLeft === undefined
          ? "That code didn't match. Ask for a new one."
          : `That code didn't match. ${String(result.attemptsLeft)} attempts left.`,
      expired: "That code has expired. Ask for a new one.",
      locked: "Too many wrong tries. Ask for a new code.",
      "no-channel": "Add a verified email or phone to your account first.",
    };
    return { ok: false, error: message[result.reason] };
  }
  return { ok: true };
}

/** Whether this session is confirmed right now (the dialog skips itself if so). */
export async function stepUpStatusAction(): Promise<{ fresh: boolean }> {
  const session = await currentSession();
  return { fresh: session !== null && steppedUpRecently(session) };
}
