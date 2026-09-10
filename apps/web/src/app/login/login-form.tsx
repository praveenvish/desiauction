"use client";

import { Button, Field } from "@desiauction/ui";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { requestOtpAction, verifyOtpAction, type AuthFormState } from "../../server/auth/actions";
import { formatPhone } from "../../lib/format-phone";
import { track } from "../../lib/telemetry";
import { EmailLogin } from "./email-login";
import { PasskeyLogin } from "./passkey-login";

/** Matches the server's RESEND_COOLDOWN_MS (otp.ts) — display only; the
 * server enforces the real limit. */
const RESEND_COOLDOWN_S = 30;

type Intent = "request" | "resend" | "verify";
type Step = "phone" | "code";

export interface LoginPanelProps {
  next?: string;
  /**
   * The step and number the URL arrived with. THE STEP LIVES IN THE URL
   * (`/login?step=code&to=%2B919876543210`) because the alternative — the only
   * copy of it being React state — meant that reading the SMS cost you the
   * flow. On a phone, leaving the browser to read the message is not an edge
   * case, it is the mandatory middle step, and a backgrounded tab is evicted
   * routinely. The old form came back on the phone step with the number
   * forgotten, and re-typing it inside 30 seconds hit the resend cooldown: a
   * user holding a valid code, with no field to type it into.
   *
   * Three other defects fall out of the same change for free — Back on the code
   * step no longer exits the site, the code step is linkable, and a
   * server-rendered page can finally see which step it is drawing.
   */
  initialStep: Step;
  initialPhone: string;
  /** `next` points somewhere real, so the "continue where you were headed"
      promise is true. An unusable `next` (safeNext folds it to /home) must not
      produce a sentence the redirect then contradicts. */
  honoredNext: boolean;
  /** This device has signed in before — lead with the passkey, not the SMS. */
  returning: boolean;
}

/** The step + number, as the address bar states them. */
function readUrlStep(): { step: Step; phone: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    step: params.get("step") === "code" ? "code" : "phone",
    phone: params.get("to") ?? "",
  };
}

/**
 * Rewrite the address bar WITHOUT a server navigation, so the countdown, the
 * pending action and the typed digits all survive the step change. `pushState`
 * (not replace) going forward is what gives the code step a real Back button.
 */
function writeUrl(mode: "push" | "replace", step: Step, phone: string, next?: string): void {
  const params = new URLSearchParams();
  if (step === "code") {
    params.set("step", "code");
    params.set("to", phone);
  }
  if (next !== undefined) {
    params.set("next", next);
  }
  const query = params.toString();
  const url = query === "" ? window.location.pathname : `${window.location.pathname}?${query}`;
  if (mode === "push") {
    window.history.pushState(null, "", url);
  } else {
    window.history.replaceState(null, "", url);
  }
}

export function LoginPanel({
  next,
  initialStep,
  initialPhone,
  honoredNext,
  returning,
}: LoginPanelProps) {
  const intentRef = useRef<Intent>("request");
  const [offline, setOffline] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  // Mirrors the URL. Seeded from the server's reading of it so the first client
  // render is byte-identical to the server's (no hydration mismatch).
  const [step, setStep] = useState<Step>(initialStep);
  const [phone, setPhone] = useState(initialPhone);
  const inputRef = useRef<HTMLInputElement>(null);

  const [state, formAction, pending] = useActionState(
    async (previous: AuthFormState, formData: FormData): Promise<AuthFormState> => {
      // The submit button carries the intent. The fallback reads the payload
      // itself rather than the previous state: only the code step posts a
      // `code` field, so a submit with no named submitter still routes right.
      const intent =
        (formData.get("intent") as Intent | null) ??
        (formData.get("code") === null ? "request" : "verify");
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
    },
    {
      step: initialStep,
      phone: initialPhone,
      ...(next !== undefined ? { next } : {}),
    },
  );

  // Back/Forward: the address bar is the authority, so a popstate simply
  // restores the step it names.
  useEffect(() => {
    const onPop = () => {
      const url = readUrlStep();
      setStep(url.step);
      if (url.phone !== "") {
        setPhone(url.phone);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  const prevStepRef = useRef<AuthFormState["step"]>(initialStep);
  useEffect(() => {
    const arrivedAtCode =
      state.step === "code" &&
      state.error === undefined &&
      (prevStepRef.current === "phone" || intentRef.current === "resend");
    if (arrivedAtCode) {
      setSentAt(Date.now());
    }
    if (state.step === "code") {
      setPhone(state.phone);
      if (step !== "code") {
        setStep("code");
        writeUrl("push", "code", state.phone, next);
      }
    }
    if (state.step === "code" && state.error !== undefined) {
      track("auth.otp_failed");
    }
    prevStepRef.current = state.step;
    intentRef.current = "request";
    // Keyed on `state` ALONE on purpose: `step` and `next` are read here but
    // must not retrigger it — re-running on a step change would re-push the URL
    // that the step change had just written.
  }, [state]);

  // A rejected submit used to leave `document.activeElement` on <body>: the
  // caret gone, the keyboard dismissed on mobile, and nothing to correct
  // without hunting for the field again. Focus goes back to the input that was
  // refused, which is also what carries `aria-describedby` to the message.
  //
  // Guarded on <body> exactly as the Field primitive's own restore is: a caret
  // the user deliberately placed elsewhere is never stolen, and the two fixes
  // agree on the target rather than fighting over it.
  useEffect(() => {
    if (state.error !== undefined && document.activeElement === document.body) {
      inputRef.current?.focus();
    }
  }, [state]);

  useEffect(() => {
    track("auth.login_started");
  }, []);

  const secondsLeft =
    sentAt === null ? 0 : Math.max(0, RESEND_COOLDOWN_S - Math.floor((Date.now() - sentAt) / 1000));

  // Tick the countdown once a second while it's running.
  useEffect(() => {
    if (step !== "code" || secondsLeft <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [step, secondsLeft]);

  const locked = step === "code" && state.locked === true;
  const grouped = formatPhone(phone);

  const passkeyBlock = (
    <>
      <div className="login-divider" aria-hidden="true">
        <span>or</span>
      </div>
      <PasskeyLogin />
    </>
  );

  return (
    <>
      <h1>{step === "code" ? "Enter your code" : returning ? "Welcome back" : "Sign in"}</h1>
      {/* Server-rendered, this line could not see which step it was sitting
          above: it still read "One mobile number is all it takes" after the
          code had been sent. It moved into the client with the step. */}
      <p className="login-sub">
        {step === "code"
          ? `We sent a 6-digit code to ${grouped}. It can take up to 30 seconds.`
          : honoredNext
            ? "Sign in to continue where you were headed."
            : returning
              ? "Use your passkey, or we'll text a fresh code to your mobile."
              : "One mobile number is all it takes — we'll text you a code."}
      </p>
      {/* A returning visitor's fastest route was buried under an "OR" rule,
          below the form they did not need. On the code step it is noise —
          they are three digits from being signed in — so it is absent. */}
      {returning && step === "phone" ? (
        <div className="login-fast">
          <PasskeyLogin />
          <div className="login-divider" aria-hidden="true">
            <span>or</span>
          </div>
        </div>
      ) : null}
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
              : step === "phone"
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
        {step === "phone" ? (
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
            help="We'll send a 6-digit code. India (+91) only for now."
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
              // The SMS is "Your DesiAuction code is 744588", and pasting it
              // whole is the fastest thing a phone can do. It used to be
              // rejected outright; the digits are extracted instead.
              onPaste={(event) => {
                const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
                if (digits === "") {
                  return;
                }
                event.preventDefault();
                event.currentTarget.value = digits;
              }}
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
          value={step === "phone" ? "request" : "verify"}
          size="touch"
          loading={pending}
          // Another guess against a burned code cannot succeed. The button that
          // can is directly below.
          disabled={locked}
        >
          {step === "phone" ? "Send code" : "Verify and continue"}
        </Button>
        <p className="login-consent">
          By continuing you agree to our <Link href="/legal/terms">Terms</Link> and{" "}
          <Link href="/legal/privacy">Privacy Policy</Link>.
        </p>
        {step === "code" ? (
          <div className="login-resend-row">
            <Button
              type="submit"
              name="intent"
              value="resend"
              size="touch"
              variant={locked ? "secondary" : "ghost"}
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
                setStep("phone");
                // The next code request is a fresh arrival at the code step, so
                // its countdown starts again — without this the server state
                // still said "code" and the resend button unlocked instantly.
                prevStepRef.current = "phone";
                // A correction, not a step forward: it replaces the code step
                // in history rather than stacking a third entry on it.
                writeUrl("replace", "phone", phone, next);
              }}
            >
              Use a different number
            </button>
          </div>
        ) : null}
      </form>
      {!returning && step === "phone" ? passkeyBlock : null}
      {/* Only on the phone step: mid-code is not the moment to offer a second
          door, and someone already holding an SMS code does not need one. */}
      {step === "phone" ? <EmailLogin {...(next !== undefined ? { next } : {})} /> : null}
    </>
  );
}
