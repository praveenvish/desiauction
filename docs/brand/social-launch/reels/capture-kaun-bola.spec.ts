import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { latestOtp } from "./otp";

/*
 * SOCIAL CAPTURE — reel 08, "Kaun bola pehle?" (series "Kagaz wali boli" 1/6).
 * Not a test; it lives here, never in e2e/. Two owners press Raise at the same
 * instant on the same amount: the server accepts one, the other phone is told
 * "Someone has already bid that much or more.", and the big screen shows one
 * leader. Fictional club, teams and first-name-only players. Real screens only.
 *
 *   cp docs/brand/social-launch/reels/capture-kaun-bola.spec.ts apps/web/e2e/zz-capture.spec.ts
 *   (cd apps/web && OUT=<abs>/reels/.work/kaun-bola npx playwright test e2e/zz-capture.spec.ts --project=chromium --retries=0)
 *   rm apps/web/e2e/zz-capture.spec.ts
 */

const OUT = process.env["OUT"] ?? "/tmp/kaun-bola-capture";
const STAMP = String(Date.now()).slice(-8);
const COLD = { timeout: 30_000 } as const;
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const REFUSED = "Someone has already bid that much or more.";
const TEAMS = ["Sunday Strikers", "Gully Giants"];
const PLAYERS = ["Arjun", "Kabir", "Rehan", "Vikram", "Sahil", "Dev"];

async function shot(page: Page, name: string, wait = 450): Promise<void> {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

async function otpLogin(page: Page, phone: string, name: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", COLD);
  await page.getByLabel("6-digit code").clear();
  await page.getByLabel("6-digit code").pressSequentially(await latestOtp(phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/, COLD);
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill(name);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
}

async function hydrated(page: Page): Promise<void> {
  await expect(page.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", COLD);
}
async function inRoom(page: Page): Promise<void> {
  await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", COLD);
}

test("capture: kaun bola pehle (reel 08)", async ({ browser }) => {
  test.setTimeout(900_000);
  mkdirSync(OUT, { recursive: true });
  const organizerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const organizer = await organizerCtx.newPage();
  await otpLogin(organizer, `84${STAMP}`, "Demo Organiser");

  await organizer.goto("/orgs");
  await organizer.getByTestId("new-org").click();
  await organizer.getByLabel("Club name").filter({ visible: true }).fill("Sunday League");
  await organizer.getByRole("button", { name: "Create club" }).click();
  await expect(organizer.getByTestId("org-name")).toBeVisible();

  // --- A season with two teams and six players --------------------------------
  await organizer.goto("/seasons");
  await organizer.getByTestId("new-season").click();
  await organizer.getByLabel("Season name").filter({ visible: true }).fill("Sunday Cup");
  await organizer.getByLabel("Location").fill("Pune");
  await organizer.getByLabel("Starts on").fill("2026-11-01");
  await organizer.getByLabel("Ends on").fill("2026-11-15");
  await organizer.getByRole("button", { name: "Create season" }).click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("draft");
  const seasonUrl = organizer.url();
  const slug = new URL(seasonUrl).pathname.split("/")[2] ?? "";

  await organizer.goto(`${seasonUrl}/teams`);
  for (const team of TEAMS) {
    await organizer.getByTestId("open-add-team").click();
    await organizer.getByLabel("Team name").filter({ visible: true }).fill(team);
    await organizer.getByTestId("add-team-workspace").click();
    await expect(organizer.getByTestId("teams-list")).toContainText(team);
  }
  await organizer.goto(seasonUrl);
  await organizer.getByTestId("advance-status").click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("setup");
  await organizer.getByTestId("advance-status").click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("registration open");

  await organizer.goto(`${seasonUrl}/registrations`);
  await expect(organizer.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", COLD);
  await organizer.getByTestId("open-import").click();
  const rows = ["name,phone,role,base_price_band"];
  PLAYERS.forEach((name, i) => rows.push(`${name},9${STAMP}${String(i)},batter,C`));
  await organizer.getByTestId("import-textarea").evaluate((el, csv) => {
    (el as HTMLTextAreaElement).value = csv;
  }, rows.join("\n"));
  await organizer.getByTestId("import-preview-btn").click();
  await expect(organizer.getByTestId("import-preview")).toContainText(`${PLAYERS.length} valid`, COLD);
  await organizer.getByTestId("import-commit").click();
  await organizer.getByLabel("Select all on page").check();
  await organizer.getByTestId("bulk-approve").click();
  await expect(organizer.getByTestId("stat-approved")).toContainText(String(PLAYERS.length));

  await organizer.goto(`/seasons/${slug}/auction`);
  await hydrated(organizer);
  await organizer.getByTestId("setup-close-registration").click();
  await expect(organizer.getByTestId("check-intake_closed")).toHaveAttribute("data-pass", "true", COLD);
  await organizer.getByTestId("accept-short-squads").check();
  await organizer.getByTestId("create-auction").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("scheduled", COLD);

  // --- Two owners: invite → accept → grant → claim ----------------------------
  await organizer.getByTestId("invite-all-owners").click();
  const linkCells = organizer.locator('[data-testid^="owner-link-"]');
  await expect(linkCells).toHaveCount(TEAMS.length, COLD);
  const links = (await linkCells.allTextContents()).map((text) => text.trim());
  const teamOrder = await organizer
    .locator('[data-testid^="owner-row-"]')
    .evaluateAll((all) =>
      all
        .filter((row) => row.querySelector('[data-testid^="owner-link-"]') !== null)
        .map((row) => row.querySelector(".as-owner-team")?.textContent ?? ""),
    );
  const owners: { ctx: BrowserContext; page: Page; team: string }[] = [];
  for (let i = 0; i < TEAMS.length; i += 1) {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    await otpLogin(page, `83${STAMP.slice(0, 6)}${String(i)}1`, `Owner ${String(i + 1)}`);
    await page.goto(links[i] ?? "");
    await page.getByTestId("accept-owner-invite").click();
    await inRoom(page);
    owners.push({ ctx, page, team: teamOrder[i] ?? "" });
  }
  await organizer.reload();
  await hydrated(organizer);
  const grants = organizer.locator('[data-testid^="grant-"]');
  await expect(grants).toHaveCount(TEAMS.length, COLD);
  for (let i = 0; i < TEAMS.length; i += 1) {
    await grants.first().click();
    await expect(grants).toHaveCount(TEAMS.length - i - 1, COLD);
  }
  for (const { page, team } of owners) {
    await page.goto(`/seasons/${slug}/auction/live`);
    await inRoom(page);
    await page.getByLabel("Team", { exact: true }).selectOption({ label: team });
    await page.getByTestId("claim-paddle").click();
    await expect(page.getByTestId("my-paddle")).toBeVisible(COLD);
  }

  // --- Open the night ----------------------------------------------------------
  await organizer.goto(`/seasons/${slug}/auction`);
  await hydrated(organizer);
  await organizer.getByTestId("setup-step-open-lots").click();
  await organizer.getByTestId("setup-body-lots").getByTestId("queue-all").click();
  await expect(organizer.getByTestId("lot-L001")).toContainText("queued", COLD);
  await organizer.getByTestId("accept-short-open").check();
  await organizer.getByTestId("auction-open").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("live", COLD);
  await organizer.goto(`/seasons/${slug}/auction/live`);
  await inRoom(organizer);
  await expect(organizer.getByTestId("connection-state")).toHaveText("Connected", COLD);

  // The hall's big screen: the public stage, landscape.
  const screenCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await screenCtx.addCookies(await organizerCtx.cookies());
  const screen = await screenCtx.newPage();
  await screen.goto(`/seasons/${slug}/auction/spectate`);
  await expect(screen.getByTestId("spectate-panel")).toBeVisible(COLD);

  // --- The race: both phones press Raise on the same amount at once ------------
  const [phoneA, phoneB] = owners.map((o) => o.page) as [Page, Page];
  await organizer.screenshot({ path: `${OUT}/debug-organizer.png` });
  let refused: Page | null = null;
  let winner: Page | null = null;
  for (let attempt = 0; attempt < 4 && refused === null; attempt += 1) {
    // The first press can land while the dev server is still compiling the
    // action: press again until the organiser's own room shows the lot.
    await expect(async () => {
      await organizer.getByTestId("conduct-open-lot").click({ timeout: 5000 });
      await expect(organizer.getByTestId("current-lot")).toBeVisible({ timeout: 15_000 });
    }).toPass({ timeout: 120_000 });
    for (const page of [phoneA, phoneB]) {
      await expect(page.getByTestId("current-lot")).toBeVisible(COLD);
      await expect(page.getByTestId("bid-next")).toBeEnabled(COLD);
    }
    await expect(screen.getByTestId("spectate-lot")).toBeVisible(COLD);
    await phoneA.waitForTimeout(600);
    await shot(phoneA, `a${attempt}-before`, 0);
    await shot(phoneB, `b${attempt}-before`, 0);
    await shot(screen, `tv${attempt}-before`, 0);
    await Promise.all([phoneA.getByTestId("bid-next").click(), phoneB.getByTestId("bid-next").click()]);
    const seen = await Promise.race([
      phoneA.getByText(REFUSED).waitFor({ timeout: 8000 }).then(() => "A"),
      phoneB.getByText(REFUSED).waitFor({ timeout: 8000 }).then(() => "B"),
    ]).catch(() => null);
    if (seen !== null) {
      refused = seen === "A" ? phoneA : phoneB;
      winner = seen === "A" ? phoneB : phoneA;
      await shot(refused, "refused", 150);
      await shot(winner, "leading", 0);
      await shot(screen, "tv-leading", 900);
      await organizer.getByTestId("conduct-close-lot").hover();
      await organizer.mouse.down();
      await organizer.waitForTimeout(900);
      await organizer.mouse.up();
      await expect(organizer.getByTestId("ceremony")).toBeVisible(COLD);
      await shot(screen, "tv-sold", 1200);
      await shot(winner, "winner-sold", 0);
      await shot(refused, "refused-sold", 0);
      // Keep the attempt's "before" frames under fixed names for the build.
      copyFileSync(`${OUT}/a${attempt}-before.png`, `${OUT}/phoneA-before.png`);
      copyFileSync(`${OUT}/b${attempt}-before.png`, `${OUT}/phoneB-before.png`);
      copyFileSync(`${OUT}/tv${attempt}-before.png`, `${OUT}/tv-before.png`);
      writeFileSync(`${OUT}/who.txt`, seen === "A" ? "refused=A" : "refused=B");
    } else {
      // Both landed (one saw the other's bid first): close this lot and go again.
      await organizer.getByTestId("conduct-close-lot").hover();
      await organizer.mouse.down();
      await organizer.waitForTimeout(900);
      await organizer.mouse.up();
      await expect(organizer.getByTestId("ceremony")).toBeVisible(COLD);
      await organizer.waitForTimeout(2500);
    }
  }
  expect(refused, "no simultaneous press was refused in 4 lots").not.toBeNull();

  for (const { ctx } of owners) {
    await ctx.close();
  }
  await screenCtx.close();
  await organizerCtx.close();
});
