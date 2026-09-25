"use client";

import { buttonClassName, IconMail, IconPhone } from "@desiauction/ui";
import Link from "next/link";
import { useEffect, useState, type ChangeEvent, type ClipboardEvent, type ReactNode } from "react";

import { PasskeyLogin } from "./passkey-login";

export type LoginMethod = "email" | "phone";

/**
 * The step lives in the URL, for both doors.
 *
 * `/login?method=email&step=code&to=…` — because reading the code means leaving
 * the browser (for the SMS app, or the mail app), and a backgrounded tab is
 * evicted routinely on a phone. With the step only in React state the person
 * came back to an empty first step, holding a valid code with nowhere to type
 * it. `pushState` going forward gives the code step a real Back button;
 * `replace` for corrections keeps history from stacking.
 */
export function writeLoginUrl(
  mode: "push" | "replace",
  method: LoginMethod,
  step: "start" | "code",
  to: string,
  next?: string,
): void {
  const params = new URLSearchParams();
  params.set("method", method);
  if (step === "code") {
    params.set("step", "code");
    params.set("to", to);
  }
  if (next !== undefined) {
    params.set("next", next);
  }
  const url = `${window.location.pathname}?${params.toString()}`;
  if (mode === "push") {
    window.history.pushState(null, "", url);
  } else {
    window.history.replaceState(null, "", url);
  }
}

/** Seconds until a code may be resent. Display only — the server holds the real limit. */
export function useResendCountdown(active: boolean, cooldownS: number) {
  const [sentAt, setSentAt] = useState<number | null>(null);
  // Time is sampled in the interval and in `markSent`, never during render, so
  // the server's pass and the client's first pass agree.
  const [now, setNow] = useState<number | null>(null);
  const secondsLeft =
    sentAt === null || now === null
      ? 0
      : Math.max(0, cooldownS - Math.floor((now - sentAt) / 1000));

  useEffect(() => {
    if (!active || secondsLeft <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [active, secondsLeft]);

  return {
    secondsLeft,
    markSent: () => {
      const sent = Date.now();
      setSentAt(sent);
      setNow(sent);
    },
  };
}

/**
 * "Your DesiAuction code is 744588" pasted whole is the fastest thing a phone
 * can do. The digits are extracted rather than the paste refused.
 */
export function pasteDigits(event: ClipboardEvent<HTMLInputElement>): void {
  const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
  if (digits === "") {
    return;
  }
  event.preventDefault();
  event.currentTarget.value = digits;
  submitWhenComplete(event.currentTarget);
}

/**
 * A WHOLE CODE SUBMITS ITSELF; A TYPED ONE WAITS FOR THE BUTTON.
 *
 * On a phone the code rarely gets typed: it is pasted, or tapped in from the
 * keyboard's "From Messages" suggestion, and then the person had to find
 * "Verify and continue" as well. Those arrive as one input event carrying all
 * six digits, so they go straight through — pressing the SAME submit button,
 * so the form's intent and pending state are exactly what a click produces.
 * Digits typed one at a time do not auto-submit: the sixth keystroke of a
 * mistyped code would otherwise be sent before the person saw it.
 */
export function submitWhenComplete(input: HTMLInputElement): void {
  if (!/^\d{6}$/.test(input.value)) {
    return;
  }
  const verify = input.form?.querySelector<HTMLButtonElement>('button[value="verify"]');
  if (verify !== null && verify !== undefined && !verify.disabled) {
    input.form?.requestSubmit(verify);
  }
}

/** onChange for the code field: submit only when the code arrived whole. */
export function submitWholeCode(event: ChangeEvent<HTMLInputElement>): void {
  // A plain Event (not an InputEvent) carries no inputType; treat it as whole.
  const kind = (event.nativeEvent as Partial<InputEvent>).inputType ?? "";
  if (kind === "insertText" || kind.startsWith("delete")) {
    return;
  }
  submitWhenComplete(event.currentTarget);
}

/**
 * The other door, offered once and quietly — below the form, not above it.
 *
 * It used to be an Email | Mobile segmented control above the field, weighted
 * like the form itself, for a choice most people never make. Now the page leads
 * with one field and one button, and the alternative waits under "or" beside
 * the passkey. Still a link: it works before hydration, keeps `next`, and makes
 * each door addressable (support can send "/login?method=email").
 */
function OtherDoor({ method, next }: { method: LoginMethod; next?: string }) {
  const other: LoginMethod = method === "email" ? "phone" : "email";
  const params = new URLSearchParams({ method: other });
  if (next !== undefined) {
    params.set("next", next);
  }
  return (
    <Link
      href={`/login?${params.toString()}`}
      replace
      scroll={false}
      className={buttonClassName({ variant: "secondary", size: "touch" })}
      data-testid={`login-method-${other}`}
    >
      {other === "phone" ? (
        <IconPhone size={18} className="icon-lead" />
      ) : (
        <IconMail size={18} className="icon-lead" />
      )}
      {other === "phone" ? "Use mobile number" : "Use email instead"}
    </Link>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="login-divider" aria-hidden="true">
      <span>{label}</span>
    </div>
  );
}

/**
 * Everything around a sign-in form, in the order a person needs it.
 *
 * A RETURNING device leads with its passkey — one tap, no code — and the form
 * follows under "or continue with …". Everyone else leads with the form. The
 * alternatives (the other door, and the passkey for a first visit) sit below,
 * then the terms. On the CODE step all of that steps aside: somebody six
 * digits from signed in needs the field and nothing competing with it.
 */
export function LoginFrame({
  title,
  sub,
  subTestId,
  method,
  atStart,
  returning,
  next,
  children,
}: {
  title: string;
  sub: string;
  /** A stable hook on the one sentence a step turns on (the "code is on its way" line). */
  subTestId?: string | undefined;
  method: LoginMethod;
  atStart: boolean;
  returning: boolean;
  next?: string;
  children: ReactNode;
}) {
  const nextProp = next !== undefined ? { next } : {};
  return (
    <>
      <h1>{title}</h1>
      <p className="login-sub" {...(subTestId !== undefined ? { "data-testid": subTestId } : {})}>
        {sub}
      </p>
      {atStart && returning ? (
        <div className="login-fast">
          {/* Secondary even here: "returning" means this browser signed in
              before, not that it holds a passkey — gold stays with the one
              action that always works. */}
          <PasskeyLogin {...nextProp} />
          <Divider
            label={method === "email" ? "or continue with email" : "or continue with mobile"}
          />
        </div>
      ) : null}
      {children}
      {atStart ? (
        <>
          <Divider label="or" />
          <div className="login-alternatives">
            <OtherDoor method={method} {...nextProp} />
            {returning ? null : <PasskeyLogin {...nextProp} />}
          </div>
          <LoginConsent />
        </>
      ) : null}
    </>
  );
}

export function LoginConsent() {
  return (
    <p className="login-consent">
      By continuing you agree to our <Link href="/legal/terms">Terms</Link> and{" "}
      <Link href="/legal/privacy">Privacy Policy</Link>.
    </p>
  );
}
