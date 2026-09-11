"use client";

import { Button, Field } from "@desiauction/ui";
import { useActionState, useState } from "react";

import {
  requestEmailLoginAction,
  verifyEmailLoginAction,
  type EmailAuthFormState,
} from "../../server/auth/actions";

/**
 * THE SECONDARY DOOR, and secondary on purpose.
 *
 * Phone stays the primary path: a player's registration and their place on a
 * roster key on a phone number, so most people who sign in here have one and
 * should use it. Email exists because Indian SMS needs DLT registration with
 * TRAI before a single transactional message can be sent — a queue measured in
 * days — and because a handset can be out of coverage on the night it matters.
 *
 * Collapsed until asked for, so the ordinary path stays one field and one
 * button. It is a `<details>` rather than a toggle-and-state because it must
 * work before hydration: a person who cannot receive SMS is exactly the person
 * least able to wait for JavaScript.
 */
export function EmailLogin({ next }: { next?: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (previous: EmailAuthFormState, formData: FormData): Promise<EmailAuthFormState> =>
      formData.get("code") === null
        ? requestEmailLoginAction(previous, formData)
        : verifyEmailLoginAction(previous, formData),
    { step: "email", email: "", ...(next !== undefined ? { next } : {}) },
  );

  return (
    <details
      className="login-email"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>Use your email instead</summary>
      <form action={formAction} className="login-email-form">
        {next !== undefined ? <input type="hidden" name="next" value={next} /> : null}
        {state.step === "email" ? (
          <>
            <Field
              label="Email address"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              defaultValue={state.email}
              // Says the condition out loud. The server cannot tell you whether
              // an address is on an account — that would be a membership oracle
              // for anyone with a list of addresses — so the form has to. Since
              // Phase 2 it also has to say that a NEW address is welcome here,
              // or somebody without an account has no reason to try this door.
              help="Sign in, or start a new account, with an address you can read."
              {...(state.error !== undefined ? { error: state.error } : {})}
              data-testid="email-login-address"
            />
            <Button type="submit" loading={pending} size="touch" data-testid="email-login-send">
              Email me a code
            </Button>
          </>
        ) : (
          <>
            <input type="hidden" name="email" value={state.email} />
            <Field
              label="6-digit code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              {...(state.error !== undefined ? { error: state.error } : {})}
              data-testid="email-login-code"
            />
            {/*
              STILL CONDITIONAL, AND STILL FOR THE SAME REASON — but the
              condition changed with Phase 2 and the sentence had to follow.

              It used to read "if this is confirmed on an account", which was
              true when an unknown address was mailed nothing. It is not true
              any more: an unknown address now gets a SIGN-UP code, and telling
              somebody creating an account that nothing may have been sent
              reads as a failure of the thing they just did.

              What is still conditional is the one case that gets no mail — an
              address claimed on an account that never confirmed it. So the
              hedge stays, worded around reaching the mailbox rather than
              around finding an account, which is the fact this form must not
              disclose either way.
            */}
            <p className="login-hint" data-testid="email-login-sent">
              If we can reach {state.email}, a code is on its way. New here? Entering it creates
              your account.
            </p>
            <Button type="submit" loading={pending} size="touch" data-testid="email-login-verify">
              Verify and continue
            </Button>
          </>
        )}
      </form>
    </details>
  );
}
