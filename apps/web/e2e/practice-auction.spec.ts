import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { latestOtp } from "./otp";

/*
 * THE PRACTICE AUCTION, END TO END (0101).
 *
 * Before the night the organiser runs a short practice in the same season:
 * the owners use their usual link, land in the practice, bid in points, can
 * step out to the real auction's waiting room and back, and nothing they do
 * touches the season. Opening the real auction ends the practice, and every
 * phone in it moves to the night by itself.
 */

const STAMP = String(Date.now()).slice(-8);
const COLD = { timeout: 30_000 } as const;
/** The practice bar polls every 5 s; allow a few rounds. */
const MOVE = { timeout: 25_000 } as const;

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

test("a practice runs in the season's own room, touches nothing, and hands over to the night", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const organizerCtx = await browser.newContext();
  const organizer = await organizerCtx.newPage();
  await otpLogin(organizer, `85${STAMP}`, "Practice Organiser");

  await organizer.goto("/orgs");
  await organizer.getByTestId("new-org").click();
  await organizer.getByLabel("Club name").filter({ visible: true }).fill(`Practice Org ${STAMP}`);
  await organizer.getByRole("button", { name: "Create club" }).click();
  await expect(organizer.getByTestId("org-name")).toBeVisible();

  // --- A rupee season with three teams and eight players --------------------
  await organizer.goto("/seasons");
  await organizer.getByTestId("new-season").click();
  await organizer.getByLabel("Season name").filter({ visible: true }).fill(`Practice Cup ${STAMP}`);
  await organizer.getByLabel("Location").fill("Pune");
  await organizer.getByLabel("Starts on").fill("2026-11-01");
  await organizer.getByLabel("Ends on").fill("2026-11-15");
  await organizer.getByRole("button", { name: "Create season" }).click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("draft");
  const seasonUrl = organizer.url();
  const slug = new URL(seasonUrl).pathname.split("/")[2] ?? "";

  const teamNames = ["Pune Panthers", "Kothrud Kings", "Baner Bulls"];
  await organizer.goto(`${seasonUrl}/teams`);
  for (const team of teamNames) {
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
  for (let i = 1; i <= 8; i += 1) {
    rows.push(`Practice Player ${String(i)},9${STAMP}${String(i)},batter,C`);
  }
  await organizer.getByTestId("import-textarea").evaluate((el, csv) => {
    (el as HTMLTextAreaElement).value = csv;
  }, rows.join("\n"));
  await organizer.getByTestId("import-preview-btn").click();
  await expect(organizer.getByTestId("import-preview")).toContainText("8 valid", COLD);
  await organizer.getByTestId("import-commit").click();
  await organizer.getByLabel("Select all on page").check();
  await organizer.getByTestId("bulk-approve").click();
  await expect(organizer.getByTestId("stat-approved")).toContainText("8");

  await organizer.goto(`/seasons/${slug}/auction`);
  await hydrated(organizer);
  await organizer.getByTestId("setup-close-registration").click();
  await expect(organizer.getByTestId("check-intake_closed")).toHaveAttribute(
    "data-pass",
    "true",
    COLD,
  );
  await organizer.getByTestId("accept-short-squads").check();
  await organizer.getByTestId("create-auction").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("scheduled", COLD);

  // --- Two owners join the real auction; the third team has none -------------
  await organizer.getByTestId("invite-all-owners").click();
  const linkCells = organizer.locator('[data-testid^="owner-link-"]');
  await expect(linkCells).toHaveCount(3, COLD);
  const links = (await linkCells.allTextContents()).map((text) => text.trim());
  const teamOrder = await organizer
    .locator('[data-testid^="owner-row-"]')
    .evaluateAll((all) =>
      all
        .filter((row) => row.querySelector('[data-testid^="owner-link-"]') !== null)
        .map((row) => row.querySelector(".as-owner-team")?.textContent ?? ""),
    );
  const owners: { ctx: BrowserContext; page: Page; team: string }[] = [];
  for (let i = 0; i < 2; i += 1) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await otpLogin(page, `86${STAMP.slice(0, 6)}${String(i)}1`, `Owner ${String(i + 1)}`);
    await page.goto(links[i] ?? "");
    await page.getByTestId("accept-owner-invite").click();
    await inRoom(page);
    owners.push({ ctx, page, team: teamOrder[i] ?? "" });
  }
  const ownerless = teamNames.find((team) => !owners.some((owner) => owner.team === team)) ?? "";

  // --- The practice: one choice, the sum, Start -------------------------------
  await organizer.reload();
  await hydrated(organizer);
  const card = organizer.getByTestId("practice-card");
  await expect(card).toBeVisible(COLD);
  await card.getByTestId("practice-size-2").click();
  await expect(card.getByTestId("practice-sum")).toContainText("3 teams × 2 + 2 extra = 8 players");
  await card.getByTestId("practice-start").click();
  await expect(card.getByTestId("practice-running")).toBeVisible(COLD);
  await expect(card.getByTestId("practice-status")).toContainText("8 players · 2 per team");
  const teamList = card.getByTestId("practice-teams");
  await expect(teamList.locator("li", { hasText: ownerless })).toContainText(
    "You bid for this team",
  );
  for (const { team } of owners) {
    await expect(teamList.locator("li", { hasText: team })).toContainText("Not bidding yet");
  }

  // --- Owners: the usual link lands in the practice, which they pick up ------
  for (const { page, team } of owners) {
    await page.goto(`/seasons/${slug}/auction/live`);
    await inRoom(page);
    await expect(page.getByTestId("practice-bar")).toHaveAttribute("data-room", "practice");
    await page.getByLabel("Team", { exact: true }).selectOption({ label: team });
    await page.getByTestId("claim-paddle").click();
    await expect(page.getByTestId("my-paddle")).toBeVisible(COLD);
  }
  await organizer.reload();
  await hydrated(organizer);
  for (const { team } of owners) {
    await expect(teamList.locator("li", { hasText: team })).toContainText("Ready to bid");
  }

  // --- The room bids in POINTS, though the season counts in rupees -----------
  await organizer.getByTestId("practice-cockpit").click();
  await expect(organizer).toHaveURL(/\/auction\/cockpit/, COLD);
  await expect(organizer.getByTestId("practice-bar")).toHaveAttribute(
    "data-room",
    "practice",
    COLD,
  );
  await organizer.getByTestId("cockpit-open-auction").click();
  await organizer.goto(`/seasons/${slug}/auction/live`);
  await inRoom(organizer);
  await expect(organizer.getByTestId("connection-state")).toHaveText("Connected", {
    timeout: 20_000,
  });
  await organizer.getByTestId("conduct-open-lot").click();
  const [bidderA, bidderB] = owners.map((owner) => owner.page) as [Page, Page];
  for (const page of [bidderA, bidderB]) {
    await expect(page.getByTestId("current-lot")).toBeVisible({ timeout: 20_000 });
  }
  await expect(bidderA.getByTestId("bid-next")).toContainText("pts", COLD);
  await bidderA.getByTestId("bid-next").click();
  await expect(organizer.getByTestId("leading-team")).toContainText(owners[0]?.team ?? "", {
    timeout: 20_000,
  });
  await bidderB.getByTestId("bid-next").click();
  await expect(organizer.getByTestId("leading-team")).toContainText(owners[1]?.team ?? "", {
    timeout: 20_000,
  });
  for (const page of [organizer, bidderA, bidderB]) {
    await expect(page.locator("main")).not.toContainText("₹");
  }
  await organizer.getByTestId("conduct-close-lot").hover();
  await organizer.mouse.down();
  await organizer.waitForTimeout(900);
  await organizer.mouse.up();
  await expect(organizer.getByTestId("ceremony")).toBeVisible({ timeout: 20_000 });

  // --- Nothing reached the season: no squad, no sale -------------------------
  await organizer.goto(`${seasonUrl}/teams`);
  await expect(organizer.locator("main")).not.toContainText("pts");
  await expect(organizer.locator("main")).not.toContainText("Practice Player 1");

  // --- An owner steps out to the real waiting room and back ------------------
  await bidderA.getByTestId("room-real").click();
  await expect(bidderA.getByTestId("practice-bar")).toHaveAttribute("data-room", "real", COLD);
  await bidderA.getByTestId("room-practice").click();
  await expect(bidderA.getByTestId("practice-bar")).toHaveAttribute("data-room", "practice", COLD);

  // --- Run again: a fresh practice, and the owners' screens follow -----------
  await organizer.goto(`/seasons/${slug}/auction`);
  await hydrated(organizer);
  await card.getByTestId("practice-again").click();
  await organizer.getByTestId("confirm-practice-again").click();
  await expect(organizer.getByText("A fresh practice is ready")).toBeVisible(COLD);
  for (const { team } of owners) {
    await expect(teamList.locator("li", { hasText: team })).toContainText("Not bidding yet");
  }
  await expect(bidderB.getByTestId("current-lot")).toHaveCount(0, MOVE);

  // --- The night opens: the practice ends and every phone moves --------------
  for (const team of [ownerless, owners[0]?.team ?? ""]) {
    await organizer.getByLabel("Issue a paddle to yourself for").selectOption({ label: team });
    await organizer.getByTestId("issue-paddle").click();
    await expect(organizer.getByText("Paddle issued").first()).toBeVisible(COLD);
  }
  await organizer.getByTestId("queue-all").click();
  await expect(organizer.getByTestId("lot-L001")).toContainText("queued", COLD);
  await organizer.getByTestId("accept-short-open").check();
  await organizer.getByTestId("auction-open").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("live", COLD);
  await expect(organizer.getByTestId("practice-card")).toHaveCount(0);
  for (const page of [bidderA, bidderB]) {
    await expect(page.getByTestId("practice-bar")).toHaveCount(0, MOVE);
  }
  await expect(
    bidderB.getByText("The practice is over — the real auction has started"),
  ).toBeVisible(COLD);

  for (const { ctx } of owners) {
    await ctx.close();
  }
  await organizerCtx.close();
});
