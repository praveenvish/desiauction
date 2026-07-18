"use client";

import { Button, Field } from "@desiauction/ui";
import { useActionState, useEffect, useRef, useState } from "react";

import { requestOtpAction, verifyOtpAction, type AuthFormState } from "../../server/auth/actions";
import { track } from "../../lib/telemetry";

/** Matches the server's RESEND_COOLDOWN_MS (otp.ts) — display only; the
 * server enforces the real limit. */
const RESEND_COOLDOWN_S = 30;

type Intent = "request" | "resend" | "verify";

export function LoginForm({ next }: { next?: string }) {
  const intentRef = useRef<Intent>("request");
  const [changedNumber, setChangedNumber] = useState(false);
  const [offline, setOffline] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [, setTick] = useState(0);

  const [state, formAction, pending] = useActionState(
    async (previous: AuthFormState, formData: FormData): Promise<AuthFormState> => {
      const intent = (formData.get("intent") as Intent | null) ?? "request";
      if (intent === "resend") {
        // Re-request for the same phone; on cooldown stay on the code step
        // with the server's message instead of bouncing back to phone entry.
        const result = await requestOtpAction({ ...previous, step: "phone" }, formData);
        return result.step === "phone" && result.error !== undefined
          ? { ...previous, error: result.error }
          : result;
      }
      if (intent === "request" || previous.step === "phone") {
        // "Use a different number" is a client-side step override — the server
        // state may still say "code"; the submitted intent is authoritative.
        return requestOtpAction({ ...previous, step: "phone" }, formData);
      }
      return verifyOtpAction(previous, formData);
    },
    { step: "phone", phone: "", ...(next !== undefined ? { next } : {}) },
  );

  // The client-side reset for "Use a different number": render the phone step
  // without a server round-trip; any next dispatch clears the override.
  const effective: AuthFormState = changedNumber
    ? { step: "phone", phone: state.phone, ...(next !== undefined ? { next } : {}) }
    : state;

  const prevStepRef = useRef<AuthFormState["step"]>("phone");
  useEffect(() => {
    const arrivedAtCode =
      state.step === "code" &&
      state.error === undefined &&
      (prevStepRef.current === "phone" || intentRef.current === "resend");
    if (arrivedAtCode) {
      setSentAt(Date.now());
    }
    if (state.step === "code" && state.error !== undefined) {
      track("auth.otp_failed");
    }
    prevStepRef.current = state.step;
    intentRef.current = "request";
  }, [state]);

  useEffect(() => {
    track("auth.login_started");
  }, []);

  const secondsLeft =
    sentAt === null ? 0 : Math.max(0, RESEND_COOLDOWN_S - Math.floor((Date.now() - sentAt) / 1000));

  // Tick the countdown once a second while it's running.
  useEffect(() => {
    if (effective.step !== "code" || secondsLeft <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [effective.step, secondsLeft]);

  return (
    <form
      action={formAction}
      className="login-form"
      data-testid="login-form"
      data-step={effective.step}
      onSubmit={(event) => {
        setChangedNumber(false);
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
            : effective.step === "phone"
              ? "request"
              : "verify";
        intentRef.current = intent;
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
      {effective.step === "phone" ? (
        <Field
          key="phone"
          label="Mobile number"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="98765 43210"
          required
          autoFocus
          defaultValue={effective.phone}
          {...(effective.error !== undefined ? { error: effective.error } : {})}
          help="We'll send a 6-digit code. India (+91) only for now."
        />
      ) : (
        <>
          <input type="hidden" name="phone" value={effective.phone} />
          <Field
            key="code"
            label={`Code sent to ${effective.phone}`}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            required
            autoFocus
            {...(effective.error !== undefined ? { error: effective.error } : {})}
            help="Valid for 5 minutes. Codes can expire — a fresh one is a tap away."
          />
        </>
      )}
      <Button
        type="submit"
        name="intent"
        value={effective.step === "phone" ? "request" : "verify"}
        loading={pending}
      >
        {effective.step === "phone" ? "Send code" : "Sign in"}
      </Button>
      {effective.step === "code" ? (
        <div className="login-resend-row">
          <Button
            type="submit"
            name="intent"
            value="resend"
            variant="ghost"
            disabled={pending || secondsLeft > 0}
            data-testid="resend-code"
          >
            {secondsLeft > 0 ? `Resend code in ${String(secondsLeft)}s` : "Resend code"}
          </Button>
          <button
            type="button"
            className="login-change-number"
            data-testid="change-number"
            onClick={() => {
              setChangedNumber(true);
            }}
          >
            Use a different number
          </button>
        </div>
      ) : null}
    </form>
  );
}
