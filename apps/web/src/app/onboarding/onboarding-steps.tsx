"use client";

import { Button, Field } from "@desiauction/ui";
import { useActionState, useEffect, useRef } from "react";

import { formatPhone } from "../../lib/format-phone";
import { track } from "../../lib/telemetry";
import { logoutAction, updateProfileAction } from "../../server/auth/actions";

/**
 * The collapsed onboarding panel (2026-07-24 council): one question, no
 * progress bar, no org wizard, no skip link — there is nothing left to skip.
 *
 * The exit is now the server's: `updateProfileAction` redirects to /home when
 * the hidden `onboarding` marker is present. It used to be a client effect that
 * waited for `saved`, then pushed the route — ~1.9s of a finished form doing
 * nothing, at the end of the funnel. Telemetry fires at submit for the same
 * reason: there is no render after the save to fire it in.
 */
export function OnboardingPanel({ phone }: { phone: string }) {
  const [state, formAction, pending] = useActionState(updateProfileAction, {});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    track("onboarding.step_viewed", { step: "name" });
  }, []);

  // A rejected submit left focus on <body> and the caret nowhere. Login had the
  // same defect; both screens now hand the field back. Guarded on <body> like
  // the Field primitive's own restore, so a caret placed elsewhere is safe.
  useEffect(() => {
    if (state.error !== undefined && document.activeElement === document.body) {
      inputRef.current?.focus();
    }
  }, [state]);

  return (
    <>
      <h1>Welcome to DesiAuction</h1>
      <p className="onboarding-sub">One question and you&rsquo;re in.</p>
      <form
        action={formAction}
        className="onboarding-form"
        data-testid="onboarding-name"
        onSubmit={() => {
          track("profile.completed");
          track("onboarding.completed", { via: "name" });
        }}
      >
        {/* Tells the shared action which of its two forms this is: the one with
            somewhere to go afterwards. */}
        <input type="hidden" name="onboarding" value="1" />
        <p className="onboarding-hint">
          Signed in as <strong>{formatPhone(phone)}</strong> — verified. ·{" "}
          <button
            type="button"
            className="onboarding-signout"
            data-testid="onboarding-signout"
            onClick={() => void logoutAction()}
          >
            Not you? Sign out
          </button>
        </p>
        <Field
          ref={inputRef}
          label="What should we call you?"
          name="name"
          required
          autoFocus
          autoComplete="name"
          placeholder="Rohan Kulkarni"
          // Login has always preserved the phone across a rejected submit; this
          // field threw the typed name away and made the person start again.
          defaultValue={state.name ?? ""}
          help="Appears publicly on team sheets, receipts and the auction stage. You can change it later in Account."
          {...(state.error !== undefined ? { error: state.error } : {})}
        />
        <Button type="submit" size="touch" loading={pending}>
          Continue
        </Button>
      </form>
    </>
  );
}
