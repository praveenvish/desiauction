"use client";

import { Button, Field } from "@desiauction/ui";
import { useActionState } from "react";

import {
  unsubscribeByLinkAction,
  unsubscribeNewsletterAction,
} from "../../../server/marketing/actions";

/**
 * The answer is identical whether or not the address was on the list, so this
 * form cannot be used to find out who subscribed.
 */
export function UnsubscribeForm() {
  const [state, formAction, pending] = useActionState(unsubscribeNewsletterAction, {});
  if (state.done === true) {
    return (
      <p role="status" data-testid="unsubscribed">
        Done. If that address was on our list, it isn&apos;t any more.
      </p>
    );
  }
  return (
    <form action={formAction} className="unsubscribe-form">
      {/* Not just "Email address": the site footer on this same page carries
          the SUBSCRIBE box under that label, and two identical labels leave a
          screen-reader user guessing which form they are in. */}
      <Field
        label="Email address to remove"
        name="email"
        type="email"
        required
        autoComplete="email"
        {...(state.error !== undefined ? { error: state.error } : {})}
      />
      <Button type="submit" loading={pending}>
        Unsubscribe
      </Button>
    </form>
  );
}

/** From a newsletter link: the address is already proven by the token, so one button. */
export function UnsubscribeLinkForm({ address, token }: { address: string; token: string }) {
  const [state, formAction, pending] = useActionState(unsubscribeByLinkAction, {});
  if (state.done === true) {
    return (
      <p role="status" data-testid="unsubscribed">
        Done. {address} is off the product-news list.
      </p>
    );
  }
  return (
    <form action={formAction} className="unsubscribe-form">
      <p className="content-lead">Remove {address} from the product-news list?</p>
      <input type="hidden" name="address" value={address} />
      <input type="hidden" name="token" value={token} />
      {state.error !== undefined ? <p role="alert">{state.error}</p> : null}
      <Button type="submit" loading={pending}>
        Unsubscribe
      </Button>
    </form>
  );
}
