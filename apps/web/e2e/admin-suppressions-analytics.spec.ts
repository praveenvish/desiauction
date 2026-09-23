import { createDb, newId, suppressions } from "@desiauction/db";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { axeClean } from "./axe";
import { latestOtp, resetOtpBudget, withSignInLock } from "./otp";

// THE SUPPRESSION DESK AND DELIVERY ANALYTICS (Notification Control Center,
// Phase 4), through the browser.
//
// What a browser can prove: an admin adds a manual suppression, finds it by
// looking the contact up, lifts it with a reason and reverts the lift from the
// recent-changes list; a STOP will not lift without the "I understand" tick;
// the analytics page renders and its window switch is a real link; both pages
// are a 404 for anyone else, fit a phone and pass axe. The rules (the server's
// confirmation check, the outbox effect, the audit, the aggregates) are proved
// against Postgres in suppression-desk.regression.test.ts.
//
// The contacts are this run's own, so no other spec's sends are touched; the
// backstop below removes whatever a failed run leaves.

test.describe.configure({ mode: "serial" });

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";
// The demo seed's fixed identities (seed-demo.ts):
//   founder +919999000001 — platform:admin
//   admin   +919999000002 — org:owner on demo-club, holds no platform grant
const FOUNDER = "9999000001";
const ORG_OWNER = "9999000002";

const RUN = String(Date.now()).slice(-7);
const EMAIL = `e2e-suppress-${RUN}@example.test`;
// A number nobody in the seed has: 7 + 2 + seven digits of the run.
const STOPPED_LOCAL = `72${RUN}0`;
const STOPPED = `+91${STOPPED_LOCAL}`;

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

async function lookUp(page: Page, contact: string): Promise<void> {
  const search = page.getByTestId("suppression-search");
  await search.getByLabel("Email address or mobile number").fill(contact);
  await search.getByRole("button", { name: "Look up" }).click();
}

test.afterAll(async () => {
  const handle = createDb(DATABASE_URL);
  await handle.db.delete(suppressions).where(eq(suppressions.contact, EMAIL));
  await handle.db.delete(suppressions).where(eq(suppressions.contact, STOPPED));
  await handle.sql.end();
});

test("an admin suppresses an address, finds it, lifts it with a reason, and reverts the lift", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await otpLogin(page, FOUNDER);
  await page.goto("/admin/notifications");
  await page.getByRole("link", { name: "Suppressions", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/notifications\/suppressions$/);

  // Add, by hand.
  const add = page.getByTestId("suppression-add");
  const submit = add.getByRole("button", { name: "Suppress" });
  await add.getByLabel("Email address or mobile number").fill(EMAIL.toUpperCase());
  await expect(submit).toBeDisabled();
  await add.getByLabel("Reason").fill("Asked by email to support");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByTestId("suppression-recent")).toContainText("Suppressed by hand");

  // It is there when the address is looked up — typed in another case.
  await lookUp(page, EMAIL);
  const results = page.getByTestId("suppression-results");
  const row = results.locator('[data-active="true"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("manual");
  await expect(row).toContainText("Added by an admin");

  // Lift, with a reason. A manual suppression needs no "I understand".
  await row.getByRole("button", { name: /^Lift/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("suppression-lift-understood")).toHaveCount(0);
  const confirm = dialog.getByTestId("suppression-lift-confirm");
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Reason").fill("Support confirmed they want mail");
  await confirm.click();
  await expect(results.locator('[data-active="false"]')).toHaveCount(1);
  await expect(results.locator('[data-active="true"]')).toHaveCount(0);

  // Revert the lift: newest first, and it is the only revertable one for the row.
  const recent = page.getByTestId("suppression-recent");
  await expect(recent).toContainText("Lifted (manual)");
  await recent
    .getByRole("button", { name: /^Revert: Lifted \(manual\)/ })
    .first()
    .click();
  await expect(recent).toContainText("Put back in force (manual)");
  await lookUp(page, EMAIL);
  await expect(results.locator('[data-active="true"]')).toHaveCount(1);

  await axeClean(page, "/admin/notifications/suppressions");
});

test("a STOP will not lift without the person's wish being acknowledged", async ({ page }) => {
  test.setTimeout(180_000);
  const handle = createDb(DATABASE_URL);
  await handle.db.insert(suppressions).values({
    id: newId(),
    contact: STOPPED,
    channel: "sms",
    scope: "global",
    reason: "stop",
    note: "inbound: STOP",
  });
  await handle.sql.end();

  await otpLogin(page, FOUNDER);
  await page.goto("/admin/notifications/suppressions");
  // Typed the way a person reads it off a phone.
  await lookUp(page, `${STOPPED_LOCAL.slice(0, 5)} ${STOPPED_LOCAL.slice(5)}`);
  const row = page.getByTestId("suppression-results").locator('[data-active="true"]');
  await expect(row).toContainText("They texted STOP");
  await row.getByRole("button", { name: /^Lift/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("suppression-lift-warning")).toContainText(
    "asked us not to contact them",
  );
  const confirm = dialog.getByTestId("suppression-lift-confirm");
  await dialog.getByLabel("Reason").fill("They called support and asked to rejoin");
  await expect(confirm, "a reason alone does not lift a STOP").toBeDisabled();
  await dialog.getByTestId("suppression-lift-understood").check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(
    page.getByTestId("suppression-results").locator('[data-active="false"]'),
  ).toHaveCount(1);
});

test("delivery analytics renders, and the window switch is a link", async ({ page }) => {
  test.setTimeout(180_000);
  await otpLogin(page, FOUNDER);
  await page.goto("/admin/notifications");
  await page.getByRole("link", { name: "Delivery analytics", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/notifications\/analytics$/);
  await expect(page.getByTestId("analytics-channels")).toBeVisible();
  await expect(page.getByTestId("analytics-channel-whatsapp")).toContainText("Delivered");
  await expect(page.getByTestId("analytics-trend").getByRole("img")).toBeVisible();

  const windows = page.getByTestId("analytics-windows");
  await expect(windows.getByRole("link", { name: "Last 30 days" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await windows.getByRole("link", { name: "Last 7 days" }).click();
  await expect(page).toHaveURL(/days=7$/);
  await expect(windows.getByRole("link", { name: "Last 7 days" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // The fallback table has a row per day.
  await page.getByText("Show the numbers by day").click();
  await expect(page.getByTestId("analytics-trend-table").locator("tbody tr")).toHaveCount(7);

  // A hand-typed window is clamped, not obeyed.
  await page.goto("/admin/notifications/analytics?days=3650");
  await expect(windows.getByRole("link", { name: "Last 90 days" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await axeClean(page, "/admin/notifications/analytics");
});

test("both pages are a 404 for anyone without platform.admin", async ({ page }) => {
  test.setTimeout(120_000);
  await otpLogin(page, ORG_OWNER);
  for (const path of ["/admin/notifications/suppressions", "/admin/notifications/analytics"]) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(404);
  }
});

test("360px: both pages fit a phone", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 360, height: 780 });
  await otpLogin(page, FOUNDER);
  for (const [path, marker] of [
    ["/admin/notifications/suppressions", "suppression-lookup"],
    ["/admin/notifications/analytics?days=90", "analytics-channels"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByTestId(marker)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} scrolls sideways at 360px`).toBeLessThanOrEqual(0);
  }
  await axeClean(page, "/admin/notifications/analytics?days=90 at 360px");
});
