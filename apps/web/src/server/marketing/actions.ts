"use server";

import { newId, newsletterSubscribers } from "@desiauction/db";

import { db } from "../db";

// Anonymous, unauthenticated capture — newsletter_subscribers carries no
// tenant data and no RLS (schema.ts), so a plain pool write is correct here,
// the same way auth/actions.ts writes pre-session rows directly through `db`.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function subscribeNewsletterAction(
  _previous: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const email = formData.get("email");
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) {
    return { error: "Enter a valid email address." };
  }
  try {
    await db
      .insert(newsletterSubscribers)
      .values({ id: newId(), email: email.trim().toLowerCase() });
  } catch {
    // Duplicate email (unique constraint) — treated as success, not an error;
    // the person is already subscribed.
    return { success: true };
  }
  return { success: true };
}
