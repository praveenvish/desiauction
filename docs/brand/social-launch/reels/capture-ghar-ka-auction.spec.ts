import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { latestOtp } from "./otp";

/*
 * SOCIAL CAPTURE — "Ghar Ka Auction: Remote kiska?" (not a test; it lives here,
 * never in e2e/). A real points auction on the local stack with fictional people:
 * four owners (Papa, Mummy, Beta, Dadi) bid for one lot, "TV Remote", from
 * four phones while the big screen follows. Screenshots of real screens only.
 *
 *   cp docs/brand/social-launch/reels/capture-ghar-ka-auction.spec.ts apps/web/e2e/zz-capture.spec.ts
 *   (cd apps/web && OUT=../docs/brand/social-launch/reels/.work/ghar-ka PLAYWRIGHT_PRECOMPILED=1 NEXT_DIST_DIR=.next-e2e \
 *     npx playwright test e2e/zz-capture.spec.ts --project=chromium); rm apps/web/e2e/zz-capture.spec.ts
 */

const OUT = process.env["OUT"] ?? "/tmp/social-capture";
const STAMP = String(Date.now()).slice(-8);
const COLD = { timeout: 30_000 } as const;
const FAMILY = ["Papa", "Mummy", "Beta", "Dadi"] as const;
const PHONE = { width: 390, height: 844 };
const marks: Record<string, unknown> = {};

async function login(page: Page, phone: string, name: string): Promise<void> {
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

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

test("capture: remote kiska", async ({ browser }) => {
  test.setTimeout(420_000);
  mkdirSync(OUT, { recursive: true });

  const orgCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const organizer = await orgCtx.newPage();
  await login(organizer, `85${STAMP}`, "Ghar Organiser");
  await organizer.goto("/orgs");
  await organizer.getByTestId("new-org").click();
  await organizer.getByLabel("Club name").filter({ visible: true }).fill("Apna Parivar");
  await organizer.getByRole("button", { name: "Create club" }).click();
  await expect(organizer.getByTestId("org-name")).toBeVisible();

  await organizer.goto("/seasons");
  await organizer.getByTestId("new-season").click();
  await organizer.getByLabel("Season name").filter({ visible: true }).fill("Ghar Ka");
  await organizer.getByLabel("Auction currency").filter({ visible: true }).selectOption("points");
  await organizer.getByLabel("Location").fill("Living Room");
  await organizer.getByLabel("Starts on").fill("2026-11-01");
  await organizer.getByLabel("Ends on").fill("2026-11-15");
  await organizer.getByRole("button", { name: "Create season" }).click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("draft");
  const seasonUrl = organizer.url();
  const slug = new URL(seasonUrl).pathname.split("/")[2] ?? "";

  await organizer.goto(`${seasonUrl}/teams`);
  for (const team of FAMILY) {
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
    ["name,phone,role,base_price_band", `TV Remote,9${STAMP}7,allrounder,C`].join("\n"),
  );
  await organizer.getByTestId("import-preview-btn").click();
  await expect(organizer.getByTestId("import-preview")).toContainText("1 valid", COLD);
  await organizer.getByTestId("import-commit").click();
  await organizer.getByLabel("Select all on page").check();
  await organizer.getByTestId("bulk-approve").click();
  await expect(organizer.getByTestId("stat-approved")).toContainText("1");

  await organizer.goto(`/seasons/${slug}/auction`);
  await expect(organizer.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", COLD);
  await organizer.getByTestId("setup-close-registration").click();
  await expect(organizer.getByTestId("check-intake_closed")).toHaveAttribute("data-pass", "true", COLD);
  await organizer.getByLabel("Purse per team (points)").fill("1000");
  await organizer.getByLabel("Default base price (points)").fill("100");
  await organizer.getByLabel("Squad minimum").fill("1");
  await organizer.getByLabel("Squad maximum").fill("1");
  await organizer.getByLabel("Lot timer (seconds)").fill("120");
  await organizer.screenshot({ path: `${OUT}/setup.png` });
  const shortSquads = organizer.getByTestId("accept-short-squads");
  if (await shortSquads.isVisible()) {
    await shortSquads.check();
  }
  await organizer.getByTestId("create-auction").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("scheduled", COLD);

  await organizer.getByTestId("invite-all-owners").click();
  const linkCells = organizer.locator('[data-testid^="owner-link-"]');
  await expect(linkCells).toHaveCount(4, COLD);
  const rows = await organizer.locator('[data-testid^="owner-row-"]').evaluateAll((els) =>
    els
      .filter((row) => row.querySelector('[data-testid^="owner-link-"]') !== null)
      .map((row) => ({
        team: row.querySelector(".as-owner-team")?.textContent?.trim() ?? "",
        link: row.querySelector('[data-testid^="owner-link-"]')?.textContent?.trim() ?? "",
      })),
  );

  const phones: Record<string, Page> = {};
  for (const [i, who] of FAMILY.entries()) {
    const ctx = await browser.newContext({
      viewport: PHONE,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await login(page, `86${STAMP.slice(0, 6)}${String(i)}1`, who);
    const row = rows.find((r) => r.team === who);
    await page.goto(row?.link ?? "");
    await page.getByTestId("accept-owner-invite").click();
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", COLD);
    phones[who] = page;
  }
  await organizer.reload();
  await expect(organizer.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", COLD);
  for (const who of FAMILY) {
    const row = organizer.locator(".as-owner", { hasText: who });
    await row.getByRole("button", { name: "Grant paddle" }).click();
    await expect(row).toContainText("Waiting for them to claim", COLD);
  }
  for (const who of FAMILY) {
    const page = phones[who] as Page;
    await page.goto(`/seasons/${slug}/auction/live`);
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", COLD);
    await page.getByLabel("Team", { exact: true }).selectOption({ label: who });
    await page.getByTestId("claim-paddle").click();
    await expect(page.getByTestId("my-paddle")).toBeVisible(COLD);
  }

  await organizer.reload();
  await expect(organizer.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", COLD);
  await organizer.getByTestId("queue-all").click();
  await expect(organizer.getByTestId("lot-L001")).toContainText("queued", COLD);
  const shortOpen = organizer.getByTestId("accept-short-open");
  if (await shortOpen.isVisible()) {
    await shortOpen.check();
  }
  await organizer.getByTestId("auction-open").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("live", COLD);

  // The TV: the big screen, 1920x1080.
  const tvCtx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1.5,
    storageState: await orgCtx.storageState(),
  });
  const tv = await tvCtx.newPage();
  await tv.goto(`/seasons/${slug}/auction/board`);
  await expect(tv.getByTestId("board")).toBeVisible(COLD);

  await organizer.getByTestId("open-live").click();
  await expect(organizer.getByTestId("connection-state")).toHaveText("Connected", { timeout: 20_000 });
  await organizer.getByTestId("conduct-open-lot").click();
  for (const page of Object.values(phones)) {
    await expect(page.getByTestId("current-lot")).toBeVisible({ timeout: 20_000 });
  }
  await tv.waitForTimeout(1500);
  await shot(tv, "tv-00-open");
  for (const who of FAMILY) {
    await shot(phones[who] as Page, `phone-00-${who}`);
  }

  const leading = async (): Promise<string> =>
    (await organizer.getByTestId("leading-bid").textContent())?.trim() ?? "";

  // One bid: the owner's phone before the tap, then the TV and the phone after.
  let n = 0;
  async function bid(who: string, rung: "next" | "max"): Promise<void> {
    n += 1;
    const page = phones[who] as Page;
    const tag = `${String(n).padStart(2, "0")}-${who}`;
    if (rung === "max") {
      const chips = page.locator('[data-testid^="bid-jump-"]:not([disabled])');
      const count = await chips.count();
      if (count > 0) {
        await chips.nth(count - 1).click();
      }
      await shot(page, `phone-${tag}-pick`);
      await page.locator(".owner-bid").click();
    } else {
      await shot(page, `phone-${tag}-pick`);
      await page.getByTestId("bid-next").click();
    }
    await expect(organizer.getByTestId("leading-team")).toContainText(who, { timeout: 20_000 });
    marks[tag] = await leading();
    await shot(tv, `tv-${tag}`);
    await shot(page, `phone-${tag}-after`);
  }

  await bid("Papa", "next");
  await bid("Mummy", "next");

  // Beta and Papa tap the same amount together; the server takes one.
  n += 1;
  const race = `${String(n).padStart(2, "0")}-race`;
  const betaPage = phones["Beta"] as Page;
  const papaPage = phones["Papa"] as Page;
  await Promise.all([
    papaPage.getByTestId("bid-next").click(),
    betaPage.waitForTimeout(40).then(() => betaPage.getByTestId("bid-next").click()),
  ]);
  await organizer.waitForTimeout(1500);
  marks[race] = {
    leader: (await organizer.getByTestId("leading-team").textContent())?.trim(),
    amount: await leading(),
  };
  await shot(tv, `tv-${race}`);
  await shot(betaPage, `phone-${race}-Beta`);
  await shot(papaPage, `phone-${race}-Papa`);
  writeFileSync(`${OUT}/beta-race.txt`, (await betaPage.locator("main").innerText()).slice(0, 4000));

  await bid("Mummy", "next");
  await bid("Dadi", "max");
  marks["dadi-final"] = await leading();

  await organizer.getByTestId("conduct-close-lot").hover();
  await organizer.mouse.down();
  await organizer.waitForTimeout(900);
  await organizer.mouse.up();
  await expect(organizer.getByTestId("ceremony")).toBeVisible({ timeout: 20_000 });
  await tv.waitForTimeout(600);
  await shot(tv, "tv-90-sold");
  await tv.waitForTimeout(1800);
  await shot(tv, "tv-91-sold-late");
  for (const who of FAMILY) {
    await shot(phones[who] as Page, `phone-90-${who}`);
  }
  writeFileSync(`${OUT}/marks.json`, JSON.stringify({ slug, ...marks }, null, 2));
});
