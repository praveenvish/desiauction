import { expect, test, type Page } from "@playwright/test";

import { latestOtp } from "./otp";

/*
 * PLAYERS WITHOUT A PHOTO (0107): the organizer picks initials or the
 * cricketer on the season overview, and the season's pages follow.
 *
 * Driven through the real screens: the choice is read by the season layout,
 * so the only proof that it reaches a page is a page.
 */
const STAMP = String(Date.now()).slice(-8);
const COLD = { timeout: 30_000 } as const;

async function otpLogin(page: Page, phone: string): Promise<void> {
  if (!page.url().includes("/login")) {
    await page.goto("/login");
  }
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", COLD);
  const code = await latestOtp(phone);
  await page.getByLabel("6-digit code").clear();
  await page.getByLabel("6-digit code").pressSequentially(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/, COLD);
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill("E2E Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).not.toHaveURL(/\/onboarding/, COLD);
  }
}

test("an organizer switches players without a photo to the silhouette, and back", async ({
  page,
}) => {
  await otpLogin(page, `86${STAMP}`);
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Club name").filter({ visible: true }).fill(`Sil Org ${STAMP}`);
  await page.getByRole("button", { name: "Create club" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible(COLD);

  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Sil Cup ${STAMP}`);
  await page.getByRole("button", { name: "Create season" }).click();

  // The overview's "How the season looks": initials until the organizer says otherwise.
  const row = page.getByTestId("no-photo-row");
  await expect(row).toBeVisible(COLD);
  await expect(page.getByTestId("no-photo-initials")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("no-photo-silhouette").click();
  await expect(page.getByTestId("no-photo-silhouette")).toHaveAttribute(
    "aria-pressed",
    "true",
    COLD,
  );
  // The row's own preview follows the season's choice.
  await expect(row.locator("[data-placeholder='silhouette']")).toBeVisible();

  // A player with no photo, on the Players list, is the cricketer.
  await page.getByTestId("open-dashboard").click();
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", COLD);
  await page.getByTestId("open-add-player").click();
  await page.getByRole("dialog").getByLabel("Full name").fill("No Photo Player");
  await page.getByRole("dialog").getByLabel("Mobile number").fill(`95${STAMP}`);
  await page.getByTestId("add-player-submit").click();
  await page.getByTestId("add-player-done").click({ timeout: 20_000 });
  const table = page.getByTestId("reg-table");
  await expect(table).toContainText("No Photo Player");
  await expect(table.locator("[data-placeholder='silhouette']").first()).toBeVisible();

  // And back: initials again.
  await page.goBack();
  await page.getByTestId("no-photo-initials").click();
  await expect(page.getByTestId("no-photo-initials")).toHaveAttribute("aria-pressed", "true", COLD);
  await expect(row.locator("[data-placeholder='silhouette']")).toHaveCount(0);
});
