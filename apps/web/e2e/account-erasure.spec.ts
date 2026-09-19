import AxeBuilder from "@axe-core/playwright";
import { createDb, grants, newId, people } from "@desiauction/db";
import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { clearNameGate } from "./onboarding";
import { latestOtp, resetOtpBudget, withSignInLock } from "./otp";

// ACCOUNT ERASURE, as the person and the privacy desk each experience it:
// a player asks from /account → the desk erases them → the player is signed out
// everywhere → their number, now freed, opens a brand-new account.
//
// The erasure's DATA effects are proved under the production app role in
// src/posture/erasure.posture.test.ts. This spec proves the journey: the
// consequences are stated before anything is sent, the desk refuses without the
// typed word, and the person really is gone afterwards.

test.describe.configure({ mode: "serial" });

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";
// The demo founder (seed-demo.ts). The spec lends them `platform:privacy` for
// its own duration — the grant is unforgeable from inside the product, which is
// the point, so a test has to install it the way an operator would: out of band.
const FOUNDER = "9999000001";
const STAMP = String(Date.now()).slice(-8);
const PLAYER = `7${STAMP}1`.slice(0, 10);
const PLAYER_NAME = `Erasure Player ${STAMP}`;

let grantId = "";

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

async function axeClean(page: Page, surface: string): Promise<void> {
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations, `${surface}: ${JSON.stringify(scan.violations, null, 2)}`).toEqual([]);
}

test.beforeAll(async () => {
  const handle = createDb(DATABASE_URL);
  const [founder] = await handle.db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.phone, `+91${FOUNDER}`))
    .limit(1);
  if (founder === undefined) {
    throw new Error("the demo seed is missing the founder — run pnpm seed:demo");
  }
  grantId = newId();
  await handle.db.insert(grants).values({
    id: grantId,
    personId: founder.id,
    scopeType: "platform",
    scopeId: "00000000000000000000000000",
    capabilitySet: "platform:privacy",
    grantedBy: founder.id,
  });
  await handle.sql.end();
});

test.afterAll(async () => {
  const handle = createDb(DATABASE_URL);
  await handle.db.delete(grants).where(and(eq(grants.id, grantId)));
  await handle.sql.end();
});

test("a player asks to be deleted, the desk erases them, and they are gone", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  const deskContext = await browser.newContext();
  const desk = await deskContext.newPage();

  // --- The player asks --------------------------------------------------------
  await otpLogin(player, PLAYER);
  await clearNameGate(player, PLAYER_NAME);
  await player.goto("/account");
  await player.getByTestId("erasure-open").click();
  const dialog = player.getByRole("dialog");
  // The consequence is said BEFORE anything is sent.
  await expect(dialog).toContainText("cannot be undone");
  await expect(dialog.getByTestId("erasure-submit")).toBeDisabled();
  await axeClean(player, "/account (deletion dialog)");
  await dialog.getByTestId("erasure-understood").check();
  await dialog.getByTestId("erasure-submit").click();
  await expect(player.getByTestId("erasure-pending")).toBeVisible();

  // --- The privacy desk decides ----------------------------------------------
  await otpLogin(desk, FOUNDER);
  await desk.goto("/admin/erasure");
  const row = desk.getByTestId("erasure-open").locator("li", { hasText: PLAYER_NAME });
  await expect(row).toBeVisible();
  await axeClean(desk, "/admin/erasure");
  await row.getByRole("button", { name: "Erase account…" }).click();
  const confirm = desk.getByRole("dialog");
  // The button will not take a habit — only the typed word.
  await expect(confirm.getByTestId("erase-confirm")).toBeDisabled();
  await confirm.getByLabel("Type ERASE to confirm").fill("ERASE");
  await confirm.getByTestId("erase-confirm").click();
  await expect(desk.getByText("Account erased", { exact: false }).first()).toBeVisible();
  await expect(
    desk.getByTestId("erasure-open").locator("li", { hasText: PLAYER_NAME }),
  ).toHaveCount(0);

  // --- The player is gone ----------------------------------------------------
  // Every session was deleted, so the next request is signed out.
  await player.goto("/account");
  await expect(player).toHaveURL(/\/login/);
  // And the number is free: signing in with it opens a NEW account, which asks
  // for a name — the erased person's was not kept to hand back.
  await otpLogin(player, PLAYER);
  await expect(player.getByLabel("What should we call you?")).toBeVisible();

  await playerContext.close();
  await deskContext.close();
});

test("the desk does not exist for an operator without platform:privacy", async ({ page }) => {
  // The org owner in the demo seed holds no platform grant at all.
  await otpLogin(page, "9999000002");
  const response = await page.goto("/admin/erasure");
  expect(response?.status()).toBe(404);
});
