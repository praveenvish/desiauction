import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { clearNameGate } from "./onboarding";
import { completeAuction } from "./complete-auction";
import { latestOtp } from "./otp";

/**
 * v1.1 (G2): the gavel is a HOLD, not a click — on /live's conduct panel now as
 * well as the cockpit's. A plain click is deliberately inert (that IS the
 * safety property), so the suite holds past the 600ms gate.
 */
async function holdCloseLot(page: Page): Promise<void> {
  await page.getByTestId("conduct-close-lot").hover();
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
}

// PX-6 Live Auction Experience: lobby (rules + connection check), the owner
// workspace (purse/squad/slots), outbid + winning notifications, the bid
// ladder, PUBLIC spectating with the auction timeline and big-screen mode,
// and the completion ceremony on every surface. The engine mechanics (anti-
// snipe, restart, convergence, undo) stay covered by live-auction.spec and
// conduct-ceremony.spec — this suite verifies the EXPERIENCE around them.

const STAMP = String(Date.now()).slice(-8);
const ORGANIZER = `64${STAMP}`;
const OWNER_A = `65${STAMP}`;
const OWNER_B = `66${STAMP}`;

test.describe.configure({ mode: "serial" });

let slug = "";
let liveUrl = "";
let spectateUrl = "";

async function otpLogin(page: Page, phone: string): Promise<void> {
  if (!page.url().includes("/login")) {
    await page.goto("/login");
  }
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
    timeout: 30_000,
  });
  const code = await latestOtp(phone);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function owner(browser: Browser, phone: string, joinUrl: string, team: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await otpLogin(page, phone);
  await page.goto(joinUrl);
  await page.getByTestId("accept-owner-invite").click();
  await clearNameGate(page, "Night Owner");
  await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  return { ctx, page, team };
}

test("the full night: lobby → owners → bidding with notifications → public spectator → ceremony", async ({
  browser,
}) => {
  test.setTimeout(300_000);

  // --- Organizer stands the auction up (the certified journey, condensed) -----
  const organizerCtx = await browser.newContext();
  const organizer = await organizerCtx.newPage();
  await otpLogin(organizer, ORGANIZER);
  await expect(organizer).toHaveURL(/\/onboarding/);
  await organizer.getByLabel("What should we call you?").fill("Night Organizer");
  await organizer.getByRole("button", { name: "Continue" }).click();
  // WAIT FOR THE NAME TO LAND BEFORE NAVIGATING. The gate on every console
  // segment reads the session, so a `goto` that races the write is sent to
  // /onboarding, which — by then finding a name — forwards to its default of
  // /home. The spec then sits on /home waiting for a control that only exists
  // on /orgs, and dies on the 5-minute test timeout rather than on an
  // assertion. Every spec that does this correctly waits for /home first.
  await expect(organizer).toHaveURL(/\/home/);
  // Organizations are created where the work is (/orgs), not as an entry toll:
  // the onboarding wizard stopped asking for one in the 2026-07-24 collapse.
  // /home does carry a create dialog, but it is CLOSED, so its field is in the
  // DOM and invisible — which is why reaching for it here hung instead of
  // failing.
  await organizer.goto("/orgs");
  await organizer.getByTestId("new-org").click();
  await organizer
    .getByLabel("Organization name")
    .filter({ visible: true })
    .fill(`Night CC ${STAMP}`);
  await organizer.getByRole("button", { name: "Create organization" }).click();
  await expect(organizer.getByTestId("org-name")).toBeVisible();

  await organizer.goto("/seasons");
  await organizer.getByTestId("new-season").click();
  await organizer.getByLabel("Season name").filter({ visible: true }).fill(`Night Cup ${STAMP}`);
  await organizer.getByLabel("Location").fill("Malad");
  await organizer.getByLabel("Starts on").fill("2026-08-01");
  await organizer.getByLabel("Ends on").fill("2026-09-15");
  await organizer.getByRole("button", { name: "Create season" }).click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("draft");
  slug = new URL(organizer.url()).pathname.split("/")[2] ?? "";
  liveUrl = `/seasons/${slug}/auction/live`;
  spectateUrl = `/seasons/${slug}/auction/spectate`;
  await organizer.goto(`/seasons/${slug}/teams`);
  for (const team of ["Team Alpha", "Team Bravo"]) {
    await organizer.getByTestId("open-add-team").click();
    await organizer.getByLabel("Team name").filter({ visible: true }).fill(team);
    await organizer.getByTestId("add-team-workspace").click();
    await expect(organizer.getByTestId("teams-list")).toContainText(team);
  }
  await organizer.goto(`/seasons/${slug}`);
  await organizer.getByTestId("advance-status").click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("setup");
  await organizer.getByTestId("advance-status").click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("registration open");
  // Publish: the public page AND public spectating hang off this switch. It is
  // a two-step act now — putting a season on the public internet is confirmed.
  await organizer.getByTestId("toggle-visibility").click();
  await organizer.getByTestId("confirm-publish").click();
  await expect(organizer.getByTestId("visibility-row")).toContainText("LIVE");

  await organizer.getByTestId("open-dashboard").click();
  await expect(organizer.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  const csv = [
    "name,phone,role,base_price_band",
    `Star Batter,9${STAMP}0,batter,C`,
    `Star Bowler,9${STAMP}1,bowler,C`,
  ].join("\n");
  await organizer.getByTestId("open-import").click();
  await organizer.getByTestId("import-textarea").evaluate((el, value) => {
    (el as HTMLTextAreaElement).value = value;
  }, csv);
  await organizer.getByTestId("import-preview-btn").click();
  await expect(organizer.getByTestId("import-preview")).toContainText("2 valid", {
    timeout: 20_000,
  });
  await organizer.getByTestId("import-commit").click();
  await expect(organizer.getByTestId("stat-total")).toContainText("2");
  await organizer.getByLabel("Select all on page").check();
  await organizer.getByTestId("bulk-approve").click();
  await expect(organizer.getByTestId("stat-approved")).toContainText("2", { timeout: 15_000 });
  await organizer.goto(`/seasons/${slug}`);
  await organizer.getByTestId("advance-status").click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("registration closed");

  // --- The LOBBY (PX-6): create the auction, read the rules, check the room ---
  await organizer.getByTestId("open-auction").click();
  await expect(organizer.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  // Feasibility: these fixtures run a handful of players against squads of 8,
  // which the setup screen now refuses until the shortfall is accepted on the
  // record (it is the state that used to become an unclosable auction).
  await organizer.getByTestId("accept-short-squads").check();
  // A LONG LOT CLOCK, so the GAVEL ends lots and the timer never does.
  //
  // This journey drives four browser contexts through a whole night, and on the
  // 30s default the lot could expire mid-assertion — auto-selling to whoever
  // led, which fires the winner's toast before the spec starts watching for it.
  // The toast is transient, so it was gone by the time anyone looked, and "the
  // winner hears it" failed intermittently while being perfectly true. Ninety
  // seconds puts the ending back in the auctioneer's hands, which is what every
  // assertion here is written about.
  await organizer.getByLabel("Lot timer (seconds)").fill("90");
  await organizer.getByTestId("create-auction").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("scheduled", {
    timeout: 20_000,
  });
  await organizer.reload();
  await expect(organizer.getByTestId("auction-rules")).toContainText("Purse per team");
  await expect(organizer.getByTestId("auction-rules")).toContainText("anti-snipe");
  await expect(organizer.getByTestId("connection-check")).toContainText("Engine reachable", {
    timeout: 20_000,
  });

  // --- Owner invitations → acceptance → grants → claims ----------------------
  await organizer.goto(`/seasons/${slug}/auction/cockpit`);
  await expect(organizer.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  const joinUrls: string[] = [];
  for (const team of ["Team Alpha", "Team Bravo"]) {
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
  const ownerA = await owner(browser, OWNER_A, joinUrls[0] ?? "", "Team Alpha");
  const ownerB = await owner(browser, OWNER_B, joinUrls[1] ?? "", "Team Bravo");

  await organizer.goto(`/seasons/${slug}/auction/cockpit`);
  await expect(organizer.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  for (const team of ["Team Alpha", "Team Bravo"]) {
    await organizer
      .locator(".owner-row", { hasText: team })
      .getByRole("button", { name: "Grant paddle" })
      .click();
    await expect(
      organizer.locator(".owner-row", { hasText: team }).getByText("granted", { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
  }
  for (const entry of [ownerA, ownerB]) {
    await entry.page.goto(liveUrl);
    await expect(entry.page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", {
      timeout: 30_000,
    });
    await entry.page.getByLabel("Team", { exact: true }).selectOption({ label: entry.team });
    await entry.page.getByTestId("claim-paddle").click();
    await expect(entry.page.getByTestId("my-paddle")).toBeVisible({ timeout: 20_000 });
    // The OWNER WORKSPACE exists the moment the paddle is claimed.
    await expect(entry.page.getByTestId("my-team-card")).toBeVisible();
    await expect(entry.page.getByTestId("my-slots")).toContainText("0/");
  }

  // --- Go live; a PUBLIC (anonymous) spectator joins the stage ----------------
  await organizer.goto(`/seasons/${slug}/auction`);
  await expect(organizer.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await organizer.getByTestId("queue-all").click();
  await expect(organizer.getByTestId("lot-L001")).toContainText("queued");
  await organizer.getByTestId("accept-short-open").check();
  await organizer.getByTestId("auction-open").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("live");

  const spectatorCtx: BrowserContext = await browser.newContext();
  const spectator = await spectatorCtx.newPage();
  await spectator.goto(spectateUrl); // NO login — published competition.
  await expect(spectator.getByTestId("spectate-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });

  // --- Lot 1: ladder, outbid notification, winning notification ---------------
  await organizer.goto(liveUrl);
  await expect(organizer.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await organizer.getByTestId("conduct-open-lot").click();
  for (const page of [organizer, ownerA.page, ownerB.page, spectator]) {
    await expect(
      page.getByTestId("current-lot").or(page.getByTestId("spectate-panel")),
    ).toBeVisible({ timeout: 20_000 });
  }
  await expect(ownerA.page.getByTestId("bid-ladder")).toBeVisible({ timeout: 20_000 });

  await ownerA.page.getByTestId("bid-next").click();
  await expect(ownerA.page.getByTestId("my-team-leading")).toBeVisible({ timeout: 20_000 });
  // Owner A was leading and is no longer: the outbid notification fires.
  // (Observe BEFORE acting — toasts are transient and the broadcast can land
  // while the acting click's server round-trip is still awaiting.)
  await Promise.all([
    expect(ownerA.page.getByText(/Outbid — Team Bravo/)).toBeVisible({ timeout: 45_000 }),
    ownerB.page.getByTestId("bid-next").click(),
  ]);

  await ownerA.page.getByTestId("bid-next").click();
  await expect(ownerA.page.getByTestId("my-team-leading")).toBeVisible({ timeout: 20_000 });
  // Winner hears it; the squad and the money move on the owner workspace.
  await Promise.all([
    expect(ownerA.page.getByText(/You signed Star Batter/)).toBeVisible({ timeout: 45_000 }),
    holdCloseLot(organizer),
  ]).catch(async (error: unknown) => {
    throw error;
  });
  await expect(ownerA.page.getByTestId("my-squad")).toContainText("Star Batter", {
    timeout: 20_000,
  });
  await expect(ownerA.page.getByTestId("my-slots")).toContainText("1/");
  await expect(ownerA.page.getByTestId("my-spent")).not.toContainText("₹0", { timeout: 20_000 });
  // Every surface's timeline carries the SOLD moment — including the public one.
  await expect(spectator.getByTestId("timeline-sold").first()).toContainText("Star Batter", {
    timeout: 30_000,
  });
  await expect(organizer.getByTestId("timeline-sold").first()).toBeVisible();

  // Big-screen mode: chrome retreats, the stage stays.
  await spectator.getByTestId("stage-toggle").click();
  await expect(spectator.getByTestId("spectate-panel")).toHaveAttribute("data-stage", "true");
  await expect(spectator.getByTestId("spectate-purses")).not.toBeVisible();
  await spectator.getByTestId("stage-toggle").click();
  await expect(spectator.getByTestId("spectate-purses")).toBeVisible();

  // --- Lot 2 to owner B, then the completion ceremony everywhere --------------
  await organizer.getByTestId("conduct-open-lot").click();
  await expect(ownerB.page.getByTestId("current-lot")).toBeVisible({ timeout: 20_000 });
  await ownerB.page.getByTestId("bid-next").click();
  await expect(ownerB.page.getByTestId("my-team-leading")).toBeVisible({ timeout: 20_000 });
  await holdCloseLot(organizer);
  await expect(ownerB.page.getByTestId("my-slots")).toContainText("1/", { timeout: 20_000 });

  await completeAuction(organizer, "conduct-complete");
  for (const [page, who] of [
    [organizer, "organizer"],
    [ownerA.page, "ownerA"],
    [ownerB.page, "ownerB"],
    [spectator, "spectator"],
  ] as const) {
    await expect(page.getByTestId("auction-summary"), who).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("summary-sold"), who).toContainText("2");
    await expect(page.getByTestId("summary-teams"), who).toContainText("Team Alpha");
  }
  await expect(ownerA.page.getByTestId("auction-summary")).toContainText(
    "Congratulations, Team Alpha",
  );
  await expect(ownerA.page.getByRole("link", { name: "Watch the replay" })).toBeVisible();

  await spectatorCtx.close();
  await ownerA.ctx.close();
  await ownerB.ctx.close();
  await organizerCtx.close();
});

test("accessibility and small screens on the night's surfaces", async ({ browser, page }) => {
  // The completed auction from the journey above stays on the record.
  await otpLogin(page, ORGANIZER);
  await page.goto(`/seasons/${slug}/auction`);
  await expect(page.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  const lobbyScan = await new AxeBuilder({ page }).analyze();
  expect(lobbyScan.violations, JSON.stringify(lobbyScan.violations, null, 2)).toEqual([]);

  await page.goto(liveUrl);
  await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("auction-summary")).toBeVisible({ timeout: 20_000 });
  const liveScan = await new AxeBuilder({ page }).analyze();
  expect(liveScan.violations, JSON.stringify(liveScan.violations, null, 2)).toEqual([]);

  // Anonymous spectator at phone size: readable, no horizontal scroll.
  const mobile = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const phoneView = await mobile.newPage();
  try {
    await phoneView.goto(spectateUrl);
    await expect(phoneView.getByTestId("spectate-panel")).toHaveAttribute("data-hydrated", "true", {
      timeout: 30_000,
    });
    await expect(phoneView.getByTestId("auction-summary")).toBeVisible({ timeout: 20_000 });
    const spectateScan = await new AxeBuilder({ page: phoneView }).analyze();
    expect(spectateScan.violations, JSON.stringify(spectateScan.violations, null, 2)).toEqual([]);
    const offenders = await phoneView.evaluate(() => {
      const limit = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth <= limit) {
        return [];
      }
      return Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((el) => el.getBoundingClientRect().right > limit + 1)
        .slice(0, 6)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 50)}`);
    });
    expect(offenders, offenders.join(" | ")).toEqual([]);
  } finally {
    await mobile.close();
  }
});
