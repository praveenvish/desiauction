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
      <summary>Sign in with your email instead</summary>
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
              // for anyone with a list of addresses — so the form has to.
              help="Works if this address is confirmed on your account."
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
            {/* Deliberately not "we sent a code to X" — the step advances the
                same way whether or not that address is on an account, and a
                confident "sent" for an address we mailed nothing to would be a
                lie. This says what was attempted. */}
            <p className="login-hint" data-testid="email-login-sent">
              If {state.email} is confirmed on an account, a code is on its way.
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
