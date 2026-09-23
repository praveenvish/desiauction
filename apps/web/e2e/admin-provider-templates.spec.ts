import { createDb, providerTemplateMappings } from "@desiauction/db";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { axeClean } from "./axe";
import { latestOtp, resetOtpBudget, withSignInLock } from "./otp";

// WHATSAPP AND SMS TEMPLATE MAPPING (/admin/notifications/templates), through
// the browser — Notification Control Center, Phase 3.
//
// What a browser can prove: the grid leads to the templates page; a name
// mapped there shows on the grid's WhatsApp cell as "mapped here"; clearing it
// puts the cell back on the server setting; without a WhatsApp Business
// Account id the page says status sync is off (the harness never sets one);
// the page fits a phone and passes axe; and it is a 404 for anyone without
// platform.admin. That a mapping reaches a real send, the audit, revert, the
// sync and the submit are proved against Postgres in
// server/messaging/provider-templates.regression.test.ts.
//
// Mappings are PLATFORM-WIDE, so this spec maps only
// `registration.restored` — a WhatsApp moment no other spec asserts — and
// removes its row before and after.

test.describe.configure({ mode: "serial" });

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";
// The demo seed's fixed identities (seed-demo.ts):
//   founder +919999000001 — platform:admin
//   admin   +919999000002 — org:owner on demo-club, holds no platform grant
const FOUNDER = "9999000001";
const ORG_OWNER = "9999000002";

const KIND = "registration.restored";
const PAGE = "/admin/notifications/templates";

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

async function purgeMapping(): Promise<void> {
  const handle = createDb(DATABASE_URL);
  await handle.db.delete(providerTemplateMappings).where(eq(providerTemplateMappings.kind, KIND));
  await handle.sql.end();
}

test.beforeAll(purgeMapping);
test.afterAll(purgeMapping);

test("an admin maps a WhatsApp template, the grid follows, and clearing goes back to the server setting", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const name = `da_restored_e2e_${String(Date.now())}`;

  await otpLogin(page, FOUNDER);
  await page.goto("/admin/notifications");
  const cellLine = page.getByTestId(`notify-template-${KIND}-whatsapp`);
  await expect(cellLine).not.toHaveAttribute("data-source", "admin");

  // The grid's cell leads to this kind's row on the templates page.
  await cellLine.click();
  await expect(page).toHaveURL(new RegExp(`${PAGE}#tpl-${KIND.replace(".", "\\.")}$`));
  const row = page.getByTestId(`tpl-wa-${KIND}`);
  await expect(row).toBeVisible();

  // No WABA id in the harness: status sync is off, and says why.
  await expect(page.getByTestId("tpl-sync-disabled")).toContainText("WHATSAPP_BUSINESS_ACCOUNT_ID");
  await expect(page.getByTestId("tpl-refresh")).toHaveCount(0);
  // The sign-in template is shown, read-only.
  await expect(page.getByTestId("tpl-otp")).toContainText("Read-only");
  // SMS is dormant in the harness, and says so.
  await expect(page.getByTestId("tpl-sms")).toBeVisible();

  // Meta's name rule is checked as it is typed.
  const prefix = `tpl-map-whatsapp-${KIND}`;
  await page.getByTestId(`${prefix}-open`).click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByTestId(`${prefix}-value`);
  await input.fill("Not-A-Name");
  await expect(dialog.getByTestId(`${prefix}-save`)).toBeDisabled();
  await input.fill(name);
  await dialog.getByTestId(`${prefix}-save`).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect(page.getByTestId(`tpl-wa-name-${KIND}`)).toHaveText(name);
  await expect(page.getByTestId(`tpl-wa-name-${KIND}-source`)).toHaveText("Mapped here");
  await expect(page.getByTestId("tpl-recent")).toContainText(name);

  // The grid now names the mapped template.
  await page.goto("/admin/notifications");
  await expect(cellLine).toHaveAttribute("data-source", "admin");
  await expect(cellLine).toContainText(name);

  // Clear: back to the server setting.
  await page.goto(PAGE);
  await page.getByTestId(`tpl-clear-whatsapp-${KIND}`).click();
  await expect(page.getByTestId(`tpl-wa-name-${KIND}-source`)).not.toHaveText("Mapped here");
  await expect(page.getByTestId(`tpl-clear-whatsapp-${KIND}`)).toHaveCount(0);

  await page.goto("/admin/notifications");
  await expect(cellLine).not.toHaveAttribute("data-source", "admin");
  await expect(cellLine).not.toContainText(name);
});

test("360px: the templates page fits a phone, and passes axe", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 360, height: 780 });
  await otpLogin(page, FOUNDER);
  await page.goto(PAGE);
  await expect(page.getByTestId("tpl-whatsapp")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${PAGE} scrolls sideways at 360px`).toBeLessThanOrEqual(0);
  await axeClean(page, PAGE);
});

test("the templates page is a 404 for anyone without platform.admin", async ({ page }) => {
  test.setTimeout(120_000);
  await otpLogin(page, ORG_OWNER);
  const response = await page.request.get(PAGE);
  expect(response.status()).toBe(404);
});
