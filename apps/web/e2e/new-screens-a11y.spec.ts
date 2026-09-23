import { expect, test, type Page } from "@playwright/test";

import { axeClean } from "./axe";
import { latestOtp, resetOtpBudget, withSignInLock } from "./otp";

// THE SCREENS THAT SHIPPED WITHOUT A SCAN.
//
// Posters, lineups, the settlement case review, the projector board and the
// broadcast overlay all landed after the journey specs were written, and none
// of those specs walks to them — so not one had ever been through axe. The
// go-live audit counted them as uncovered; this is the sweep.
//
// It reads the demo seed rather than building a season: `demo-cup-settled` is
// the COMPLETED exemplar (auction conducted, lineups recorded for two played
// matches, a settlement case with obligations and payments), which is exactly
// the state these screens exist to show. The founder (+919999000001) is the
// organizer there and holds settlement:controller, so every screen renders its
// full organizer view rather than an empty or refused one.

const FOUNDER = "9999000001";
const SEASON = "/seasons/demo-cup-settled";

async function otpLogin(page: Page, phone: string): Promise<void> {
  // Serialized per phone across workers: see withSignInLock in otp.ts.
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

/**
 * Land on a route and require that it actually rendered before scanning it —
 * axe passes a 404 page just as happily as the screen it replaced, which would
 * make this sweep a test of the not-found shell.
 *
 * `load`, not `networkidle`: the board and the overlay hold a live socket open
 * for as long as they are on screen, so the network never goes idle there.
 */
async function scan(page: Page, path: string, surface: string): Promise<void> {
  const response = await page.goto(path, { waitUntil: "load" });
  expect(response?.status(), `${surface}: ${path} did not render`).toBeLessThan(400);
  await axeClean(page, surface);
}

test("posters, lineups, case review, board and overlay pass axe", async ({ page }) => {
  test.setTimeout(180_000);
  await otpLogin(page, FOUNDER);

  await scan(page, `${SEASON}/posters`, "posters");
  await scan(page, `${SEASON}/lineups`, "lineups");

  // The case id is the seed's, not a constant: follow the money page's own
  // link to its review, the way an organizer reaches it.
  await page.goto(`${SEASON}/money`);
  const review = page.getByRole("link", { name: "Open the case review" });
  await expect(review).toBeVisible({ timeout: 30_000 });
  const href = await review.getAttribute("href");
  expect(href, "the money page offers no case review").toMatch(/\/money\/case\//);
  await scan(page, href ?? "", "money · case review");
  await expect(page.getByTestId("case-panel")).toBeVisible();

  await scan(page, `${SEASON}/auction/board`, "auction · board");
  await scan(page, `${SEASON}/auction/overlay`, "auction · overlay");
});
