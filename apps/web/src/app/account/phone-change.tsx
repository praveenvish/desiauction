"use client";

import { Button, Field, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import {
  confirmPhoneChangeAction,
  requestPhoneChangeAction,
  type PhoneChangeState,
} from "../../server/auth/actions";
import { formatPhone } from "../../lib/format-phone";

/**
 * Moving the one credential this product has.
 *
 * Kept behind a disclosure rather than sitting open on the page: this is the
 * single change that can take an account away from somebody, and a form that
 * looks as routine as "display name" invites a mis-tap. Opening it is a
 * deliberate act, and the copy says what will happen before the field appears.
 */
export function PhoneChange({ current }: { current: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [requested, request, requesting] = useActionState<PhoneChangeState, FormData>(
    requestPhoneChangeAction,
    { step: "idle" },
  );
  const [confirmed, confirm, confirming] = useActionState<PhoneChangeState, FormData>(
    confirmPhoneChangeAction,
    { step: "idle" },
  );
  const announced = useRef(false);

  useEffect(() => {
    if (confirmed.done === true && !announced.current) {
      announced.current = true;
      toast({ tone: "success", title: "Mobile number changed" });
      setOpen(false);
      // The session's own copy of the phone is now stale, and it is printed at
      // the top of this very card.
      router.refresh();
    }
  }, [confirmed.done, router, toast]);

  if (!open) {
    return (
      <div className="phone-change">
        <Button
          type="button"
          variant="secondary"
          size="touch"
          data-testid="open-phone-change"
          onClick={() => {
            setOpen(true);
          }}
        >
          Change mobile number
        </Button>
      </div>
    );
  }

  const onCodeStep = requested.step === "code" && confirmed.done !== true;

  return (
    <div className="phone-change" data-testid="phone-change">
      <h3 className="account-subhead">Change mobile number</h3>
      <p className="notify-switch-detail">
        {/* Said before the field, not after the mistake. Sign-in is phone-first,
            so this is not a contact detail — it is the credential. */}
        You sign in with this number. After the change, {formatPhone(current)} will no longer sign
        in to this account, and we will text it to say so.
      </p>
      {onCodeStep ? (
        <form action={confirm} className="profile-form">
          <p className="notify-switch-detail">
            We sent a code to {formatPhone(requested.phone ?? "")}. Enter it to finish.
          </p>
          <Field
            label="Six-digit code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            data-testid="phone-change-code"
            {...(confirmed.error !== undefined ? { error: confirmed.error } : {})}
          />
          <Button
            type="submit"
            size="touch"
            disabled={confirming}
            data-testid="phone-change-confirm"
          >
            {confirming ? "Checking…" : "Confirm new number"}
          </Button>
        </form>
      ) : (
        <form action={request} className="profile-form">
          <Field
            label="New mobile number"
            name="phone"
            inputMode="tel"
            autoComplete="tel"
            required
            data-testid="phone-change-input"
            {...(requested.error !== undefined ? { error: requested.error } : {})}
          />
          <Button type="submit" size="touch" disabled={requesting} data-testid="phone-change-send">
            {requesting ? "Sending…" : "Send code to new number"}
          </Button>
        </form>
      )}
      <Button
        type="button"
        variant="ghost"
        size="touch"
        onClick={() => {
          setOpen(false);
        }}
      >
        Cancel
      </Button>
    </div>
  );
}
