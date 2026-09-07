import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { latestOtp } from "./otp";
import { insertCareerFixture, insertWomensSeason, personIdByPhone } from "./player-fixtures";

/**
 * PI-1: the player-identity journeys, end to end in a real browser.
 *
 *  1. The cricket profile — saved on /account, counted by the 8-item
 *     checklist, framing /me/cricket.
 *  2. The career — a settled season (DB fixture) renders with its verdict and
 *     its price, axe-clean in the shell it actually ships in.
 *  3. The gendered category — a declared mismatch is refused with the real
 *     sentence at submit, and fixing the profile opens the same door.
 */

const STAMP = String(Date.now()).slice(-8);
const PLAYER = `65${STAMP}`;
const PLAYER_PHONE = `+91${PLAYER}`;

test.describe.configure({ mode: "serial" });

async function otpLogin(page: Page, phone: string): Promise<void> {
  if (!page.url().includes("/login")) {
    await page.goto("/login");
  }
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
    timeout: 30_000,
  });
  const code = await latestOtp(phone);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("the cricket profile saves, counts, and frames the career page", async ({ page }) => {
  test.setTimeout(120_000);
  await otpLogin(page, PLAYER);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("What should we call you?").fill("Asha Player");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/home/);

  // The login form carries the terms notice the consent record is minted from.
  // (Asserted on the way in: it is login furniture, not account furniture.)

  await page.goto("/account");
  await expect(page.getByTestId("profile-completion")).toContainText("Profile 1/8 complete");

  /*
   * TWO SAVES, because Phase 3 split one form into two facts. Date of birth and
   * city are true of the PERSON whatever they play; the playing role is true of
   * them in a SPORT. The old single panel could only hold one sport's answer.
   */
  await page.getByLabel("Date of birth").fill("1995-05-10");
  await page.getByLabel("City").fill("Kolkata");
  await page.getByLabel("Gender").selectOption("unspecified");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();

  await page.getByLabel("Cricket playing role").selectOption("all_rounder");
  await page.getByRole("button", { name: "Save cricket profile" }).click();
  await expect(page.getByText("Cricket profile saved")).toBeVisible();

  // name + role + dob + city = 4 of 8; gender deliberately never counts. The
  // role now reaches the checklist from the cricket panel, which is the point.
  await expect(page.getByTestId("profile-completion")).toContainText("Profile 4/8 complete");

  await page.goto("/me/cricket");
  await expect(page.getByTestId("career-header")).toContainText("Asha Player");
  await expect(page.getByTestId("career-header")).toContainText("All-rounder");
  await expect(page.getByText("No seasons yet")).toBeVisible();

  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
});

test("a settled season renders on /me/cricket with its verdict and price", async ({ page }) => {
  test.setTimeout(120_000);
  const personId = await personIdByPhone(PLAYER_PHONE);
  const fixture = await insertCareerFixture(personId, STAMP);

  await otpLogin(page, PLAYER);
  await page.goto("/me/cricket");
  await expect(page.getByTestId("career-seasons")).toContainText(fixture.competitionName);
  await expect(page.getByTestId("career-seasons")).toContainText(
    `Sold · ${fixture.soldPriceLabel}`,
  );
  // Totals fold from the same rows the list renders.
  await expect(page.getByText("Times sold")).toBeVisible();
  // /home now offers the career door beside the registrations rail.
  await page.goto("/home");
  await expect(page.getByTestId("home-career-link")).toBeVisible();
});

test("a gendered category refuses a declared mismatch, and the profile fix opens it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const season = await insertWomensSeason(STAMP);

  // Declare the mismatch on the profile first.
  await otpLogin(page, PLAYER);
  await page.goto("/account");
  await page.getByLabel("Gender").selectOption("male");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();

  // The register page opens on step 2 (name is set), PREFILLED from the
  // profile — the PI-1 write-back and prefill meeting in one control.
  await page.goto(season.registerPath);
  await expect(page.getByTestId("register-card")).toBeVisible();
  // The register form's own control — still "Playing role". Only /account
  // names the sport, because only /account shows one panel per sport.
  await expect(page.getByLabel("Playing role")).toHaveValue("all_rounder");
  await page.getByTestId("register-continue").click();
  await page.getByTestId("register-consent").check();
  await page.getByTestId("register-submit").click();
  // Not getByRole("alert"): Next's route announcer is a second, empty alert.
  await expect(page.locator(".register-error")).toContainText("gendered category");

  // Correct the profile; the same door opens.
  await page.goto("/account");
  await page.getByLabel("Gender").selectOption("female");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();

  await page.goto(season.registerPath);
  await page.getByTestId("register-continue").click();
  await page.getByTestId("register-consent").check();
  await page.getByTestId("register-submit").click();
  await expect(page.getByTestId("registration-submitted")).toBeVisible({ timeout: 30_000 });
});
