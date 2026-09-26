import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  CAPTAINS,
  COLD,
  ICONS,
  OUT,
  PLAYERS,
  TEAMS,
  log,
  otpLogin,
  saveState,
  shot,
  type SimState,
  type TeamName,
} from "./sim-lib";

const STAMP = String(Date.now()).slice(-7);

async function openPlayer(page: Page, name: string): Promise<void> {
  const search = page.locator("#pd-search");
  await search.fill(name);
  await search.press("Enter");
  const row = page.getByTestId("reg-table").getByRole("row").filter({ hasText: name });
  await expect(row).toHaveCount(1, COLD);
  await row.getByTestId(/^open-/).click();
  await expect(page.getByTestId("player-sheet")).toBeVisible();
  await expect(page.getByTestId("details-subject")).toContainText(name);
}

test("stage 1 — organizer sets up a 43-player points season with 3 teams", async ({ browser }) => {
  const orgPhone = `8${STAMP}01`;
  const organizerCtx = await browser.newContext();
  const org = await organizerCtx.newPage();
  const t0 = Date.now();
  await otpLogin(org, orgPhone, "Rohit Mehta");
  log(`organizer signed in (${orgPhone}) in ${Date.now() - t0}ms`);

  await org.goto("/orgs");
  await org.getByTestId("new-org").click();
  await org.getByLabel("Club name").filter({ visible: true }).fill(`Konkan Cricket Club ${STAMP}`);
  await org.getByRole("button", { name: "Create club" }).click();
  await expect(org.getByTestId("org-name")).toBeVisible();

  await org.goto("/seasons");
  await org.getByTestId("new-season").click();
  await org
    .getByLabel("Season name")
    .filter({ visible: true })
    .fill(`Konkan Premier League ${STAMP}`);
  await org.getByLabel("Auction currency").filter({ visible: true }).selectOption("points");
  await org.getByLabel("Location").fill("Thane");
  await org.getByLabel("Starts on").fill("2026-10-10");
  await org.getByLabel("Ends on").fill("2026-10-25");
  await org.getByRole("button", { name: "Create season" }).click();
  await expect(org.getByTestId("competition-status")).toHaveText("draft", COLD);
  const seasonUrl = org.url();
  const slug = new URL(seasonUrl).pathname.split("/")[2] ?? "";
  log(`season created: ${slug}`);

  await org.goto(`${seasonUrl}/teams`);
  for (const team of TEAMS) {
    await org.getByTestId("open-add-team").click();
    await org.getByLabel("Team name").filter({ visible: true }).fill(team);
    await org.getByTestId("add-team-workspace").click();
    await expect(org.getByTestId("teams-list")).toContainText(team);
  }
  await org.goto(seasonUrl);
  await org.getByTestId("advance-status").click();
  await expect(org.getByTestId("competition-status")).toHaveText("setup");
  await org.getByTestId("advance-status").click();
  await expect(org.getByTestId("competition-status")).toHaveText("registration open");

  // --- 43 players arrive by CSV --------------------------------------------------
  await org.goto(`${seasonUrl}/registrations`);
  await expect(org.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", COLD);
  await org.getByTestId("open-import").click();
  const csv = [
    "name,phone,role,base_price_band",
    ...PLAYERS.map((p, i) => `${p.name},9${STAMP}${String(i + 10)},${p.role},${p.band}`),
  ].join("\n");
  await org.getByTestId("import-textarea").evaluate((el, value) => {
    (el as HTMLTextAreaElement).value = value;
  }, csv);
  await org.getByTestId("import-preview-btn").click();
  await expect(org.getByTestId("import-preview")).toContainText("43 valid", COLD);
  await shot(org, "01-import-preview");
  await org.getByTestId("import-commit").click();
  await expect(org.getByTestId("stat-submitted")).toContainText("43", COLD);
  log("43 players imported");

  // Approve everyone, page by page — filtered to the ones still waiting.
  await org.getByTestId("stat-submitted").click();
  for (let round = 0; round < 5; round += 1) {
    const approved =
      (await org.getByTestId("stat-approved").locator(".stat-value").textContent()) ?? "0";
    if (approved.trim() === "43") break;
    await org.getByLabel("Select all on page").check();
    await org.getByTestId("bulk-approve").click();
    await expect(org.getByTestId("stat-approved").locator(".stat-value")).not.toHaveText(
      approved.trim(),
      COLD,
    );
  }
  await expect(org.getByTestId("stat-approved").locator(".stat-value")).toHaveText("43", COLD);
  await expect(org.getByText("No registrations match these filters")).toBeVisible(COLD);
  await org.getByTestId("filters-reset").click();
  await expect(org.getByTestId("stat-total")).toHaveAttribute("aria-pressed", "true", COLD);
  await expect(org).not.toHaveURL(/status=/);
  log("43 approved");

  // --- Captains and icons, named in the player desk ------------------------------
  for (const team of TEAMS) {
    for (const [kind, who] of [
      ["captain", CAPTAINS[team]],
      ["icon", ICONS[team]],
    ] as const) {
      await openPlayer(org, who);
      await org.getByTestId("sheet-team").selectOption({ label: team });
      const toggle = org.getByTestId(new RegExp(`^${kind}-toggle-`));
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true", COLD);
      await org.getByTestId("sheet-close").click();
      log(`${who} → ${team} (${kind})`);
    }
  }
  await org.locator("#pd-search").fill("");
  await org.locator("#pd-search").press("Enter");
  await expect(org.getByTestId("stat-auction-pool").locator(".stat-value")).toHaveText("37", COLD);
  await shot(org, "02-registrations-marked");
  log("auction pool = 37 (43 − 3 captains − 3 icons)");

  // --- The rules of the night -----------------------------------------------------
  await org.goto(`/seasons/${slug}/auction`);
  await expect(org.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", COLD);
  await org.getByTestId("setup-close-registration").click();
  await expect(org.getByTestId("check-intake_closed")).toHaveAttribute("data-pass", "true", COLD);
  const fill = async (label: string, value: string) => {
    const field = org.getByLabel(label, { exact: true });
    await field.fill(value);
  };
  await fill("Purse per team (points)", "100000");
  await fill("Squad minimum", "12");
  await fill("Squad maximum", "12");
  await fill("Lot timer (seconds)", "20");
  await fill("Anti-snipe extension (seconds)", "10");
  await fill("Default base price (points)", "1000");
  for (const band of ["A", "B", "C"]) await fill(`Band ${band} base price (points)`, "1000");
  await expect(org.getByTestId("auction-setup")).toContainText("1,00,000");
  await expect(org.getByTestId("feasibility-preview")).toBeVisible();
  log(`feasibility: ${(await org.getByTestId("feasibility-preview").textContent()) ?? ""}`);
  await shot(org, "03-auction-rules");
  await org.getByTestId("create-auction").click();
  await expect(org.getByTestId("auction-status")).toHaveText("scheduled", COLD);
  log("auction created (scheduled)");

  // --- Owners -------------------------------------------------------------------------
  await org.getByTestId("invite-all-owners").click();
  const linkCells = org.locator('[data-testid^="owner-link-"]');
  await expect(linkCells).toHaveCount(3, COLD);
  const links = (await linkCells.allTextContents()).map((t) => t.trim());
  const teamOrder = (await org
    .locator('[data-testid^="owner-row-"]')
    .evaluateAll((rows) =>
      rows
        .filter((row) => row.querySelector('[data-testid^="owner-link-"]') !== null)
        .map((row) => row.querySelector(".as-owner-team")?.textContent?.trim() ?? ""),
    )) as TeamName[];

  const ownerNames = ["Aarav Shah", "Ishaan Desai", "Kiran Patkar"];
  const owners: SimState["owners"] = [];
  for (let i = 0; i < 3; i += 1) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const phone = `7${STAMP}0${String(i + 1)}`;
    await otpLogin(page, phone, ownerNames[i]!);
    await page.goto(links[i] ?? "");
    await expect(page.getByTestId("owner-join-purse")).toContainText("1,00,000", COLD);
    await page.getByTestId("accept-owner-invite").click();
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", COLD);
    const storage = path.join(OUT, `owner-${String(i)}.json`);
    await ctx.storageState({ path: storage });
    owners.push({ phone, name: ownerNames[i]!, team: teamOrder[i]!, storage });
    log(`owner ${ownerNames[i]} accepted ${teamOrder[i]}`);
    await ctx.close();
  }

  await org.reload();
  await expect(org.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", COLD);
  for (const { team } of owners) {
    const row = org.locator(".as-owner", { hasText: team });
    await expect(row).toContainText("Accepted");
    await row.getByRole("button", { name: "Grant paddle" }).click();
    await expect(row).toContainText("Waiting for them to claim", COLD);
  }
  await shot(org, "04-owners-granted");

  const orgStorage = path.join(OUT, "organizer.json");
  await organizerCtx.storageState({ path: orgStorage });
  saveState({
    stamp: STAMP,
    slug,
    seasonUrl,
    organizer: { phone: orgPhone, name: "Rohit Mehta", storage: orgStorage },
    owners,
    captains: CAPTAINS,
    icons: ICONS,
  });
  log(`stage 1 done in ${Math.round((Date.now() - t0) / 1000)}s`);
  await organizerCtx.close();
});
