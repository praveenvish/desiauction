"use client";

import { Button, Field } from "@desiauction/ui";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { requestOtpAction, verifyOtpAction, type AuthFormState } from "../../server/auth/actions";
import { formatPhone } from "../../lib/format-phone";
import { track } from "../../lib/telemetry";
import {
  LoginConsent,
  LoginFrame,
  pasteDigits,
  useResendCountdown,
  writeLoginUrl,
} from "./login-shared";

/** Matches the server's RESEND_COOLDOWN_MS (otp.ts) — display only; the
 * server enforces the real limit. */
const RESEND_COOLDOWN_S = 30;

type Intent = "request" | "resend" | "verify";
type Step = "phone" | "code";

/** Routes one submission to the server action its intent names. */
async function submit(
  intent: Intent,
  previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (intent === "resend") {
    // Re-request for the same phone; on cooldown stay on the code step
    // with the server's message instead of bouncing back to phone entry.
    const result = await requestOtpAction({ ...previous, step: "phone" }, formData);
    return result.step === "phone" && result.error !== undefined
      ? { ...previous, error: result.error }
      : result;
  }
  if (intent === "request") {
    // "Use a different number" is a client-side step override — the server
    // state may still say "code"; the submitted intent is authoritative.
    return requestOtpAction({ ...previous, step: "phone" }, formData);
  }
  return verifyOtpAction(previous, formData);
}

/**
 * THE MOBILE DOOR — a player's registration and their place on a roster key on
 * a phone number, so this becomes the default again (LOGIN_DEFAULT_METHOD) once
 * SMS is live. Until then it works wherever OTP_PROVIDER does.
 */
export function PhoneSignIn({
  next,
  initialStep,
  initialPhone,
  honoredNext,
  returning,
}: {
  next?: string;
  initialStep: Step;
  initialPhone: string;
  honoredNext: boolean;
  returning: boolean;
}) {
  const [offline, setOffline] = useState(false);
  // Mirrors the URL. Seeded from the server's reading of it so the first client
  // render is byte-identical to the server's (no hydration mismatch).
  const [step, setStep] = useState<Step>(initialStep);
  const [phone, setPhone] = useState(initialPhone);
  const inputRef = useRef<HTMLInputElement>(null);
  const countdown = useResendCountdown(step === "code", RESEND_COOLDOWN_S);

  const [state, formAction, pending] = useActionState(
    async (previous: AuthFormState, formData: FormData): Promise<AuthFormState> => {
      // The submit button carries the intent. The fallback reads the payload
      // itself rather than the previous state: only the code step posts a
      // `code` field, so a submit with no named submitter still routes right.
      const intent =
        (formData.get("intent") as Intent | null) ??
        (formData.get("code") === null ? "request" : "verify");
      const result = await submit(intent, previous, formData);
      // What the answer means for the page is decided HERE, once per
      // submission, where the intent is known.
      if (result.step === "code") {
        setPhone(result.phone);
        if (result.error === undefined && intent !== "verify") {
          // A code went out (first send, resend, or a send to a corrected
          // number), so the resend countdown starts again from now.
          countdown.markSent();
        }
        if (intent === "request") {
          // A step forward, so it earns a history entry; resend and a failed
          // verify leave the page where it already is.
          setStep("code");
          writeLoginUrl("push", "phone", "code", result.phone, next);
        }
        if (result.error !== undefined) {
          track("auth.otp_failed");
        }
      }
      return result;
    },
    {
      step: initialStep,
      phone: initialPhone,
      ...(next !== undefined ? { next } : {}),
    },
  );

  // Back/Forward: the address bar is the authority.
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      const to = params.get("to");
      setStep(params.get("step") === "code" && to !== null ? "code" : "phone");
      if (to !== null) {
        setPhone(to);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // A rejected submit puts the caret back in the refused field — guarded on
  // <body>, so a caret the user deliberately placed elsewhere is never stolen.
  useEffect(() => {
    if (state.error !== undefined && document.activeElement === document.body) {
      inputRef.current?.focus();
    }
  }, [state]);

  useEffect(() => {
    track("auth.login_started");
  }, []);

  const locked = step === "code" && state.locked === true;
  const atStart = step === "phone";

  return (
    <LoginFrame
      title={atStart ? (returning ? "Welcome back" : "Sign in") : "Enter your code"}
      sub={
        atStart
          ? honoredNext
            ? "Sign in to continue where you were headed."
            : "One mobile number is all it takes — we'll text you a 6-digit code."
          : `We sent a 6-digit code to ${formatPhone(phone)}. It can take up to 30 seconds.`
      }
      method="phone"
      atStart={atStart}
      returning={returning}
      {...(next !== undefined ? { next } : {})}
    >
      <form
        action={formAction}
        className="login-form"
        data-testid="login-form"
        data-step={step}
        data-locked={locked}
        onSubmit={(event) => {
          setOffline(false);
          if (typeof navigator !== "undefined" && !navigator.onLine) {
            event.preventDefault();
            setOffline(true);
            return;
          }
          const submitter = event.nativeEvent.submitter;
          const intent =
            submitter instanceof HTMLButtonElement && submitter.value === "resend"
              ? "resend"
              : atStart
                ? "request"
                : "verify";
          track(
            intent === "resend"
              ? "auth.otp_resent"
              : intent === "request"
                ? "auth.otp_requested"
                : "auth.otp_verify_submitted",
          );
        }}
      >
        {offline ? (
          <p role="alert" className="login-error" data-testid="offline-note">
            You look offline — check your connection and try again.
          </p>
        ) : null}
        {atStart ? (
          <Field
            key="phone"
            ref={inputRef}
            label="Mobile number"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="98765 43210"
            required
            autoFocus
            defaultValue={phone}
            {...(state.error !== undefined ? { error: state.error } : {})}
            help="India (+91) only for now."
          />
        ) : (
          <>
            <input type="hidden" name="phone" value={phone} />
            <Field
              key="code"
              ref={inputRef}
              label="6-digit code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              required
              autoFocus
              onPaste={pasteDigits}
              {...(state.error !== undefined ? { error: state.error } : {})}
              help="Valid for 5 minutes. Didn't get it? Check your SMS, then resend."
            />
          </>
        )}
        {state.supportLink === true ? (
          <p className="login-error-help">
            <Link href="/support">Contact support</Link>
          </p>
        ) : null}
        <Button
          type="submit"
          name="intent"
          value={atStart ? "request" : "verify"}
          size="touch"
          loading={pending}
          // Another guess against a burned code cannot succeed. The button that
          // can is directly below.
          disabled={locked}
        >
          {atStart ? "Send code" : "Verify and continue"}
        </Button>
        {atStart ? <LoginConsent /> : null}
        {!atStart ? (
          <div className="login-resend-row">
            <Button
              type="submit"
              name="intent"
              value="resend"
              size="touch"
              variant={locked ? "secondary" : "ghost"}
              disabled={pending || countdown.secondsLeft > 0}
              data-testid="resend-code"
            >
              {countdown.secondsLeft > 0
                ? `Resend code in ${String(countdown.secondsLeft)}s`
                : "Resend code"}
            </Button>
            <button
              type="button"
              className="login-change-number"
              data-testid="change-number"
              onClick={() => {
                setStep("phone");
                // A correction, not a step forward: it replaces the code step
                // in history rather than stacking a third entry on it.
                writeLoginUrl("replace", "phone", "start", phone, next);
              }}
            >
              Use a different number
            </button>
          </div>
        ) : null}
      </form>
    </LoginFrame>
  );
}
