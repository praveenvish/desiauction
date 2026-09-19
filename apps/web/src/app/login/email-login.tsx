"use client";

import { Button, Field } from "@desiauction/ui";
import { useActionState, useEffect, useRef, useState } from "react";

import {
  requestEmailLoginAction,
  verifyEmailLoginAction,
  type EmailAuthFormState,
} from "../../server/auth/actions";
import { track } from "../../lib/telemetry";
import { LoginFrame, pasteDigits, useResendCountdown, writeLoginUrl } from "./login-shared";

/** Display only — `requestEmailLogin` holds the real per-address budget. */
const RESEND_COOLDOWN_S = 30;

type Intent = "request" | "resend" | "verify";

/**
 * THE EMAIL DOOR — the default one until SMS is live (LOGIN_DEFAULT_METHOD).
 *
 * Indian SMS needs DLT registration with TRAI before a single transactional
 * message can be sent, and an email code needs nothing. It signs in AND signs
 * up: an address nobody has used gets a code too, and proving that code is what
 * creates the account (0063). No passwords — C-24 — so there is nothing to
 * reset, reuse or steal; a passkey is the one-tap way back after the first code.
 *
 * The form never says whether an address is on an account. Every well-formed
 * address advances to the code step with the same words, because a form that
 * behaved differently for unknown addresses would be a membership oracle for
 * anybody with a list of them.
 */
export function EmailSignIn({
  next,
  initialStep,
  initialEmail,
  honoredNext,
  returning,
}: {
  next?: string;
  initialStep: "email" | "code";
  initialEmail: string;
  honoredNext: boolean;
  returning: boolean;
}) {
  const [step, setStep] = useState(initialStep);
  const [email, setEmail] = useState(initialEmail);
  const inputRef = useRef<HTMLInputElement>(null);
  const countdown = useResendCountdown(step === "code", RESEND_COOLDOWN_S);

  const [state, formAction, pending] = useActionState(
    async (previous: EmailAuthFormState, formData: FormData): Promise<EmailAuthFormState> => {
      const intent =
        (formData.get("intent") as Intent | null) ??
        (formData.get("code") === null ? "request" : "verify");
      if (intent === "verify") {
        // Succeeds by redirecting; only a refusal comes back.
        return verifyEmailLoginAction(previous, formData);
      }
      const result = await requestEmailLoginAction({ ...previous, step: "email" }, formData);
      if (result.step === "code") {
        setEmail(result.email);
        countdown.markSent();
        if (intent === "request") {
          setStep("code");
          writeLoginUrl("push", "email", "code", result.email, next);
        }
        return result;
      }
      // A refused RESEND keeps the person on the code step, holding the code
      // that may already have arrived, with the server's reason beside it.
      return intent === "resend"
        ? {
            ...previous,
            step: "code",
            ...(result.error !== undefined ? { error: result.error } : {}),
          }
        : result;
    },
    {
      step: initialStep,
      email: initialEmail,
      ...(next !== undefined ? { next } : {}),
    },
  );

  // Back/Forward restore the step the address bar names.
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      const to = params.get("to");
      setStep(params.get("step") === "code" && to !== null ? "code" : "email");
      if (to !== null) {
        setEmail(to);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // A refusal puts the caret back in the field it concerns (never stealing one
  // the person placed elsewhere), which also carries aria-describedby to it.
  useEffect(() => {
    if (state.error !== undefined && document.activeElement === document.body) {
      inputRef.current?.focus();
    }
  }, [state]);

  const atStart = step === "email";
  return (
    <LoginFrame
      title={atStart ? (returning ? "Welcome back" : "Sign in") : "Check your email"}
      sub={
        atStart
          ? honoredNext
            ? "Sign in to continue where you were headed."
            : returning
              ? "Use your passkey, or we'll email you a code."
              : "We'll email you a 6-digit code — no password needed."
          : // Conditional on reaching the mailbox, never on finding an account —
            // the one address mailed nothing (claimed on an account that never
            // confirmed it) must read exactly like every other.
            `If we can reach ${email}, a 6-digit code is on its way. It can take a minute.`
      }
      subTestId={atStart ? undefined : "email-login-sent"}
      method="email"
      atStart={atStart}
      returning={returning}
      {...(next !== undefined ? { next } : {})}
    >
      <form
        action={formAction}
        className="login-form"
        data-testid="email-login-form"
        data-step={step}
        onSubmit={(event) => {
          const submitter = event.nativeEvent.submitter;
          track(
            submitter instanceof HTMLButtonElement && submitter.value === "resend"
              ? "auth.otp_resent"
              : atStart
                ? "auth.otp_requested"
                : "auth.otp_verify_submitted",
          );
        }}
      >
        {next !== undefined ? <input type="hidden" name="next" value={next} /> : null}
        {atStart ? (
          <Field
            key="email"
            ref={inputRef}
            label="Email address"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            defaultValue={email}
            {...(state.error !== undefined ? { error: state.error } : {})}
            data-testid="email-login-address"
          />
        ) : (
          <>
            <input type="hidden" name="email" value={email} />
            <Field
              key="code"
              ref={inputRef}
              label="6-digit code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              autoFocus
              onPaste={pasteDigits}
              help="Valid for 15 minutes. Not in your inbox? Check spam or promotions."
              {...(state.error !== undefined ? { error: state.error } : {})}
              data-testid="email-login-code"
            />
          </>
        )}
        <Button
          type="submit"
          name="intent"
          value={atStart ? "request" : "verify"}
          size="touch"
          loading={pending}
          data-testid={atStart ? "email-login-send" : "email-login-verify"}
        >
          {atStart ? "Email me a code" : "Verify and continue"}
        </Button>
        {atStart && !returning ? (
          // Said once, under the button it applies to, and only to a device
          // that has never signed in — a returning one does not need telling.
          <p className="login-hint" data-testid="email-login-new-hint">
            New to DesiAuction? The same code creates your account.
          </p>
        ) : null}
        {!atStart ? (
          <div className="login-resend-row">
            <Button
              type="submit"
              name="intent"
              value="resend"
              size="touch"
              variant="ghost"
              disabled={pending || countdown.secondsLeft > 0}
              data-testid="email-resend-code"
            >
              {countdown.secondsLeft > 0
                ? `Resend code in ${String(countdown.secondsLeft)}s`
                : "Resend code"}
            </Button>
            <button
              type="button"
              className="login-change-number"
              data-testid="email-change-address"
              onClick={() => {
                setStep("email");
                writeLoginUrl("replace", "email", "start", email, next);
              }}
            >
              Use a different email
            </button>
          </div>
        ) : null}
      </form>
    </LoginFrame>
  );
}
