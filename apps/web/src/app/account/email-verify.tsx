"use client";

import { Badge, Button, Field, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import {
  confirmEmailVerificationAction,
  requestEmailVerificationAction,
  type EmailChangeState,
} from "../../server/auth/actions";

/**
 * An address the platform may actually send to.
 *
 * The product has never asked for one, so the email delivery adapter has
 * refused every document with `no_email_on_file` — which is why a team owner
 * who paid could not be emailed their own receipt.
 *
 * The copy says what an address is FOR before asking for it. This is not a
 * contact detail on a profile: it is where money documents go, and the reason
 * it needs confirming is that a mistyped domain sends somebody's receipt to a
 * stranger.
 */
export function EmailVerify({ current, verified }: { current: string | null; verified: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [requested, request, requesting] = useActionState<EmailChangeState, FormData>(
    requestEmailVerificationAction,
    { step: "idle" },
  );
  const [confirmed, confirm, confirming] = useActionState<EmailChangeState, FormData>(
    confirmEmailVerificationAction,
    { step: "idle" },
  );
  const announced = useRef(false);

  useEffect(() => {
    if (confirmed.done === true && !announced.current) {
      announced.current = true;
      toast({ tone: "success", title: "Email confirmed" });
      setOpen(false);
      router.refresh();
    }
  }, [confirmed.done, router, toast]);

  const onCodeStep = requested.step === "code" && confirmed.done !== true;

  return (
    <div className="phone-change" data-testid="email-verify">
      <h3 className="account-subhead">Email address</h3>
      {current !== null && verified ? (
        <p className="notify-switch-detail">
          <span data-testid="account-email">{current}</span> <Badge tone="success">Confirmed</Badge>
        </p>
      ) : (
        <p className="notify-switch-detail">
          {/* Says what it unlocks, not "add an email". A person deciding whether
              to hand over an address deserves to know what arrives on it. */}
          No email on file. Add one and receipts, invoices and corrections from clubs can reach your
          inbox as well as this account — without one, they only exist inside DesiAuction.
        </p>
      )}
      {!open ? (
        <Button
          type="button"
          variant="secondary"
          size="touch"
          data-testid="open-email-verify"
          onClick={() => {
            setOpen(true);
          }}
        >
          {current !== null && verified ? "Change email" : "Add an email"}
        </Button>
      ) : onCodeStep ? (
        <form action={confirm} className="profile-form">
          <p className="notify-switch-detail">
            We sent a six-digit code to {requested.email ?? ""}. It expires in 15 minutes.
          </p>
          <Field
            label="Six-digit code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            data-testid="email-verify-code"
            {...(confirmed.error !== undefined ? { error: confirmed.error } : {})}
          />
          <Button
            type="submit"
            size="touch"
            disabled={confirming}
            data-testid="email-verify-confirm"
          >
            {confirming ? "Checking…" : "Confirm address"}
          </Button>
        </form>
      ) : (
        <form action={request} className="profile-form">
          <Field
            label="Email address"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            help="We send a code to confirm it. Nothing is stored until you do."
            required
            data-testid="email-verify-input"
            {...(requested.error !== undefined ? { error: requested.error } : {})}
          />
          <Button type="submit" size="touch" disabled={requesting} data-testid="email-verify-send">
            {requesting ? "Sending…" : "Send confirmation code"}
          </Button>
        </form>
      )}
      {open ? (
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
      ) : null}
    </div>
  );
}
