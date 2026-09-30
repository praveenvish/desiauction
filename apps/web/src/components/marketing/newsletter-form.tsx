"use client";

import { Button } from "@desiauction/ui";
import Link from "next/link";
import { useActionState } from "react";

import { subscribeNewsletterAction } from "../../server/marketing/actions";
import { IconCheck } from "./icons";
import styles from "./newsletter-form.module.css";

/**
 * THE FOOTER'S SUBSCRIBE BAND (site footer 9.5, 2026-09-30). "Stay in the game"
 * is the field's own label, so label and field read as one form; on a laptop
 * the footer lays it out as a band (label and note under the brand column, the
 * field from the first link column to the edge), stacked everywhere else.
 */
export function NewsletterForm() {
  const [state, formAction, pending] = useActionState(subscribeNewsletterAction, {});
  const describedBy =
    state.error !== undefined ? "newsletter-note newsletter-error" : "newsletter-note";
  return (
    <>
      {state.success === true ? null : (
        <form action={formAction} className={styles["form"]}>
          <label className={styles["label"]} htmlFor="newsletter-email">
            Stay in the game
            {/* The field's name says what goes in it; the heading-like words
                above alone would be a name with no instruction in it. */}
            <span className={styles["vh"]}>: your email address</span>
          </label>
          {/* The control row is its own element so the error can sit BELOW it.
              While the two were siblings in one flex row, a rejected address
              pushed its message in beside the input and squeezed the field. */}
          <div className={styles["row"]}>
            <input
              id="newsletter-email"
              name="email"
              type="email"
              inputMode="email"
              required
              placeholder="you@example.com"
              autoComplete="email"
              className={styles["input"]}
              // Named, not merely printed: without the description the error is
              // rendered text a screen-reader user never hears, and
              // `aria-invalid` is how the field itself says it was rejected.
              aria-invalid={state.error !== undefined ? true : undefined}
              aria-describedby={describedBy}
            />
            <Button type="submit" size="touch" loading={pending}>
              Subscribe
            </Button>
          </div>
          {state.error !== undefined ? (
            <p id="newsletter-error" className={styles["error"]} role="alert">
              {state.error}
            </p>
          ) : null}
          {/* Every clause is true of what the product does: one row in
              `newsletter_subscribers`, deleted after twenty-four months by the
              retention sweep, an unsubscribe link in every send, and
              /newsletter/unsubscribe for anyone who kept none of them. */}
          <p id="newsletter-note" className={styles["fine"]}>
            Product news only, never shared. One-click{" "}
            <Link href="/newsletter/unsubscribe" className={styles["fineLink"]}>
              unsubscribe
            </Link>{" "}
            in every email.
          </p>
        </form>
      )}
      {/* Always mounted, so the thanks is announced when it replaces the form. */}
      <div role="status" className={styles["status"]}>
        {state.success === true ? (
          <p className={styles["done"]}>
            <IconCheck width={16} height={16} />
            Subscribed — thanks!
          </p>
        ) : null}
      </div>
    </>
  );
}
