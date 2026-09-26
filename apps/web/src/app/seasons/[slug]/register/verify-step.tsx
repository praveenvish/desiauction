"use client";

import { Button, Field, IconMail, IconPhone } from "@desiauction/ui";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { formatPhone } from "../../../../lib/format-phone";
import { track } from "../../../../lib/telemetry";
import {
  requestEmailLoginAction,
  requestOtpAction,
  verifyEmailLoginAction,
  verifyOtpAction,
  type AuthFormState,
  type EmailAuthFormState,
} from "../../../../server/auth/actions";
import {
  LoginConsent,
  pasteDigits,
  submitWholeCode,
  useResendCountdown,
  type LoginMethod,
} from "../../../login/login-shared";
import { RegStepper } from "./reg-stepper";

/** Display only — the server holds the real cooldown (otp.ts / email-login.ts). */
const RESEND_COOLDOWN_S = 30;

type Intent = "request" | "resend" | "verify";

/**
 * STEP 1 OF THE REGISTER WIZARD — WITHOUT LEAVING THE REGISTER PAGE.
 *
 * The share link used to hand a stranger to /login and hope they found their
 * way back. Verification is now the first step of the same card. Nothing about
 * HOW a person is verified changed: these forms post to the exact server
 * actions /login posts to — the same rate limits, the same code checks, the
 * same terms consent, the same session cookie — with `next` set to this page,
 * which the verify action runs through `safeNext` and redirects to. The page
 * then re-renders signed in and the wizard carries on from step 2.
 *
 * Unlike /login the step is NOT written into the URL: this page's URL is the
 * shared link (with its `?ref`), and it must stay exactly that.
 */
export function VerifyStep({
  next,
  defaultMethod,
}: {
  /** This register URL, `?ref` included. */
  next: string;
  /** LOGIN_DEFAULT_METHOD — email until SMS is live. */
  defaultMethod: LoginMethod;
}) {
  const [method, setMethod] = useState<LoginMethod>(defaultMethod);
  const [atCode, setAtCode] = useState(false);

  useEffect(() => {
    track("auth.login_started", { surface: "register" });
  }, []);

  // Said up front: an email account still owes a mobile number, and that
  // second code is a step of its own, not a surprise after the first.
  const labels =
    method === "email"
      ? ["Verify", "Mobile", "You", "How you play", "Confirm"]
      : ["Verify", "You", "How you play", "Confirm"];
  return (
    <>
      <RegStepper labels={labels} current={0} />
      <section className="reg-step reg-verify" data-testid="register-step-verify">
        <header className="reg-step-head">
          <h2 className="reg-step-title">
            {atCode ? "Enter your code" : "First, verify it's you"}
          </h2>
          {atCode ? null : (
            <p className="reg-step-lede">
              New here or coming back — one 6-digit code does both. No password.
            </p>
          )}
        </header>
        {atCode ? null : (
          <div className="reg-method" role="group" aria-label="Get your code by">
            {(["email", "phone"] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                className="reg-method-option"
                aria-pressed={method === entry}
                data-testid={`register-method-${entry}`}
                onClick={() => {
                  setMethod(entry);
                }}
              >
                {entry === "email" ? <IconMail size={16} /> : <IconPhone size={16} />}
                {entry === "email" ? "Email" : "Mobile"}
              </button>
            ))}
          </div>
        )}
        {method === "email" ? (
          <EmailVerify key="email" next={next} onStep={setAtCode} />
        ) : (
          <PhoneVerify key="phone" next={next} onStep={setAtCode} />
        )}
        {atCode ? null : <LoginConsent />}
      </section>
    </>
  );
}

/** The resend + "change it" row under a code field. */
function ResendRow({
  pending,
  secondsLeft,
  changeLabel,
  onChange,
  emphasise,
}: {
  pending: boolean;
  secondsLeft: number;
  changeLabel: string;
  onChange: () => void;
  emphasise: boolean;
}) {
  return (
    <div className="reg-verify-resend">
      <Button
        type="submit"
        name="intent"
        value="resend"
        size="touch"
        variant={emphasise ? "secondary" : "ghost"}
        disabled={pending || secondsLeft > 0}
        data-testid="register-verify-resend"
      >
        {secondsLeft > 0 ? `Resend code in ${String(secondsLeft)}s` : "Resend code"}
      </Button>
      <button type="button" className="reg-verify-change" onClick={onChange}>
        {changeLabel}
      </button>
    </div>
  );
}

function PhoneVerify({ next, onStep }: { next: string; onStep: (atCode: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const countdown = useResendCountdown(true, RESEND_COOLDOWN_S);
  const [state, formAction, pending] = useActionState(
    async (previous: AuthFormState, formData: FormData): Promise<AuthFormState> => {
      const intent =
        (formData.get("intent") as Intent | null) ??
        (formData.get("code") === null ? "request" : "verify");
      if (intent === "verify") {
        // Succeeds by redirecting back to this page, signed in.
        const result = await verifyOtpAction(previous, formData);
        if (result.error !== undefined) {
          track("auth.otp_failed", { surface: "register" });
        }
        return result;
      }
      const result = await requestOtpAction({ ...previous, step: "phone" }, formData);
      if (intent === "resend" && result.step === "phone") {
        // A refused resend keeps them on the code step, holding their code.
        return { ...previous, ...(result.error !== undefined ? { error: result.error } : {}) };
      }
      if (result.step === "code" && result.error === undefined) {
        countdown.markSent();
        track("auth.otp_requested", { surface: "register" });
      }
      setEditing(false);
      return result;
    },
    { step: "phone", phone: "", next },
  );
  const atCode = state.step === "code" && !editing;
  const locked = atCode && state.locked === true;

  useEffect(() => {
    onStep(atCode);
  }, [atCode, onStep]);
  useEffect(() => {
    if (state.error !== undefined && document.activeElement === document.body) {
      inputRef.current?.focus();
    }
  }, [state]);

  return (
    <form
      action={formAction}
      className="register-form reg-verify-form"
      data-testid="register-verify-form"
      data-method="phone"
      data-step={atCode ? "code" : "start"}
    >
      {atCode ? (
        <>
          <input type="hidden" name="phone" value={state.phone} />
          <p className="reg-verify-sent" id="reg-verify-sent">
            We sent it to <strong>{formatPhone(state.phone)}</strong>. It can take up to 30 seconds.
          </p>
          <Field
            key="code"
            ref={inputRef}
            label="6-digit code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="••••••"
            maxLength={6}
            autoFocus
            className="reg-code-input"
            onPaste={pasteDigits}
            onChange={submitWholeCode}
            disabled={locked}
            {...(state.error !== undefined ? { error: state.error } : {})}
          />
        </>
      ) : (
        <Field
          key="phone"
          ref={inputRef}
          label="Mobile number"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="98765 43210"
          autoFocus
          defaultValue={state.phone}
          help="India (+91). Organizers use it to reach you — it is never published."
          {...(state.error !== undefined ? { error: state.error } : {})}
        />
      )}
      {state.supportLink === true ? (
        <p className="register-hint">
          <Link href="/support">Contact support</Link>
        </p>
      ) : null}
      <Button
        type="submit"
        name="intent"
        value={atCode ? "verify" : "request"}
        size="touch"
        loading={pending}
        disabled={locked}
        className="reg-verify-submit"
        {...(atCode ? {} : { "data-testid": "register-verify-cta" })}
      >
        {atCode ? "Verify and continue" : "Send code"}
      </Button>
      {atCode ? (
        <ResendRow
          pending={pending}
          secondsLeft={countdown.secondsLeft}
          changeLabel="Use a different number"
          emphasise={locked}
          onChange={() => {
            setEditing(true);
          }}
        />
      ) : null}
    </form>
  );
}

function EmailVerify({ next, onStep }: { next: string; onStep: (atCode: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const countdown = useResendCountdown(true, RESEND_COOLDOWN_S);
  const [state, formAction, pending] = useActionState(
    async (previous: EmailAuthFormState, formData: FormData): Promise<EmailAuthFormState> => {
      const intent =
        (formData.get("intent") as Intent | null) ??
        (formData.get("code") === null ? "request" : "verify");
      if (intent === "verify") {
        const result = await verifyEmailLoginAction(previous, formData);
        if (result.error !== undefined) {
          track("auth.otp_failed", { surface: "register" });
        }
        return result;
      }
      const result = await requestEmailLoginAction({ ...previous, step: "email" }, formData);
      if (result.step === "code") {
        countdown.markSent();
        track("auth.otp_requested", { surface: "register" });
        setEditing(false);
        return result;
      }
      return intent === "resend"
        ? {
            ...previous,
            step: "code",
            ...(result.error !== undefined ? { error: result.error } : {}),
          }
        : result;
    },
    { step: "email", email: "", next },
  );
  const atCode = state.step === "code" && !editing;

  useEffect(() => {
    onStep(atCode);
  }, [atCode, onStep]);
  useEffect(() => {
    if (state.error !== undefined && document.activeElement === document.body) {
      inputRef.current?.focus();
    }
  }, [state]);

  return (
    <form
      action={formAction}
      className="register-form reg-verify-form"
      data-testid="register-verify-form"
      data-method="email"
      data-step={atCode ? "code" : "start"}
    >
      <input type="hidden" name="next" value={next} />
      {atCode ? (
        <>
          <input type="hidden" name="email" value={state.email} />
          <p className="reg-verify-sent" data-testid="email-login-sent">
            If we can reach <strong>{state.email}</strong>, a 6-digit code is on its way. It can
            take a minute — check spam or promotions too.
          </p>
          <Field
            key="code"
            ref={inputRef}
            label="6-digit code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="••••••"
            maxLength={6}
            autoFocus
            className="reg-code-input"
            onPaste={pasteDigits}
            onChange={submitWholeCode}
            {...(state.error !== undefined ? { error: state.error } : {})}
            data-testid="email-login-code"
          />
        </>
      ) : (
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
          defaultValue={state.email}
          help="Players also need a mobile number — we'll confirm it next, right here."
          {...(state.error !== undefined ? { error: state.error } : {})}
          data-testid="email-login-address"
        />
      )}
      <Button
        type="submit"
        name="intent"
        value={atCode ? "verify" : "request"}
        size="touch"
        loading={pending}
        className="reg-verify-submit"
        data-testid={atCode ? "email-login-verify" : "register-verify-cta"}
      >
        {atCode ? "Verify and continue" : "Send code"}
      </Button>
      {atCode ? (
        <ResendRow
          pending={pending}
          secondsLeft={countdown.secondsLeft}
          changeLabel="Use a different email"
          emphasise={false}
          onChange={() => {
            setEditing(true);
          }}
        />
      ) : null}
    </form>
  );
}
