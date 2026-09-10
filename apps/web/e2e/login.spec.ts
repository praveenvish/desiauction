import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { formatPhone } from "../src/lib/format-phone";
import { latestOtp } from "./otp";

// M-IP2-1 journey: phone → dev inbox → code → session → account → logout,
// exactly as a founder demo runs it. Unique phone per run.

const PHONE = `90${String(Date.now()).slice(-8)}`;

test("full OTP login journey with dev inbox, then logout", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(PHONE);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code");

  const code = await latestOtp(PHONE);
  expect(code).toMatch(/^\d{6}$/);

  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  // PX-3: a brand-new (nameless) account is onboarded before the console —
  // and the name gate now guards every console route, /account included, so
  // the one question has to be cleared before /account will render at all.
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("What should we call you?").fill("Login Tester");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/home/);
  await page.goto("/account");
  // Grouped, not raw — formatPhone renders "+91 XXXXX XXXXX" everywhere a
  // phone is shown to a human.
  await expect(page.getByTestId("account-phone")).toHaveText(formatPhone(`+91${PHONE}`));

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("a wrong code is rejected with a humane message that counts the rope left", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(PHONE.replace(/^98/, "97"));
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByText("That code isn't right. 4 attempts left.")).toBeVisible();
});

test("the account page is gated: no session → /login", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login/);
});

test("an invalid phone is refused before any code is sent", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill("12345");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(
    page.getByText("That doesn't look like an Indian mobile number — 10 digits starting 6–9."),
  ).toBeVisible();
});

test("login page: axe zero violations, phone field focused on load", async ({ page }) => {
  await page.goto("/login");
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual([]);
  // autoFocus puts the caret in the phone field immediately (keyboard-first).
  // This half holds everywhere and is the claim in the test's name.
  await expect(page.getByLabel("Mobile number")).toBeFocused();

  /*
   * TAB REACHING THE BUTTON IS A CHROMIUM/FIREFOX FACT, NOT A PRODUCT ONE.
   *
   * macOS WebKit does not move focus to buttons or links on Tab unless the
   * system's Full Keyboard Access is switched on — Apple's default across the
   * entire web, and Playwright's WebKit mirrors it. Asserting it there would
   * fail for a setting on the tester's Mac.
   *
   * Kept rather than deleted: on the engines that DO tab to controls, this
   * still catches a tabindex or DOM-order mistake that would strand a
   * keyboard user, and that is what it was written for.
   */
  test.skip(
    test.info().project.name === "webkit",
    "macOS WebKit skips buttons on Tab without Full Keyboard Access (Apple default)",
  );
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Send code" })).toBeFocused();
});
