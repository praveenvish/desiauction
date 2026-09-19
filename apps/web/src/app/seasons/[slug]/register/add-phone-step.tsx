"use client";

import { Button, Field } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { formatPhone } from "../../../../lib/format-phone";
import {
  confirmPhoneChangeAction,
  logoutToAction,
  requestPhoneChangeAction,
  type PhoneChangeState,
} from "../../../../server/auth/actions";

/**
 * SIGNED IN BY EMAIL, WITH NO NUMBER (0062) — ADDED HERE, NOT ELSEWHERE.
 *
 * A player is reached by text and by nothing else — the approval, the
 * auction-day summons, the sold message — so a season entry needs a number,
 * and `submitRegistration` refuses one without it. This page used to say so
 * and link to /account, which has no idea where the person came from: they
 * added the number and were left on a settings page, with the registration
 * they had set out to finish nowhere in sight. The login door is email until
 * SMS is live, so that was the path for EVERY new player.
 *
 * The number is now attached in place, through the same two server actions
 * /account's attach form uses (request a code → confirm it), and the page then
 * refreshes: the session re-reads `people.phone`, the wizard's own state (and
 * the share `?ref` in the URL) is untouched, and the next step is simply there.
 */
export function AddPhoneStep({
  returnTo,
  onVerified,
}: {
  returnTo: string;
  /** Told once the number is confirmed, before the page re-reads the session. */
  onVerified: () => void;
}) {
  const router = useRouter();
  const [requested, request, requesting] = useActionState<PhoneChangeState, FormData>(
    requestPhoneChangeAction,
    { step: "idle" },
  );
  const [confirmed, confirm, confirming] = useActionState<PhoneChangeState, FormData>(
    confirmPhoneChangeAction,
    { step: "idle" },
  );
  // "Use a different number" — back to the number field without losing the
  // action state that knows a code is already out.
  const [changing, setChanging] = useState(false);
  const refreshed = useRef(false);

  useEffect(() => {
    if (confirmed.done === true && !refreshed.current) {
      refreshed.current = true;
      onVerified();
      // The session's copy of the phone is stale until the page re-reads it.
      router.refresh();
    }
  }, [confirmed.done, onVerified, router]);

  const error = confirmed.error ?? requested.error;
  // The step-up window (a code sign-in within the last few minutes) guards a
  // credential change. Someone who signed in long ago is offered a fresh
  // sign-in that brings them straight back here.
  const needsFreshSignIn = error?.toLowerCase().includes("sign in again") === true;
  const onCodeStep = requested.step === "code" && !changing && confirmed.done !== true;

  if (confirmed.done === true) {
    return (
      <p className="register-hint" role="status">
        Number verified — one moment…
      </p>
    );
  }

  return (
    <div className="reg-phone">
      {onCodeStep ? (
        <form action={confirm} className="register-form" data-testid="register-phone-code">
          <input type="hidden" name="phone" value={requested.phone ?? ""} />
          <p className="register-hint">
            We sent a six-digit code to <strong>{formatPhone(requested.phone ?? "")}</strong>.
          </p>
          <Field
            label="Six-digit code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus
            data-testid="register-phone-code-input"
            {...(confirmed.error !== undefined && !needsFreshSignIn
              ? { error: confirmed.error }
              : {})}
          />
          <div className="reg-actions">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setChanging(true);
              }}
            >
              Use a different number
            </Button>
            <Button type="submit" loading={confirming} data-testid="register-phone-confirm">
              Verify number
            </Button>
          </div>
        </form>
      ) : (
        <form
          action={(formData) => {
            setChanging(false);
            request(formData);
          }}
          className="register-form"
          data-testid="register-phone-request"
        >
          <Field
            label="Mobile number"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98765 43210"
            required
            help="Indian mobile, 10 digits. We'll text a code to confirm it's yours."
            data-testid="register-phone-input"
            {...(requested.error !== undefined && !needsFreshSignIn
              ? { error: requested.error }
              : {})}
          />
          <div className="reg-actions">
            <Button type="submit" loading={requesting} data-testid="register-phone-send">
              Send code
            </Button>
          </div>
        </form>
      )}
      {needsFreshSignIn ? (
        <div className="reg-phone-stale" role="alert">
          <p className="register-hint">
            For your security, sign in again before adding a number — it has been a while since you
            last did. You&apos;ll come straight back here.
          </p>
          <Button
            variant="secondary"
            onClick={() => void logoutToAction(`/login?next=${encodeURIComponent(returnTo)}`)}
          >
            Sign in again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
