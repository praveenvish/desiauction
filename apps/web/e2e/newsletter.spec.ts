import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { latestOtp, resetOtpBudget } from "./otp";

// THE PRODUCT-NEWS LIST, end to end: the footer says how to leave, the leaving
// page answers the same whether or not the address was there, and the list has
// an owner who can count it and take it away as a file — nobody else can.

const FOUNDER = "9999000001"; // platform:admin in the demo seed
const ORG_OWNER = "9999000002"; // no platform grant
const STAMP = String(Date.now()).slice(-8);

async function otpLogin(page: Page, phone: string): Promise<void> {
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
}

test("sign up, find the way out in the footer, and leave", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator("footer");
  await footer.getByLabel("Email address").fill(`leaver.${STAMP}@example.test`);
  await footer.getByRole("button", { name: "Subscribe" }).click();
  await expect(footer.getByText("Subscribed")).toBeVisible();

  await page.goto("/pricing");
  await page.locator("footer").getByRole("link", { name: "Unsubscribe" }).click();
  await expect(page).toHaveURL(/\/newsletter\/unsubscribe$/);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);

  const main = page.locator("main");
  await main.getByLabel("Email address to remove").fill(`leaver.${STAMP}@example.test`);
  await main.getByRole("button", { name: "Unsubscribe" }).click();
  // Deliberately the same sentence for an address that was never subscribed.
  await expect(page.getByTestId("unsubscribed")).toHaveText(
    "Done. If that address was on our list, it isn't any more.",
  );
});

test("an address that was never on the list gets the identical answer", async ({ page }) => {
  await page.goto("/newsletter/unsubscribe");
  const main = page.locator("main");
  await main.getByLabel("Email address to remove").fill(`never.${STAMP}@example.test`);
  await main.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(page.getByTestId("unsubscribed")).toHaveText(
    "Done. If that address was on our list, it isn't any more.",
  );
});

test("the platform admin can count the list and export it; nobody else can", async ({
  browser,
}) => {
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await otpLogin(admin, FOUNDER);
  await admin.goto("/admin/newsletter");
  await expect(admin.getByRole("heading", { level: 1 })).toBeVisible();
  const exported = await admin.request.get("/admin/newsletter/export");
  expect(exported.status()).toBe(200);
  expect(exported.headers()["content-type"]).toContain("text/csv");
  expect((await exported.text()).split("\n")[0]).toBe("email,subscribed_at");
  await adminContext.close();

  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await otpLogin(owner, ORG_OWNER);
  expect((await owner.goto("/admin/newsletter"))?.status()).toBe(404);
  expect((await owner.request.get("/admin/newsletter/export")).status()).toBe(404);
  await ownerContext.close();
});
