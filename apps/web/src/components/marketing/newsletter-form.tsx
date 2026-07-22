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
      <p className={styles["hint"]}>Get the latest features and updates.</p>
      <form action={formAction} className={styles["form"]}>
        <label className={styles["label"]} htmlFor="newsletter-email">
          Email address
        </label>
        <input
          id="newsletter-email"
          name="email"
          type="email"
          required
          placeholder="Enter your email"
          className={styles["input"]}
        />
        <Button type="submit" size="sm" loading={pending} aria-label="Subscribe">
          <IconArrowRight width={16} height={16} />
        </Button>
        {state.error !== undefined ? <p className={styles["error"]}>{state.error}</p> : null}
      </form>
    </>
  );
}
