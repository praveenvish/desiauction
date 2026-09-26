import AxeBuilder from "@axe-core/playwright";
import { createDb, otpInbox } from "@desiauction/db";
import { expect, test, type Page } from "@playwright/test";
import { desc, eq } from "drizzle-orm";
import { axeClean } from "./axe";

/*
 * TWO DOORS, ONE OPEN AT A TIME — and neither asks for a password (C-24).
 *
 * Production opens /login on the EMAIL door until SMS is live
 * (LOGIN_DEFAULT_METHOD=email); the harness pins the phone door for the ~30
 * specs that sign in by mobile number, so this spec reaches the email door the
 * way support would send somebody to it: `/login?method=email`.
 */
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";
const STAMP = String(Date.now()).slice(-8);

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

test("the email door is one field and one button, and the mobile door is one link away", async ({
  page,
}) => {
  await page.goto("/login?method=email&next=%2Fhelp");
  await expect(page.getByTestId("email-login-address")).toBeVisible();
  // The other door is offered once, below the form — not as a switch above it.
  await expect(page.getByTestId("login-method-phone")).toHaveText(/Use mobile number/);
  await expect(page.getByTestId("login-method-email")).toHaveCount(0);
  await expect(page.getByTestId("email-login-send")).toHaveText("Email me a code");
  // Only one form: the phone form is not stacked underneath.
  await expect(page.getByTestId("login-form")).toHaveCount(0);
  // No password anywhere on the page.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByTestId("passkey-login")).toBeVisible();
  await axeClean(page, "/login?method=email");

  // Switching doors keeps where the person was headed.
  await page.getByTestId("login-method-phone").click();
  await expect(page).toHaveURL(/method=phone/);
  await expect(page).toHaveURL(/next=%2Fhelp/);
  await expect(page.getByLabel("Mobile number")).toBeVisible();
  await expect(page.getByTestId("email-login-form")).toHaveCount(0);
  // …and the way back.
  await expect(page.getByTestId("login-method-email")).toHaveText(/Use email instead/);
  await axeClean(page, "/login?method=phone");
});

test("a first visit is told the code creates an account; a returning device is not", async ({
  page,
  context,
}) => {
  await page.goto("/login?method=email");
  await expect(page.getByTestId("email-login-new-hint")).toBeVisible();
  await expect(page.locator("h1")).toHaveText("Continue to DesiAuction");

  // The cookie a completed sign-in leaves behind (sessions.ts RETURNING_COOKIE).
  await context.addCookies([{ name: "da_returning", value: "1", url: page.url() }]);
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Welcome back");
  await expect(page.getByTestId("email-login-new-hint")).toHaveCount(0);
  // Its passkey leads, above the form.
  const passkey = await page.getByTestId("passkey-login").boundingBox();
  const field = await page.getByTestId("email-login-address").boundingBox();
  expect(passkey !== null && field !== null && passkey.y < field.y).toBe(true);
});

test("the email code step survives a reload, and a new address becomes an account", async ({
  page,
}) => {
  const address = `doors${STAMP}@example.test`;
  await page.goto("/login?method=email");
  await page.getByTestId("email-login-address").fill(address);
  await page.getByTestId("email-login-send").click();
  await expect(page.getByTestId("email-login-code")).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/method=email&step=code&to=/);

  // Leaving for the mail app evicts a backgrounded tab on a phone. The step and
  // the address come back from the URL.
  await page.reload();
  await expect(page.getByTestId("email-login-code")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("email-login-sent")).toContainText(address);

  await page.getByTestId("email-login-code").fill(await mailedCode(address));
  await page.getByTestId("email-login-verify").click();
  // A brand-new account has no name yet, so it lands on the name gate.
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 });
});

test("a different email goes back one step with the address kept", async ({ page }) => {
  const address = `change${STAMP}@example.test`;
  await page.goto("/login?method=email");
  await page.getByTestId("email-login-address").fill(address);
  await page.getByTestId("email-login-send").click();
  await expect(page.getByTestId("email-login-code")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("email-resend-code")).toBeDisabled();

  await page.getByTestId("email-change-address").click();
  await expect(page.getByTestId("email-login-address")).toHaveValue(address);
  await expect(page).not.toHaveURL(/step=code/);
});

test("360px: both doors fit a phone without scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const method of ["email", "phone"]) {
    await page.goto(`/login?method=${method}`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `/login?method=${method} scrolls sideways at 360px`).toBeLessThanOrEqual(0);
  }
});
