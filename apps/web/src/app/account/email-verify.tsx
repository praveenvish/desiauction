"use client";

import { Button, Field, IconMail, IconTile, Pill, useToast } from "@desiauction/ui";
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

  const confirmedAddress = current !== null && verified;

  return (
    <div className="email-verify acct-contact" data-testid="email-verify" id="email">
      <div className="acct-contact-head">
        <IconTile icon={<IconMail />} tone="gold" size="sm" />
        <div className="acct-contact-text">
          <span className="acct-contact-label">Email</span>
          {confirmedAddress ? (
            <span className="acct-contact-value">
              <span data-testid="account-email" data-private>
                {current}
              </span>{" "}
              <Pill tone="green" dot>
                Confirmed
              </Pill>
            </span>
          ) : (
            <span className="acct-contact-value acct-contact-empty">
              {/* Says what it unlocks, not "add an email". A person deciding
                  whether to hand over an address deserves to know what arrives
                  on it. */}
              No email on file. Add one and receipts, invoices and corrections from clubs reach your
              inbox too — without one, they only exist inside DesiAuction.
            </span>
          )}
        </div>
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
            {confirmedAddress ? "Change email" : "Add an email"}
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="acct-contact-flow">
          {onCodeStep ? (
            <form action={confirm} className="acct-flow-form">
              <p className="acct-flow-note">
                We sent a six-digit code to <span data-private>{requested.email ?? ""}</span>. It
                expires in 15 minutes.
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
            <form action={request} className="acct-flow-form">
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
              <Button
                type="submit"
                size="touch"
                disabled={requesting}
                data-testid="email-verify-send"
              >
                {requesting ? "Sending…" : "Send confirmation code"}
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
      ) : null}
    </div>
  );
}
