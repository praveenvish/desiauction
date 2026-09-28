"use client";

import { Button } from "@desiauction/ui";
import Link from "next/link";
import { useActionState } from "react";

import {
  unsubscribeFromEmailAction,
  type EmailUnsubscribeState,
} from "../../../server/messaging/unsubscribe-actions";

/**
 * One button, then its undo. The same form posts both: `intent` says which,
 * so a person who pressed Unsubscribe by mistake is one press from where they
 * were — without signing in.
 */
export function EmailUnsubscribeForm({
  personId,
  topic,
  token,
  label,
  detail,
}: {
  personId: string;
  topic: string;
  token: string;
  label: string;
  detail: string;
}) {
  const [state, formAction, pending] = useActionState<EmailUnsubscribeState, FormData>(
    unsubscribeFromEmailAction,
    {},
  );
  const hidden = (
    <>
      <input type="hidden" name="p" value={personId} />
      <input type="hidden" name="topic" value={topic} />
      <input type="hidden" name="t" value={token} />
    </>
  );

  if (state.status === "off") {
    return (
      <>
        <h1>You&apos;re unsubscribed</h1>
        <form action={formAction} className="unsubscribe-form">
          <p role="status" className="content-lead" data-testid="email-unsubscribed">
            You won&apos;t get &ldquo;{label}&rdquo; from DesiAuction by email or WhatsApp any more.
          </p>
          {hidden}
          <input type="hidden" name="intent" value="undo" />
          <Button type="submit" variant="secondary" loading={pending}>
            Undo
          </Button>
          <p>
            <Link href="/account?section=notifications">See all your email settings</Link>
          </p>
        </form>
      </>
    );
  }

  return (
    <>
      <h1>Stop &ldquo;{label}&rdquo;?</h1>
      <form action={formAction} className="unsubscribe-form">
        {state.status === "on" ? (
          <p role="status" data-testid="email-resubscribed">
            Undone. You&apos;ll keep getting &ldquo;{label}&rdquo;.
          </p>
        ) : null}
        <p className="content-lead">{detail}</p>
        <p>
          This one switch covers email and WhatsApp. Sign-in codes and security alerts always reach
          you.
        </p>
        {hidden}
        <input type="hidden" name="intent" value="unsubscribe" />
        {state.error !== undefined ? <p role="alert">{state.error}</p> : null}
        <Button type="submit" loading={pending}>
          Unsubscribe
        </Button>
      </form>
    </>
  );
}
