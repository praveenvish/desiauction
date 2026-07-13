"use client";

import { Button, Field } from "@desiauction/ui";
import { useActionState } from "react";

import { requestOtpAction, verifyOtpAction, type AuthFormState } from "../../server/auth/actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(
    async (previous: AuthFormState, formData: FormData) =>
      previous.step === "phone"
        ? requestOtpAction(previous, formData)
        : verifyOtpAction(previous, formData),
    { step: "phone", phone: "", ...(next !== undefined ? { next } : {}) },
  );

  return (
    <form
      action={formAction}
      className="login-form"
      data-testid="login-form"
      data-step={state.step}
    >
      {state.step === "phone" ? (
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
          defaultValue={state.phone}
          {...(state.error !== undefined ? { error: state.error } : {})}
          help="We'll send a 6-digit code. India (+91) only for now."
        />
      ) : (
        <Field
          key="code"
          label={`Code sent to ${state.phone}`}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="6-digit code"
          required
          autoFocus
          {...(state.error !== undefined ? { error: state.error } : {})}
          help="Valid for 5 minutes."
        />
      )}
      <Button type="submit" loading={pending}>
        {state.step === "phone" ? "Send code" : "Sign in"}
      </Button>
    </form>
  );
}
