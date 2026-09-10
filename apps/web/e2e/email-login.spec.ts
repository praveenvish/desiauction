import { createDb, otpInbox, people } from "@desiauction/db";
import { expect, test } from "@playwright/test";
import { desc, eq } from "drizzle-orm";

import { latestOtp } from "./otp";

/*
 * SIGNING IN WITH A MAILBOX.
 *
 * The second door, added because Indian SMS needs DLT registration with TRAI
 * before a single transactional message can be sent — a queue measured in days
 * — while email needs none. Phone stays primary: a player's registration and
 * their place on a roster key on a phone number.
 *
 * The dev mailer writes to the same `otp_inbox` the sign-in codes go to, so a
 * browser test can read what was actually mailed rather than trusting that
 * something was.
 */
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";

const STAMP = String(Date.now()).slice(-8);
const PHONE = `86${STAMP}`;
const EMAIL = `login${STAMP}@example.test`;

/** What the dev mailer put in the inbox for an address. */
async function mailedCode(address: string): Promise<string> {
  const handle = createDb(DATABASE_URL);
  try {
    for (let i = 0; i < 50; i++) {
      const [row] = await handle.db
        .select({ code: otpInbox.code })
        .from(otpInbox)
        .where(eq(otpInbox.phone, address))
        .orderBy(desc(otpInbox.createdAt))
        .limit(1);
      if (row !== undefined) return row.code;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`nothing was mailed to ${address}`);
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}

/** Confirm the address directly — the change flow has its own coverage. */
async function verifyAddress(phone: string, address: string): Promise<void> {
  const handle = createDb(DATABASE_URL);
  try {
    await handle.db
      .update(people)
      .set({ email: address, emailVerifiedAt: new Date() })
      .where(eq(people.phone, `+91${phone}`));
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}

test("a verified email is a second way into the same account", async ({ page }) => {
  test.setTimeout(120_000);

  // Establish the account through the PRIMARY path, which must keep working.
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(PHONE);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code");
  await page.getByLabel("6-digit code").fill(await latestOtp(PHONE));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill("Email Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
  await verifyAddress(PHONE, EMAIL);

  // Sign out, then come back through the OTHER door.
  await page.goto("/account");
  await page
    .getByRole("button", { name: /Sign out/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/(login|$)/, { timeout: 20_000 });

  await page.goto("/login");
  // SECONDARY, and collapsed: the ordinary path stays one field and one button.
  const email = page.getByTestId("email-login-address");
  await expect(email).toBeHidden();
  await page.getByText("Sign in with your email instead").click();
  await email.fill(EMAIL);
  await page.getByTestId("email-login-send").click();

  await expect(page.getByTestId("email-login-code")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("email-login-code").fill(await mailedCode(EMAIL));
  await page.getByTestId("email-login-verify").click();

  // The SAME account. Authorization keys on personId and cannot tell which
  // door was used.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
  await page.goto("/account");
  await expect(page.getByText("Email Tester").first()).toBeVisible({ timeout: 20_000 });
});

test("an address nobody owns is answered exactly like one that exists", async ({ page }) => {
  /*
   * NO ENUMERATION. A mailbox is a far better guess than a phone number, so a
   * form that behaved differently for unknown addresses would be a membership
   * oracle for anybody holding a list of them. The step advances either way and
   * the wording never claims a code was sent.
   */
  await page.goto("/login");
  await page.getByText("Sign in with your email instead").click();
  await page.getByTestId("email-login-address").fill(`nobody${STAMP}@example.test`);
  await page.getByTestId("email-login-send").click();
  await expect(page.getByTestId("email-login-code")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("email-login-sent")).toContainText("If ");
});
