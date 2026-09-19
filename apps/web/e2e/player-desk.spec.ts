import { readFile } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { latestOtp } from "./otp";

/*
 * THE PLAYER DESK — the founder's own first season, walked end to end.
 *
 * Teams, then players, then: review everyone without leaving the sheet, pick a
 * captain (who must then be OUT of the auction pool), correct a jersey number
 * in place, take a fee, name an icon from the team's own page, and export just
 * the columns a jersey vendor needs.
 */

const STAMP = String(Date.now()).slice(-8);
const PHONE_ORG = `83${STAMP}`;
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
    await page.getByLabel("What should we call you?").fill("Desk Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
}

function playersCsv(): string {
  const rows = Array.from({ length: 4 }, (_, i) => {
    const phone = `6${STAMP}${String(i)}`.slice(0, 10);
    return `Desk Player ${String(i)},${phone},batter,A`;
  });
  return ["name,phone,role,base_price_band", ...rows].join("\n");
}

test("the player desk: review in one pass, pre-sign, edit in place, export what you choose", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await otpLogin(page, PHONE_ORG);

  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`Desk Org ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();

  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Desk Cup ${STAMP}`);
  await page.getByLabel("Location").fill("Andheri");
  await page.getByLabel("Starts on").fill("2026-10-01");
  await page.getByLabel("Ends on").fill("2026-10-15");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-status")).toHaveText("draft");
  await page.getByTestId("advance-status").click();
  await expect(page.getByTestId("competition-status")).toHaveText("setup");
  await page.getByTestId("advance-status").click();
  await expect(page.getByTestId("competition-status")).toHaveText("registration open");
  const seasonUrl = page.url();

  // Two teams.
  await page.goto(`${seasonUrl}/teams`);
  for (const name of ["Andheri Arrows", "Bandra Blasters"]) {
    await page.getByTestId("open-add-team").click();
    await page.getByLabel("Team name").filter({ visible: true }).fill(name);
    await page.getByTestId("add-team-workspace").click();
    await expect(page.getByTestId("teams-list")).toContainText(name);
  }

  // Four players, by file.
  await page.goto(`${seasonUrl}/registrations`);
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", COLD);
  await page.getByTestId("open-import").click();
  await page.getByTestId("import-textarea").evaluate((el, csv) => {
    (el as HTMLTextAreaElement).value = csv;
  }, playersCsv());
  await page.getByTestId("import-preview-btn").click();
  await expect(page.getByTestId("import-preview")).toContainText("4 valid", COLD);
  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("stat-submitted")).toContainText("4");

  /*
   * REVIEW IN ONE PASS. The next step names the job; the sheet walks the
   * queue — each Approve lands on the next player without a click in between.
   */
  await expect(page.getByTestId("next-step")).toContainText("waiting for a decision");
  await page.getByTestId("start-review").click();
  const sheet = page.getByTestId("player-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("review-mode")).toBeVisible();
  const seen = new Set<string>();
  for (let i = 0; i < 4; i += 1) {
    const name = (await page.getByTestId("details-subject").textContent()) ?? "";
    expect(seen.has(name)).toBe(false);
    seen.add(name);
    await page.getByTestId("sheet-approve").click();
    if (i < 3) {
      await expect(page.getByTestId("details-subject")).not.toHaveText(name);
    }
  }
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("stat-approved").locator(".stat-value")).toHaveText("4");
  await expect(page.getByTestId("stat-auction-pool").locator(".stat-value")).toHaveText("4");

  /*
   * A CAPTAIN SKIPS THE AUCTION. Open a player (the sheet opens on Squad for an
   * approved one), put them on a team, name them captain — the pool drops.
   */
  const firstRow = page.getByTestId("reg-table").getByRole("row").nth(1);
  await firstRow.getByRole("button", { name: "Details" }).click();
  await expect(sheet).toBeVisible();
  await page.getByTestId("sheet-team").selectOption({ label: "Andheri Arrows" });
  await expect(firstRow).toContainText("Andheri Arrows");
  await page.getByTestId(/^captain-toggle-/).click();
  await expect(page.getByTestId(/^captain-toggle-/)).toHaveAttribute("aria-pressed", "true");
  await expect(firstRow.getByTestId("captain-flag")).toBeVisible();
  await expect(page.getByTestId("stat-auction-pool").locator(".stat-value")).toHaveText("3");
  await expect(page.getByTestId("stat-auction-pool").locator(".stat-hint")).toHaveText(
    "4 approved − 1 captain",
  );

  // EDIT IN PLACE: no Save button — leave the field and it is kept.
  await page.getByTestId("sheet-tab-details").click();
  const jersey = page.getByTestId("edit-jersey-number");
  await jersey.fill("77");
  await jersey.press("Enter");
  await expect(sheet.getByText("Saved")).toBeVisible();

  // THE DESK: one tap on "Paid".
  await page.getByTestId("sheet-tab-fee").click();
  await page
    .getByTestId("edit-fee-status")
    .getByRole("button", { name: "Paid", exact: true })
    .click();
  await expect(page.getByTestId("stat-fees-paid").locator(".stat-value")).toHaveText("1");

  // It all survived a reload — the server has it, not just the screen.
  await page.reload();
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", COLD);
  await expect(sheet).toBeVisible();
  await page.getByTestId("sheet-tab-details").click();
  await expect(page.getByTestId("edit-jersey-number")).toHaveValue("77");
  await expect(page.getByTestId("stat-auction-pool").locator(".stat-value")).toHaveText("3");

  // J/K walk the list without closing the sheet.
  const before = await page.getByTestId("details-subject").textContent();
  await page.getByTestId("details-subject").focus();
  await page.keyboard.press("j");
  await expect(page.getByTestId("details-subject")).not.toHaveText(before ?? "");
  await page.getByTestId("sheet-close").click();

  await expect(async () => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations).toEqual([]);
  }).toPass({ timeout: 10_000 });

  /*
   * AN ICON FROM THE TEAM'S OWN PAGE — the place an organizer thinks
   * "Bandra's icon is Desk Player 3".
   */
  await page.goto(`${seasonUrl}/teams`);
  await page
    .locator(".team-card", { hasText: "Bandra Blasters" })
    .getByRole("link", { name: "View team" })
    .click();
  const icons = page.getByTestId("presign-isIcon");
  await icons.getByRole("combobox").fill("Desk Player 3");
  await page.getByRole("option", { name: /Desk Player 3/ }).click();
  await expect(icons).toContainText("Desk Player 3");
  await expect(page.getByTestId("roster-list")).toContainText("Desk Player 3", COLD);

  // Back on Registrations the pool has lost the icon too.
  await page.goto(`${seasonUrl}/registrations`);
  await expect(page.getByTestId("stat-auction-pool").locator(".stat-value")).toHaveText("2");

  /*
   * ON A PHONE AT THE GROUND: the list is two-line rows with no sideways
   * scroll, and the sheet takes the whole screen.
   */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", COLD);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: test.info().outputPath("phone-list.png"), fullPage: true });
  await page.getByTestId("reg-table").getByRole("button", { name: "Details" }).first().click();
  const box = await sheet.boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(390);
  await page.screenshot({ path: test.info().outputPath("phone-sheet.png") });
  await page.getByTestId("sheet-close").click();
  await page.setViewportSize({ width: 1280, height: 720 });

  /*
   * EXPORT WHAT YOU CHOOSE: the jersey order, approved players only — no
   * phone numbers leave for the vendor.
   */
  await page.getByTestId("export-csv").click();
  await page.getByTestId("export-preset-kit").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-download").click();
  const download = await downloadPromise;
  const csv = (await readFile(await download.path(), "utf8")).replace(/^﻿/, "");
  const lines = csv.trim().split("\n");
  expect(lines[0]).toBe("name,team,jersey_name,jersey_number,tshirt_size,trouser_size");
  expect(lines).toHaveLength(5);
  expect(csv).not.toMatch(/\b6\d{9}\b/);
  expect(csv).toContain(",77,");
});
