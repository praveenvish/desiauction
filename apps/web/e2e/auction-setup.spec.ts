import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { latestOtp } from "./otp";

/*
 * AUCTION SETUP, ONE PAGE — the guided path from "players approved" to "room
 * open" without leaving /auction: close registration, set the rules, send each
 * team owner a link, grant the paddles the owners accept, queue the players,
 * open. The cockpit is never visited; that is the point.
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
    await page.getByLabel("What should we call you?").fill("Setup Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
}

async function hydrated(page: Page): Promise<void> {
  await expect(page.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", COLD);
}

test("auction setup walks the organizer from approved players to an open room on one page", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const organizerCtx = await browser.newContext();
  const organizer = await organizerCtx.newPage();
  await otpLogin(organizer, `81${STAMP}`);

  await organizer.goto("/orgs");
  await organizer.getByTestId("new-org").click();
  await organizer.getByLabel("Club name").filter({ visible: true }).fill(`Setup Org ${STAMP}`);
  await organizer.getByRole("button", { name: "Create club" }).click();
  await expect(organizer.getByTestId("org-name")).toBeVisible();

  await organizer.goto("/seasons");
  await organizer.getByTestId("new-season").click();
  await organizer.getByLabel("Season name").filter({ visible: true }).fill(`Setup Cup ${STAMP}`);
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
      `Setup One,9${STAMP}1,batter,C`,
      `Setup Two,9${STAMP}2,bowler,C`,
    ].join("\n"),
  );
  await organizer.getByTestId("import-preview-btn").click();
  await expect(organizer.getByTestId("import-preview")).toContainText("2 valid", COLD);
  await organizer.getByTestId("import-commit").click();
  await organizer.getByLabel("Select all on page").check();
  await organizer.getByTestId("bulk-approve").click();
  await expect(organizer.getByTestId("stat-approved")).toContainText("2");

  // --- Step 1: registration is still open; the page offers to close it -------
  await organizer.goto(`/seasons/${slug}/auction`);
  await hydrated(organizer);
  await expect(organizer.getByTestId("setup-step-players")).toHaveAttribute(
    "data-state",
    "current",
  );
  await organizer.getByTestId("setup-close-registration").click();
  await expect(organizer.getByTestId("check-intake_closed")).toHaveAttribute(
    "data-pass",
    "true",
    COLD,
  );
  await expect(organizer.getByTestId("setup-step-rules")).toHaveAttribute("data-state", "current");

  // --- Step 2: the rules, then the auction exists -----------------------------
  await organizer.getByTestId("accept-short-squads").check();
  await organizer.getByTestId("create-auction").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("scheduled", COLD);
  await expect(organizer.getByTestId("setup-step-owners")).toHaveAttribute("data-state", "current");

  await expect(async () => {
    const results = await new AxeBuilder({ page: organizer })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  }).toPass({ timeout: 10_000 });

  // --- Step 3: every team's link at once, from this page ----------------------
  await organizer.getByTestId("invite-all-owners").click();
  const linkCells = organizer.locator('[data-testid^="owner-link-"]');
  await expect(linkCells).toHaveCount(2, COLD);
  await organizer.screenshot({ path: test.info().outputPath("setup-owners.png"), fullPage: true });
  const links = (await linkCells.allTextContents()).map((text) => text.trim());
  expect(links.every((link) => link.includes("/owner-join/"))).toBe(true);
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
    await otpLogin(page, `82${STAMP.slice(0, 6)}${String(i)}1`);
    await page.goto(links[i] ?? "");
    await page.getByTestId("accept-owner-invite").click();
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", COLD);
    owners.push({ ctx, page, team: teamOrder[i] ?? "" });
  }

  // The organizer sees who accepted and grants the paddle, same page.
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
  await expect(organizer.getByTestId("setup-step-owners")).toHaveAttribute("data-state", "done");
  await organizer.screenshot({ path: test.info().outputPath("setup-ready.png"), fullPage: true });

  // --- Steps 4 and 5: queue, then open from the checklist ---------------------
  await expect(organizer.getByTestId("auction-open")).toBeDisabled();
  await organizer.getByTestId("queue-all").click();
  await expect(organizer.getByTestId("lot-L001")).toContainText("queued", COLD);
  await expect(organizer.getByTestId("auction-open-blockers")).toHaveCount(0);
  await expect(organizer.getByTestId("setup-step-live")).toHaveAttribute("data-state", "current");
  await organizer.getByTestId("accept-short-open").check();
  await organizer.getByTestId("auction-open").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("live", COLD);
  // Past setup, the page is the running auction's again.
  await expect(organizer.getByTestId("setup-flow")).toHaveCount(0);

  for (const { ctx } of owners) {
    await ctx.close();
  }
  await organizerCtx.close();
});
