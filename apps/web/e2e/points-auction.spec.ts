import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { completeAuction, leaveCockpit } from "./complete-auction";
import { latestOtp } from "./otp";

/*
 * A POINTS SEASON, END TO END (0091) — created in points, set up in points,
 * bid in points, and finished without a rupee or a debt anywhere: no "₹" in
 * the room, no settlement to open, and the unit fixed once the auction exists.
 */

const STAMP = String(Date.now()).slice(-8);
const COLD = { timeout: 30_000 } as const;

async function otpLogin(page: Page, phone: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", COLD);
  await page.getByLabel("6-digit code").fill(await latestOtp(phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/, COLD);
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill("Points Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
}

async function hydrated(page: Page): Promise<void> {
  await expect(page.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", COLD);
}

async function holdCloseLot(page: Page): Promise<void> {
  await page.getByTestId("conduct-close-lot").hover();
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
}

/** No rupee sign anywhere a person can read on this page. */
async function noRupees(page: Page): Promise<void> {
  await expect(page.locator("main")).not.toContainText("₹");
}

test("a points season runs the whole night in points and owes nothing", async ({ browser }) => {
  test.setTimeout(240_000);
  const organizerCtx = await browser.newContext();
  const organizer = await organizerCtx.newPage();
  await otpLogin(organizer, `83${STAMP}`);

  await organizer.goto("/orgs");
  await organizer.getByTestId("new-org").click();
  await organizer
    .getByLabel("Organization name")
    .filter({ visible: true })
    .fill(`Points Org ${STAMP}`);
  await organizer.getByRole("button", { name: "Create organization" }).click();
  await expect(organizer.getByTestId("org-name")).toBeVisible();

  // --- The season is created in points -------------------------------------
  await organizer.goto("/seasons");
  await organizer.getByTestId("new-season").click();
  await organizer.getByLabel("Season name").filter({ visible: true }).fill(`Points Cup ${STAMP}`);
  await organizer.getByLabel("Auction currency").filter({ visible: true }).selectOption("points");
  await organizer.getByLabel("Location").fill("Thane");
  await organizer.getByLabel("Starts on").fill("2026-11-01");
  await organizer.getByLabel("Ends on").fill("2026-11-15");
  await organizer.getByRole("button", { name: "Create season" }).click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("draft");
  const seasonUrl = organizer.url();
  const slug = new URL(seasonUrl).pathname.split("/")[2] ?? "";

  await organizer.goto(`${seasonUrl}/teams`);
  for (const team of ["Thane Titans", "Vashi Vipers"]) {
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
  await organizer.getByTestId("import-textarea").evaluate(
    (el, csv) => {
      (el as HTMLTextAreaElement).value = csv;
    },
    [
      "name,phone,role,base_price_band",
      `Points One,9${STAMP}3,batter,C`,
      `Points Two,9${STAMP}4,bowler,C`,
    ].join("\n"),
  );
  await organizer.getByTestId("import-preview-btn").click();
  await expect(organizer.getByTestId("import-preview")).toContainText("2 valid", COLD);
  await organizer.getByTestId("import-commit").click();
  await organizer.getByLabel("Select all on page").check();
  await organizer.getByTestId("bulk-approve").click();
  await expect(organizer.getByTestId("stat-approved")).toContainText("2");

  // --- The rules are asked for, and read back, in points ---------------------
  await organizer.goto(`/seasons/${slug}/auction`);
  await hydrated(organizer);
  await organizer.getByTestId("setup-close-registration").click();
  await expect(organizer.getByTestId("check-intake_closed")).toContainText("pass", COLD);
  const purse = organizer.getByLabel("Purse per team (points)");
  await expect(purse).toHaveValue("1000");
  await expect(organizer.getByTestId("auction-setup")).toContainText("1,000 pts");
  await expect(organizer.getByTestId("auction-setup")).not.toContainText("₹");
  await organizer.getByTestId("accept-short-squads").check();
  await organizer.getByTestId("create-auction").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("scheduled", COLD);

  // --- The unit is fixed now that the auction exists -------------------------
  await organizer.goto(seasonUrl);
  await organizer.getByTestId("open-season-settings").click();
  const unit = organizer.getByRole("dialog").getByLabel("Auction currency");
  await expect(unit).toHaveValue("points");
  await expect(unit).toBeDisabled();
  await organizer.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  // --- Owners join a purse of points, and are told nothing is owed -----------
  await organizer.goto(`/seasons/${slug}/auction`);
  await hydrated(organizer);
  await organizer.getByTestId("invite-all-owners").click();
  const linkCells = organizer.locator('[data-testid^="owner-link-"]');
  await expect(linkCells).toHaveCount(2, COLD);
  const links = (await linkCells.allTextContents()).map((text) => text.trim());
  const teamOrder = await organizer
    .locator('[data-testid^="owner-row-"]')
    .evaluateAll((rows) =>
      rows
        .filter((row) => row.querySelector('[data-testid^="owner-link-"]') !== null)
        .map((row) => row.querySelector(".as-owner-team")?.textContent ?? ""),
    );

  const owners: { ctx: BrowserContext; page: Page; team: string }[] = [];
  for (let i = 0; i < 2; i += 1) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await otpLogin(page, `84${STAMP.slice(0, 6)}${String(i)}1`);
    await page.goto(links[i] ?? "");
    await expect(page.getByTestId("owner-join-purse")).toContainText("1,000 pts");
    await expect(page.getByTestId("owner-join-purse")).toContainText("nothing is owed");
    await page.getByTestId("accept-owner-invite").click();
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", COLD);
    owners.push({ ctx, page, team: teamOrder[i] ?? "" });
  }

  await organizer.reload();
  await hydrated(organizer);
  for (const { team } of owners) {
    const row = organizer.locator(".as-owner", { hasText: team });
    await expect(row).toContainText("Accepted");
    await row.getByRole("button", { name: "Grant paddle" }).click();
    await expect(row).toContainText("Waiting for them to claim", COLD);
  }
  for (const { page, team } of owners) {
    await page.goto(`/seasons/${slug}/auction/live`);
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", COLD);
    await page.getByLabel("Team", { exact: true }).selectOption({ label: team });
    await page.getByTestId("claim-paddle").click();
    await expect(page.getByTestId("my-paddle")).toBeVisible(COLD);
  }

  await organizer.reload();
  await hydrated(organizer);
  await organizer.getByTestId("queue-all").click();
  await expect(organizer.getByTestId("lot-L001")).toContainText("queued", COLD);
  await organizer.getByTestId("accept-short-open").check();
  await organizer.getByTestId("auction-open").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("live", COLD);

  // --- The room bids in points ------------------------------------------------
  await organizer.getByTestId("open-live").click();
  await expect(organizer.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", COLD);
  await expect(organizer.getByTestId("connection-state")).toHaveText("open", { timeout: 20_000 });
  await organizer.getByTestId("conduct-open-lot").click();
  const [bidderA, bidderB] = owners.map((owner) => owner.page) as [Page, Page];
  for (const page of [organizer, bidderA, bidderB]) {
    await expect(page.getByTestId("current-lot")).toBeVisible({ timeout: 20_000 });
  }
  // The raise button carries its own amount — in points.
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
    // Base 10, +5: the second bid is 15 points.
    await expect(page.getByTestId("leading-bid")).toContainText("15 pts", { timeout: 20_000 });
    await noRupees(page);
  }
  await holdCloseLot(organizer);
  await expect(organizer.getByTestId("ceremony")).toBeVisible({ timeout: 20_000 });
  await expect(organizer.getByTestId("purse-board")).toContainText("pts");
  await noRupees(organizer);

  // --- Close the night; nothing to settle ----------------------------------------
  await organizer.goto(`/seasons/${slug}/auction/cockpit`);
  await completeAuction(organizer, "cockpit-complete");
  await leaveCockpit(organizer, slug);

  await organizer.goto(seasonUrl);
  await expect(organizer.getByTestId("season-completed")).toContainText(
    "played for points, so there is nothing to settle",
    COLD,
  );
  await expect(organizer.getByRole("link", { name: "Open settlement" })).toHaveCount(0);
  await expect(organizer.getByRole("link", { name: "Money", exact: true })).toHaveCount(0);

  // No door to the books: this organizer holds no money authority (the
  // capability partition), so the address is absent as it is on any season —
  // and nothing on it could open a case. A holder of the grant is told why
  // instead (`points-no-settlement`); the server refuses every command either way.
  await organizer.goto(`/seasons/${slug}/money`);
  await expect(
    organizer
      .getByTestId("points-no-settlement")
      .or(organizer.getByRole("heading", { name: "This page doesn't exist" })),
  ).toBeVisible(COLD);
  await expect(organizer.getByTestId("open-case")).toHaveCount(0);

  await organizer.goto(`${seasonUrl}/teams`);
  await expect(organizer.locator("main")).toContainText("15 pts", COLD);
  await noRupees(organizer);

  for (const { ctx } of owners) {
    await ctx.close();
  }
  await organizerCtx.close();
});
