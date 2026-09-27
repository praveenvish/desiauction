import { expect, test, type Page } from "@playwright/test";
import { latestOtp } from "./otp";

/**
 * STAGE 4 — THE GAVEL SELLS WHAT ITS LABEL SAYS (founder decision).
 *
 * The conductor's gavel reads "Hold to sell to <team> · <amount>". Before this,
 * a bid that landed while the gavel was held did not interrupt the hold: it
 * completed and sold the lot to whoever led when the fill ran out — a hold
 * begun as "sell to Arrows" could end as a sale to Blasters at a price nobody
 * at the desk had read. Now a new leader or amount mid-hold ABORTS the hold,
 * says "New bid — hold again", and the conductor holds again from zero.
 *
 * DETERMINISM, NOT A RACE. The hold is 600ms of real time; a bid's round trip
 * (click → server action → engine → socket → render) can take longer than that
 * under a loaded suite. So the conductor's page runs on Playwright's clock and
 * the clock is PAUSED while the gavel is held: the hold cannot fill on its own,
 * which makes "the bid landed mid-hold" certain instead of likely. Sockets and
 * React commits are not timers and carry on. The clock is then resumed with the
 * pointer still down, and the full 900ms (> the gate) passes: had the hold
 * survived the bid, the lot would sell right there — the assertion that it did
 * not is the regression guard.
 */

async function otpLogin(page: Page, phone: string): Promise<void> {
  if (!page.url().includes("/login")) {
    await page.goto("/login");
  }
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code");
  const code = await latestOtp(phone);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill("E2E Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
}

function playersCsv(stamp: string): string {
  const header = "name,phone,role,base_price_band";
  const rows = Array.from({ length: 2 }, (_, i) => {
    const phone = `9${stamp}${i}`.slice(0, 10);
    return `Gavel Player ${i},${phone},batter,C`;
  });
  return [header, ...rows].join("\n");
}

async function holdGavel(page: Page): Promise<void> {
  await page.getByTestId("cockpit-gavel").hover();
  await page.mouse.down();
  await page.waitForTimeout(900); // > the 600ms gate
  await page.mouse.up();
}

test("gavel: a bid mid-hold aborts the hold; a fresh hold sells to the new leader", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const STAMP = String(Date.now()).slice(-8);

  // --- Stage: club → season → 2 teams → 2 players → auction -------------------
  const organizerCtx = await browser.newContext();
  const organizer = await organizerCtx.newPage();
  await otpLogin(organizer, `72${STAMP}`);
  await organizer.goto("/orgs");
  await organizer.getByTestId("new-org").click();
  await organizer.getByLabel("Club name").filter({ visible: true }).fill(`Gavel Org ${STAMP}`);
  await organizer.getByRole("button", { name: "Create club" }).click();
  await expect(organizer.getByTestId("org-name")).toBeVisible();

  await organizer.goto("/seasons");
  await organizer.getByTestId("new-season").click();
  await organizer.getByLabel("Season name").filter({ visible: true }).fill(`Gavel Cup ${STAMP}`);
  await organizer.getByLabel("Location").fill("Powai");
  await organizer.getByLabel("Starts on").fill("2026-08-01");
  await organizer.getByLabel("Ends on").fill("2026-09-15");
  await organizer.getByRole("button", { name: "Create season" }).click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("draft");
  const slug = new URL(organizer.url()).pathname.split("/")[2] ?? "";
  await organizer.goto(`/seasons/${slug}/teams`);
  for (const team of ["Arrows", "Blasters"]) {
    await organizer.getByTestId("open-add-team").click();
    await organizer.getByLabel("Team name").filter({ visible: true }).fill(team);
    await organizer.getByTestId("add-team-workspace").click();
    await expect(organizer.getByTestId("teams-list")).toContainText(team);
  }
  await organizer.goto(`/seasons/${slug}`);
  await organizer.getByTestId("advance-status").click(); // setup
  await expect(organizer.getByTestId("competition-status")).toHaveText("setup");
  await organizer.getByTestId("advance-status").click(); // open registration
  await expect(organizer.getByTestId("competition-status")).toHaveText("registration open");
  await organizer.getByTestId("open-dashboard").click();
  await expect(organizer.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await organizer.getByTestId("open-import").click();
  await organizer.getByTestId("import-textarea").evaluate((el, csv) => {
    (el as HTMLTextAreaElement).value = csv;
  }, playersCsv(STAMP));
  await organizer.getByTestId("import-preview-btn").click();
  await expect(organizer.getByTestId("import-preview")).toContainText("2 valid", {
    timeout: 20_000,
  });
  await organizer.getByTestId("import-commit").click();
  await expect(organizer.getByTestId("stat-total")).toContainText("2", { timeout: 20_000 });
  await organizer.getByLabel("Select all on page").check();
  await organizer.getByTestId("bulk-approve").click();
  await expect(organizer.getByTestId("stat-approved")).toContainText("2");
  await organizer.goto(`/seasons/${slug}`);
  await organizer.getByTestId("advance-status").click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("registration closed");
  await organizer.getByTestId("open-auction").click();
  await expect(organizer.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  // A long lot clock: nothing here may be decided by the lot timing out.
  await organizer.getByLabel("Lot timer (seconds)").fill("120");
  await organizer.getByLabel("Anti-snipe extension (seconds)").fill("45");
  await organizer.getByTestId("accept-short-squads").check();
  await organizer.getByTestId("create-auction").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("scheduled", {
    timeout: 20_000,
  });

  // --- Owners: invite → accept → grant → claim ---------------------------------
  await organizer.goto(`/seasons/${slug}/auction/cockpit`);
  await expect(organizer.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  const joinUrls: string[] = [];
  for (const team of ["Arrows", "Blasters"]) {
    await organizer.getByLabel("Team", { exact: true }).selectOption({ label: team });
    await organizer.getByTestId("invite-owner").click();
    await expect
      .poll(
        async () => {
          const url = (await organizer.getByTestId("owner-invite-url").textContent())?.trim() ?? "";
          return url.includes("/owner-join/") && !joinUrls.includes(url) ? url : "";
        },
        { timeout: 20_000 },
      )
      .not.toBe("");
    joinUrls.push(((await organizer.getByTestId("owner-invite-url").textContent()) ?? "").trim());
  }
  const owners: Page[] = [];
  for (let i = 0; i < 2; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await otpLogin(page, `71${STAMP.slice(0, 6)}${String(i)}0`);
    await page.goto(joinUrls[i] as string);
    await page.getByTestId("accept-owner-invite").click();
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", {
      timeout: 30_000,
    });
    owners.push(page);
  }
  await organizer.reload();
  await expect(organizer.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  for (const team of ["Arrows", "Blasters"]) {
    await organizer
      .locator(".owner-row", { hasText: team })
      .getByRole("button", { name: "Grant paddle" })
      .click();
    await expect(
      organizer.locator(".owner-row", { hasText: team }).getByText("granted", { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
  }
  const teamOfOwner = ["Arrows", "Blasters"];
  for (let i = 0; i < 2; i++) {
    const page = owners[i] as Page;
    await page.goto(`/seasons/${slug}/auction/live`);
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", {
      timeout: 30_000,
    });
    await page
      .getByLabel("Team", { exact: true })
      .selectOption({ label: teamOfOwner[i] as string });
    await page.getByTestId("claim-paddle").click();
    await expect(page.getByTestId("my-paddle")).toBeVisible({ timeout: 20_000 });
  }
  await organizer.close();

  // --- The conductor's desk, on a clock the test can stop ----------------------
  const desk = await organizerCtx.newPage();
  await desk.clock.install();
  await desk.goto(`/seasons/${slug}/auction/cockpit`);
  await expect(desk.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await desk.getByTestId("cockpit-queue-lots").click();
  await expect(desk.getByTestId("queue-L001")).toBeVisible({ timeout: 20_000 });
  await desk.getByTestId("cockpit-open-auction").click();
  await expect(desk.getByTestId("ribbon-status")).toHaveText("live", { timeout: 20_000 });
  await desk.getByTestId("open-L001").click();
  await expect(desk.getByTestId("ceremony")).toHaveAttribute("data-phase", "opening", {
    timeout: 20_000,
  });

  const [ownerA, ownerB] = owners as [Page, Page];
  await ownerA.getByTestId("bid-next").click();
  await expect(desk.getByTestId("leading-team")).toContainText("Arrows", { timeout: 20_000 });
  const gavel = desk.getByTestId("cockpit-gavel");
  await expect(gavel).toContainText("Hold to sell to Arrows");
  const arrowsAmount = (
    (await desk.getByTestId("ribbon-bid").locator("strong").textContent()) ?? ""
  ).trim();
  expect(arrowsAmount.length).toBeGreaterThan(0);

  // --- Hold for Arrows; Blasters bids mid-hold ---------------------------------
  await gavel.hover();
  await desk.clock.pauseAt(Date.now() + 1_000);
  await desk.mouse.down();
  await expect(gavel).toHaveAttribute("data-holding", "true");
  // The LAYOUT box (offset metrics ignore the desk's :active press transform).
  const layoutBox = () =>
    gavel.evaluate((el) => {
      const node = el as HTMLElement;
      return [node.offsetLeft, node.offsetTop, node.offsetWidth, node.offsetHeight];
    });
  const boxBefore = await layoutBox();

  await ownerB.getByTestId("bid-next").click();
  await expect(desk.getByTestId("leading-team")).toContainText("Blasters", { timeout: 20_000 });
  // The hold aborted the moment the leader changed: fill empty, the cue up,
  // the label now naming the NEW leader — and the button's box has not moved
  // under the still-pressed pointer (the pointerleave trap).
  await expect(gavel).toHaveAttribute("data-holding", "false");
  await expect(desk.getByTestId("cockpit-gavel-restart")).toHaveText("New bid — hold again");
  await expect(gavel).toContainText("Hold to sell to Blasters");
  expect(await layoutBox()).toEqual(boxBefore);
  const blastersAmount = (
    (await desk.getByTestId("ribbon-bid").locator("strong").textContent()) ?? ""
  ).trim();
  expect(blastersAmount).not.toBe(arrowsAmount);

  // Time runs again with the pointer STILL DOWN, well past the 600ms gate.
  // A surviving hold would sell here; an aborted one cannot restart itself.
  await desk.clock.resume();
  await desk.waitForTimeout(900);
  await expect(gavel).toHaveAttribute("data-holding", "false");
  await expect(desk.getByTestId("ceremony")).not.toHaveAttribute("data-phase", "sold");
  for (const page of [desk, ownerA, ownerB]) {
    await expect(page.getByTestId("leading-team")).toContainText("Blasters");
  }
  await expect(ownerA.getByTestId("current-lot")).toBeVisible();
  await desk.mouse.up();
  await expect(desk.getByTestId("ceremony")).not.toHaveAttribute("data-phase", "sold", {
    timeout: 1_500,
  });

  // --- A fresh, full hold sells to the NEW leader at the NEW amount ------------
  await holdGavel(desk);
  await expect(desk.getByTestId("ceremony")).toHaveAttribute("data-phase", "sold", {
    timeout: 20_000,
  });
  const result = desk.getByTestId("desk-last-result").filter({ visible: true }).first();
  await expect(result).toHaveAttribute("data-kind", "sold", { timeout: 20_000 });
  await expect(result).toContainText("Blasters");
  await expect(result).toContainText(blastersAmount);

  // The record agrees: exactly one SOLD row, to Blasters, at Blasters' price.
  const ledger = await organizerCtx.newPage();
  await ledger.goto(`/seasons/${slug}/auction/ledger`);
  await expect(ledger.getByTestId("ledger-table")).toBeVisible();
  const sold = ledger
    .getByTestId("ledger-table")
    .locator("tbody tr")
    .filter({ has: ledger.locator(".ledger-result", { hasText: /^SOLD$/ }) });
  await expect(sold).toHaveCount(1);
  await expect(sold.locator(".ledger-c-team")).toContainText("Blasters");
  await expect(sold.locator(".ledger-c-bid")).toHaveText(blastersAmount);

  for (const page of owners) {
    await page.context().close();
  }
  await organizerCtx.close();
});
