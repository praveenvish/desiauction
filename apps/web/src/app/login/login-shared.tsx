"use client";

import Link from "next/link";
import { useEffect, useState, type ClipboardEvent, type ReactNode } from "react";

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
}

/**
 * The two doors, as links rather than buttons.
 *
 * A link works before hydration and on a device that never runs the bundle,
 * keeps `next` across the switch, and makes each door addressable — support can
 * send "/login?method=email" to somebody whose SMS is not arriving.
 */
function MethodTabs({ method, next }: { method: LoginMethod; next?: string }) {
  const href = (target: LoginMethod) => {
    const params = new URLSearchParams({ method: target });
    if (next !== undefined) {
      params.set("next", next);
    }
    return `/login?${params.toString()}`;
  };
  return (
    <nav className="login-methods" aria-label="How to sign in" data-testid="login-methods">
      {(["email", "phone"] as const).map((target) => (
        <Link
          key={target}
          href={href(target)}
          replace
          scroll={false}
          className="login-method"
          aria-current={method === target ? "page" : undefined}
          data-testid={`login-method-${target}`}
        >
          {target === "email" ? "Email" : "Mobile"}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Everything around a sign-in form: heading, one sentence, the door switch and
 * the passkey — placed by whether this device has signed in before.
 *
 * On the CODE step all of that steps aside. Somebody six digits from signed in
 * does not need a second door, and a passkey button above the code field reads
 * as the thing to press.
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
  return (
    <>
      <h1>{title}</h1>
      <p className="login-sub" {...(subTestId !== undefined ? { "data-testid": subTestId } : {})}>
        {sub}
      </p>
      {atStart && returning ? (
        <div className="login-fast">
          <PasskeyLogin {...(next !== undefined ? { next } : {})} />
          <div className="login-divider" aria-hidden="true">
            <span>or</span>
          </div>
        </div>
      ) : null}
      {atStart ? <MethodTabs method={method} {...(next !== undefined ? { next } : {})} /> : null}
      {children}
      {atStart && !returning ? (
        <>
          <div className="login-divider" aria-hidden="true">
            <span>or</span>
          </div>
          <PasskeyLogin {...(next !== undefined ? { next } : {})} />
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
