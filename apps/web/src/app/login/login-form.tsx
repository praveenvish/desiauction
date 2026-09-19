"use client";

import { EmailSignIn } from "./email-login";
import type { LoginMethod } from "./login-shared";
import { PhoneSignIn } from "./phone-login";

export interface LoginPanelProps {
  next?: string;
  /** Which door is open — `?method=`, else LOGIN_DEFAULT_METHOD (env). */
  method: LoginMethod;
  /**
   * The step and the address the URL arrived with (`?step=code&to=…`). The step
   * lives in the URL so leaving the browser to read the code — the mandatory
   * middle step on a phone — does not cost the person the flow.
   */
  initialStep: "start" | "code";
  initialTo: string;
  /** `next` points somewhere real, so "continue where you were headed" is true. */
  honoredNext: boolean;
  /** This device has signed in before — lead with the passkey. */
  returning: boolean;
}

/**
 * Both doors send a one-time code; neither asks for a password (C-24). Only one
 * is open at a time, so the page is one field and one button rather than two
 * forms stacked on top of each other.
 */
export function LoginPanel({
  next,
  method,
  initialStep,
  initialTo,
  honoredNext,
  returning,
}: LoginPanelProps) {
  const shared = { honoredNext, returning, ...(next !== undefined ? { next } : {}) };
  return method === "email" ? (
    <EmailSignIn
      {...shared}
      initialStep={initialStep === "code" ? "code" : "email"}
      initialEmail={initialTo}
    />
  ) : (
    <PhoneSignIn
      {...shared}
      initialStep={initialStep === "code" ? "code" : "phone"}
      initialPhone={initialTo}
    />
  );
}
