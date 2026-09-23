import { createDb, notificationSwitches } from "@desiauction/db";
import { expect, test, type Page } from "@playwright/test";
import { inArray } from "drizzle-orm";

import { axeClean } from "./axe";
import { latestOtp, resetOtpBudget, withSignInLock } from "./otp";

// THE NOTIFICATION CONTROL CENTER (/admin/notifications), through the browser.
//
// What a browser can prove: the page exists for a platform admin and is a real
// 404 for anyone else; a switch flipped here persists across a reload and can
// be reverted from the recent-changes list; a security alert will not switch
// off without a written reason; the page fits a phone and passes axe. The
// rules themselves (the gate's precedence, the CHECKs, the outbox reasons,
// the audit) are proved against Postgres in
// notification-switches.regression.test.ts and platform-switches.test.ts.
//
// The switches are PLATFORM-WIDE, so this spec touches only kinds no other
// spec sends — a demo reminder (sent by the reminder sweep alone) and the
// email-change alert on WhatsApp (not configured under the harness) — and puts
// them back through the page itself, so the server's cache is dropped too.

test.describe.configure({ mode: "serial" });

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";
// The demo seed's fixed identities (seed-demo.ts):
//   founder +919999000001 — platform:admin
//   admin   +919999000002 — org:owner on demo-club, holds no platform grant
const FOUNDER = "9999000001";
const ORG_OWNER = "9999000002";

const KIND = "demo.booking_reminder";
const SECURITY = "security.email_changed";

async function otpLogin(page: Page, phone: string): Promise<void> {
  await withSignInLock(phone, async () => {
    await resetOtpBudget(phone);
    await page.goto("/login");
    await page.getByLabel("Mobile number").fill(phone);
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
      timeout: 30_000,
    });
    await page.getByLabel("6-digit code").fill(await latestOtp(phone));
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page).not.toHaveURL(/\/login/);
  });
}

test.afterAll(async () => {
  // A backstop only: the tests revert through the page. A row left here would
  // hold a platform-wide switch off for every later spec.
  const handle = createDb(DATABASE_URL);
  await handle.db
    .delete(notificationSwitches)
    .where(inArray(notificationSwitches.kind, [KIND, SECURITY]));
  await handle.sql.end();
});

test("an admin switches a message off, sees it hold across a reload, and reverts it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await otpLogin(page, FOUNDER);
  await page.goto("/admin/notifications");
  await expect(page.getByTestId("notify-channels")).toBeVisible();
  await expect(page.getByTestId("notify-state-auth.email_code-email")).toHaveText(/Locked/);
  // A sign-in code has no control to reach for.
  await expect(page.getByTestId("notify-cell-auth.email_code-email")).toHaveCount(0);

  const cell = page.getByTestId(`notify-cell-${KIND}-email`);
  await expect(cell).toBeChecked();
  await cell.uncheck();
  await expect(page.getByTestId(`notify-state-${KIND}-email`)).toHaveText(/Off by admin/);

  await page.reload();
  await expect(page.getByTestId(`notify-cell-${KIND}-email`)).not.toBeChecked();
  await expect(page.getByTestId(`notify-state-${KIND}-email`)).toHaveText(/Off by admin/);

  const recent = page.getByTestId("notify-recent");
  await expect(recent).toContainText("Demo reminder on Email: on → off");
  // Newest first: the change just made.
  await recent
    .getByRole("button", { name: "Revert: Demo reminder on Email: on → off" })
    .first()
    .click();
  await expect(page.getByTestId(`notify-state-${KIND}-email`)).toHaveText(/On|Not configured/);
  await expect(page.getByTestId(`notify-cell-${KIND}-email`)).toBeChecked();

  await axeClean(page, "/admin/notifications");
});

test("a security alert will not switch off without a written reason", async ({ page }) => {
  test.setTimeout(180_000);
  await otpLogin(page, FOUNDER);
  await page.goto("/admin/notifications");

  await page.getByTestId(`notify-cell-${SECURITY}-whatsapp`).uncheck();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("notify-security-warning")).toBeVisible();
  const confirm = dialog.getByTestId("notify-reason-confirm");
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Reason").fill("too short");
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Reason").fill("Meta template paused; back on after review");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByTestId(`notify-state-${SECURITY}-whatsapp`)).toHaveText(/Off by admin/);
  await expect(page.getByTestId(`notify-kind-${SECURITY}`)).toContainText(
    "Meta template paused; back on after review",
  );

  // Back on: no reason needed, and no dialog.
  await page.getByTestId(`notify-cell-${SECURITY}-whatsapp`).check();
  await expect(page.getByTestId(`notify-state-${SECURITY}-whatsapp`)).not.toHaveText(
    /Off by admin/,
  );
});

test("the page is a 404 for anyone without platform.admin", async ({ page }) => {
  test.setTimeout(120_000);
  await otpLogin(page, ORG_OWNER);
  const response = await page.request.get("/admin/notifications");
  expect(response.status()).toBe(404);
});

test("360px: the control center fits a phone", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 360, height: 780 });
  await otpLogin(page, FOUNDER);
  await page.goto("/admin/notifications");
  await expect(page.getByTestId("notify-channels")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "/admin/notifications scrolls sideways at 360px").toBeLessThanOrEqual(0);
});
