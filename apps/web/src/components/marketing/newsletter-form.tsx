"use client";

import { Button } from "@desiauction/ui";
import { useActionState } from "react";

import { subscribeNewsletterAction } from "../../server/marketing/actions";
import { IconArrowRight, IconCheck } from "./icons";
import styles from "./newsletter-form.module.css";

export function NewsletterForm() {
  const [state, formAction, pending] = useActionState(subscribeNewsletterAction, {});
  if (state.success === true) {
    return (
      <p className={styles["done"]}>
        <IconCheck width={16} height={16} />
        Subscribed — thanks!
      </p>
    );
  }
  return (
    <>
      <p className={styles["hint"]}>Release notes and what we ship next, a few times a season.</p>
      <form action={formAction} className={styles["form"]}>
        <label className={styles["label"]} htmlFor="newsletter-email">
          Email address
        </label>
        {/* The control row is its own element so the error can sit BELOW it.
            While the two were siblings in one flex row, a rejected address
            pushed its message in beside the input and squeezed the field. */}
        <div className={styles["row"]}>
          <input
            id="newsletter-email"
            name="email"
            type="email"
            required
            placeholder="Enter your email"
            className={styles["input"]}
            // Named, not merely printed: without the description the error is
            // rendered text a screen-reader user never hears, and `aria-invalid`
            // is how the field itself says it was rejected.
            aria-invalid={state.error !== undefined ? true : undefined}
            aria-describedby={state.error !== undefined ? "newsletter-error" : undefined}
          />
          {/* `touch`, not `sm`: this button's neighbour is a hand-set 44px
              input, and at sm it rendered 42×32 — the one control in the
              footer under the platform's 44px rung, and a visibly shorter box
              beside the field it submits. That is exactly the gap `touch`
              exists to close (see ButtonSize). */}
          <Button type="submit" size="touch" loading={pending} aria-label="Subscribe">
            <IconArrowRight width={16} height={16} />
          </Button>
        </div>
        {state.error !== undefined ? (
          <p id="newsletter-error" className={styles["error"]} role="alert">
            {state.error}
          </p>
        ) : null}
      </form>
      {/* Both halves are true of what the action actually does: it writes one
          row to `newsletter_subscribers` and nothing else. The usual
          "unsubscribe any time" is NOT here — there is no unsubscribe link and
          no sender yet, and a footer is a poor place to make a promise the
          product cannot keep. It goes in the day the mechanism does. */}
      <p className={styles["fine"]}>Product updates only. Your address goes nowhere else.</p>
    </>
  );
}
