import { mkdirSync } from "node:fs";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { latestOtp } from "./otp";

/*
 * SOCIAL CAPTURE — reel 09, "Bhai, kitne point bache?" (series "Kagaz wali boli" 2/6).
 * Not a test; it lives here, never in e2e/. A POINTS season (as paper auctions
 * run): three owners bid on their phones, four players are sold, and the big
 * screen's board shows every team's points left and squad after each SOLD;
 * an owner's phone shows their own purse. Fictional club, teams and
 * first-name-only players. Real screens only.
 *
 *   cp docs/brand/social-launch/reels/capture-kitne-point.spec.ts apps/web/e2e/zz-capture.spec.ts
 *   (cd apps/web && OUT=<abs>/reels/.work/kitne-point PLAYWRIGHT_PRECOMPILED=1 NEXT_DIST_DIR=.next-e2e \
 *     npx playwright test e2e/zz-capture.spec.ts --project=chromium --retries=0)
 *   rm apps/web/e2e/zz-capture.spec.ts
 *   (needs a build: NEXT_DIST_DIR=.next-e2e node --env-file-if-exists=../../.env.local node_modules/next/dist/bin/next build)
 */

const OUT = process.env["OUT"] ?? "/tmp/kitne-point-capture";
const STAMP = String(Date.now()).slice(-8);
const COLD = { timeout: 30_000 } as const;
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const TEAMS = ["Sunday Strikers", "Gully Giants", "Box Blasters"];
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

test("capture: kitne point bache (reel 09)", async ({ browser }) => {
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
  await organizer.getByLabel("Auction currency").filter({ visible: true }).selectOption("points");
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

  // The hall's big screen: the board (purses + squads), landscape.
  const screenCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await screenCtx.addCookies(await organizerCtx.cookies());
  const screen = await screenCtx.newPage();
  await screen.goto(`/seasons/${slug}/auction/board`);
  await expect(screen.getByTestId("board")).toBeVisible(COLD);
  await shot(screen, "board-0", 1200);

  // Four players, each a short bidding war; the last bidder wins.
  const byTeam = new Map(owners.map((o) => [o.team, o.page]));
  const [a, b, c] = TEAMS.map((t) => byTeam.get(t)) as [Page, Page, Page];
  const LOTS: Page[][] = [
    [a, b, a, b, a, b, a],
    [b, c, b, c, b],
    [c, a, c, b, c, a, c, b, c],
    [a, c, a],
  ];
  for (const [n, bidders] of LOTS.entries()) {
    await expect(async () => {
      await organizer.getByTestId("conduct-open-lot").click({ timeout: 5000 });
      await expect(organizer.getByTestId("current-lot")).toBeVisible({ timeout: 15_000 });
    }).toPass({ timeout: 120_000 });
    for (const page of [a, b, c]) {
      await expect(page.getByTestId("current-lot")).toBeVisible(COLD);
    }
    for (const page of bidders) {
      const team = owners.find((o) => o.page === page)?.team ?? "";
      await expect(page.getByTestId("bid-next")).toBeEnabled(COLD);
      await page.getByTestId("bid-next").click();
      await expect(organizer.getByTestId("leading-team")).toContainText(team, COLD);
    }
    await shot(screen, `board-${String(n + 1)}-live`, 900);
    await organizer.getByTestId("conduct-close-lot").hover();
    await organizer.mouse.down();
    await organizer.waitForTimeout(900);
    await organizer.mouse.up();
    await expect(organizer.getByTestId("ceremony")).toBeVisible(COLD);
    await shot(screen, `board-${String(n + 1)}-sold`, 1500);
    await organizer.waitForTimeout(2500);
  }
  await shot(screen, "board-final", 1500);
  // An owner's own purse, on their phone.
  for (const [i, o] of owners.entries()) {
    await o.page.reload();
    await inRoom(o.page);
    await shot(o.page, `phone-${String(i)}`, 800);
    const mine = o.page.getByRole("region", { name: o.team });
    if (await mine.count()) {
      await mine.first().scrollIntoViewIfNeeded();
      await o.page.waitForTimeout(500);
      await mine.first().screenshot({ path: `${OUT}/purse-${String(i)}.png` });
      await shot(o.page, `phone-${String(i)}-purse`, 0);
    }
  }

  for (const { ctx } of owners) {
    await ctx.close();
  }
  await screenCtx.close();
  await organizerCtx.close();
});
