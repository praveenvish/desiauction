import { mkdirSync } from "node:fs";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { latestOtp } from "./otp";

/*
 * SOCIAL CAPTURE — reel 10, "Bolna kisi ne?" (series "Kagaz wali boli" 3/6).
 * Not a test; it lives here, never in e2e/. A POINTS season: two owners bid a
 * short war, then nobody bids again — and nobody has to ask. The big screen's
 * clock counts down, the owners' phones say "Closing soon", and at zero the
 * ENGINE closes the lot itself (engine-core.ts `tick` → _TimerClose: sold to
 * the leading bid). The organiser never presses the gavel in this capture.
 * Fictional club, teams and first-name-only players. Real screens only.
 *
 *   cp docs/brand/social-launch/reels/capture-bolna.spec.ts apps/web/e2e/zz-capture.spec.ts
 *   (cd apps/web && OUT=<abs>/reels/.work/bolna PLAYWRIGHT_PRECOMPILED=1 NEXT_DIST_DIR=.next-e2e \
 *     npx playwright test e2e/zz-capture.spec.ts --project=chromium --retries=0)
 *   rm apps/web/e2e/zz-capture.spec.ts
 */

const OUT = process.env["OUT"] ?? "/tmp/bolna-capture";
const STAMP = String(Date.now()).slice(-8);
const COLD = { timeout: 30_000 } as const;
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
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

test("capture: bolna kisi ne (reel 10)", async ({ browser }) => {
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

  // Two big screens: the board (the clock, large) and the public stage (the SOLD ceremony).
  const screenCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await screenCtx.addCookies(await organizerCtx.cookies());
  const board = await screenCtx.newPage();
  await board.goto(`/seasons/${slug}/auction/board`);
  await expect(board.getByTestId("board")).toBeVisible(COLD);
  const stage = await screenCtx.newPage();
  await stage.goto(`/seasons/${slug}/auction/spectate`);
  await expect(stage.getByTestId("spectate-panel")).toBeVisible(COLD);

  const byTeam = new Map(owners.map((o) => [o.team, o.page]));
  const [a, b] = TEAMS.map((t) => byTeam.get(t)) as [Page, Page];
  await expect(async () => {
    await organizer.getByTestId("conduct-open-lot").click({ timeout: 5000 });
    await expect(organizer.getByTestId("current-lot")).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 120_000 });
  for (const page of [a, b]) {
    await expect(page.getByTestId("current-lot")).toBeVisible(COLD);
  }
  for (const page of [a, b, a]) {
    const team = owners.find((o) => o.page === page)?.team ?? "";
    await expect(page.getByTestId("bid-next")).toBeEnabled(COLD);
    await page.getByTestId("bid-next").click();
    await expect(organizer.getByTestId("leading-team")).toContainText(team, COLD);
  }
  // Now nobody bids. Shoot the board's clock as it runs down, and the phones
  // once "Closing soon" shows. Nobody touches the gavel.
  const timer = board.getByTestId("board-block-timer");
  const want = new Set([20, 12, 9, 6, 5, 4, 3, 2, 1]);
  let phonesShot = false;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if ((await organizer.getByTestId("ceremony").count()) > 0) break;
    // The clock leaves the board at zero: never wait on it (textContent has no
    // timeout of its own and would hang the capture).
    const text = (await timer.count()) ? ((await timer.textContent({ timeout: 500 }).catch(() => "")) ?? "") : "";
    const secs = Number.parseInt(text.replace(/\D/g, ""), 10);
    if (Number.isFinite(secs) && want.has(secs)) {
      want.delete(secs);
      await board.screenshot({ path: `${OUT}/board-t${String(secs).padStart(2, "0")}.png` });
      if (secs <= 6 && !phonesShot && (await a.getByTestId("closing-soon").count())) {
        phonesShot = true;
        await a.screenshot({ path: `${OUT}/phoneA-closing.png` });
        await b.screenshot({ path: `${OUT}/phoneB-closing.png` });
      }
    }
    await board.waitForTimeout(120);
  }
  // The engine closed it — on every screen.
  await expect(organizer.getByTestId("ceremony")).toBeVisible(COLD);
  await shot(stage, "stage-sold", 1200);
  await shot(board, "board-sold", 0);
  await shot(a, "phoneA-sold", 0);
  await shot(b, "phoneB-sold", 0);

  for (const { ctx } of owners) {
    await ctx.close();
  }
  await screenCtx.close();
  await organizerCtx.close();
});
