import { createDb, notificationTemplates } from "@desiauction/db";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { axeClean } from "./axe";
import { latestOtp, resetOtpBudget, withSignInLock } from "./otp";

// THE EMAIL WORDING EDITOR (/admin/notifications/[kind]/email), through the
// browser — Notification Control Center, Phase 2.
//
// What a browser can prove: the grid leads to the editor; a subject typed here
// reaches the server-rendered preview; publish, restore and reset each move the
// live version the way the history says; the Hindi tab starts from the Hindi
// default; a foreign link is refused inline before anything is sent; and the
// page is a real 404 for anyone without platform.admin. The rules themselves
// (placeholders, locked lines, own-domain links, the audit, the version
// numbering) are proved against Postgres beside template-writer.ts.
//
// The wording is PLATFORM-WIDE, so this spec edits only `auction.unsold` — a
// mail no other spec asserts the words of — and puts it back through the page
// (Reset), which also drops the server's template cache. The rows it leaves
// are deleted before and after, so the version numbers below start at v1.

test.describe.configure({ mode: "serial" });

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";
// The demo seed's fixed identities (seed-demo.ts):
//   founder +919999000001 — platform:admin
//   admin   +919999000002 — org:owner on demo-club, holds no platform grant
const FOUNDER = "9999000001";
const ORG_OWNER = "9999000002";

const KIND = "auction.unsold";
const EDITOR = `/admin/notifications/${KIND}/email`;
const DEFAULT_EN_SUBJECT = "Your {{season}} auction";
const DEFAULT_HI_SUBJECT = "आपकी {{season}} नीलामी";

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

/** Every stored version of the kind, in every language: a clean slate, and a backstop. */
async function purgeTemplates(): Promise<void> {
  const handle = createDb(DATABASE_URL);
  await handle.db.delete(notificationTemplates).where(eq(notificationTemplates.kind, KIND));
  await handle.sql.end();
}

test.beforeAll(purgeTemplates);
// A backstop only: the flow resets through the page. A published row left here
// would change what every later spec's unsold player is told.
test.afterAll(purgeTemplates);

async function publish(page: Page, note: string): Promise<void> {
  await page.getByTestId("template-publish").click();
  await page.getByTestId("template-publish-note").fill(note);
  await page.getByTestId("template-publish-confirm").click();
}

test("an admin publishes, restores and resets an email's wording, and a foreign link is refused", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = String(Date.now());
  const first = `Your {{season}} auction, e2e one ${stamp}`;
  const second = `Your {{season}} auction, e2e two ${stamp}`;

  await otpLogin(page, FOUNDER);
  await page.goto("/admin/notifications");
  const line = page.getByTestId(`notify-wording-${KIND}`);
  await expect(line).toContainText("Default");
  await line.getByRole("link", { name: /Edit email wording/ }).click();
  await expect(page).toHaveURL(new RegExp(`${EDITOR.replaceAll(".", "\\.")}$`));

  // English is the first tab, and nothing has been published yet.
  await expect(page.getByTestId("template-lang-en")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("template-status-en")).toHaveText("Default");
  const subject = page.getByTestId("template-subject");
  await expect(subject).toHaveValue(DEFAULT_EN_SUBJECT);

  // Typing reaches the server-rendered preview (debounced), with the sample
  // season filled in — so only the unique tail is asserted.
  await subject.fill(first);
  await expect(page.getByTestId("template-preview-subject")).toContainText(`e2e one ${stamp}`);
  await expect(page.getByTestId("template-preview-frame")).toBeVisible();

  await publish(page, "e2e: first wording");
  await expect(page.getByTestId("template-status-en")).toHaveText("Published v1");
  await expect(page.getByTestId("template-history")).toContainText("v1");
  await expect(page.getByTestId("template-version-1")).toContainText("e2e: first wording");
  await expect(subject).toHaveValue(first);

  await subject.fill(second);
  await publish(page, "e2e: second wording");
  await expect(page.getByTestId("template-status-en")).toHaveText("Published v2");

  // Restore publishes v1's words again, as a NEW version.
  await page.getByTestId("template-restore-1").click();
  await page.getByTestId("template-restore-confirm-1").click();
  await expect(page.getByTestId("template-status-en")).toHaveText("Published v3");
  await expect(subject).toHaveValue(first);
  await expect(page.getByTestId("template-preview-subject")).toContainText(`e2e one ${stamp}`);
  await expect(page.getByTestId("template-changes")).toContainText("Restored v1 as v3");

  // Reset: the code default goes out again.
  await page.getByTestId("template-reset").click();
  await page.getByTestId("template-reset-confirm").click();
  await expect(page.getByTestId("template-status-en")).toHaveText("Default");
  await expect(subject).toHaveValue(DEFAULT_EN_SUBJECT);
  await expect(page.getByTestId("template-reset")).toHaveCount(0);

  // Hindi starts from the Hindi default, untouched by the English publishes.
  await page.getByTestId("template-lang-hi").click();
  await expect(page.getByTestId("template-lang-hi")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("template-status-hi")).toHaveText("Default");
  await expect(subject).toHaveValue(DEFAULT_HI_SUBJECT);

  // A link to anywhere but our own domain is refused as it is typed, and the
  // wording cannot be published or saved while it is there.
  await page.getByTestId("template-add-paragraph").click();
  const added = page.getByTestId("template-paragraphs-3");
  await added.fill("यहाँ लॉग इन करें: https://evil.example.com/login");
  await expect(page.getByTestId("template-error-paragraphs-3")).toContainText("desiauction.in");
  await expect(added).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("template-issue-count")).toContainText("to fix");
  await expect(page.getByTestId("template-publish")).toBeDisabled();
  await expect(page.getByTestId("template-save-draft")).toBeDisabled();

  await page.getByTestId("template-discard").click();
  await expect(page.getByTestId("template-publish")).toBeEnabled();

  // And the grid says so.
  await page.goto("/admin/notifications");
  await expect(page.getByTestId(`notify-wording-${KIND}`)).not.toContainText("Published");
});

test("360px: the editor fits a phone, and passes axe", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 360, height: 780 });
  await otpLogin(page, FOUNDER);
  await page.goto(EDITOR);
  await expect(page.getByTestId("template-editor")).toBeVisible();
  await expect(page.getByTestId("template-preview-subject")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${EDITOR} scrolls sideways at 360px`).toBeLessThanOrEqual(0);
  // The preview is the email itself, in a sandboxed frame — not this page's
  // interface. Scanned into, it hung WebKit and bled its <h1> into the outline.
  await axeClean(page, EDITOR, { exclude: ['[data-testid="template-preview-frame"]'] });
});

test("the editor is a 404 for anyone without platform.admin", async ({ page }) => {
  test.setTimeout(120_000);
  await otpLogin(page, ORG_OWNER);
  const response = await page.request.get(EDITOR);
  expect(response.status()).toBe(404);
});
