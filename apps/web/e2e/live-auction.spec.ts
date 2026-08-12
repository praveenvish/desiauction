import { expect, test, type BrowserContext, type Page } from "@playwright/test";
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

// M-IP4-2 founder demonstration: organizer + three bidder browsers run a live
// lot end to end — claim, bid, outbid, last-second anti-snipe extension, gavel,
// engine restart, reconnect — and EVERY window converges to the identical
// AuctionSnapshot. Real web server + real engine process + real WebSockets.

const STAMP = String(Date.now()).slice(-8);
const ENGINE = "http://127.0.0.1:4000";
const ENGINE_SECRET = process.env["ENGINE_SECRET"] ?? "dev-engine-secret";

async function otpLogin(page: Page, phone: string): Promise<void> {
  if (!page.url().includes("/login")) {
    await page.goto("/login");
  }
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  // Await the send completing (data-step flips only after the action commits)
  // before reading the inbox — the login.spec idiom; a bare read races the mint.
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code");
  const code = await latestOtp(phone);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  // PX-3: the name gate now guards every console route, not just /home — a
  // fresh account that stops here never reaches the org/tournament screens
  // this helper is used to reach.
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill("E2E Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
}

function playersCsv(): string {
  const header = "name,phone,role,base_price_band";
  const rows = Array.from({ length: 2 }, (_, i) => {
    const phone = `9${STAMP}${i}`.slice(0, 10);
    return `Live Player ${i},${phone},batter,C`;
  });
  return [header, ...rows].join("\n");
}

test("the live auction: 1 organizer + 3 bidders, anti-snipe, restart, convergence", async ({
  browser,
}) => {
  test.setTimeout(240_000);

  // --- Organizer sets the stage (the IP-3/M-IP4-1 journey, condensed) ----------
  const organizerCtx = await browser.newContext();
  const organizer = await organizerCtx.newPage();
  await otpLogin(organizer, `88${STAMP}`);
  await organizer.goto("/orgs");
  await organizer.getByTestId("new-org").click();
  await organizer
    .getByLabel("Organization name")
    .filter({ visible: true })
    .fill(`Live Org ${STAMP}`);
  await organizer.getByRole("button", { name: "Create organization" }).click();
  await expect(organizer.getByTestId("org-name")).toBeVisible();

  await organizer.goto("/seasons");
  await organizer.getByTestId("new-season").click();
  await organizer.getByLabel("Season name").filter({ visible: true }).fill(`Live Cup ${STAMP}`);
  await organizer.getByLabel("Location").fill("Malad");
  await organizer.getByLabel("Starts on").fill("2026-08-01");
  await organizer.getByLabel("Ends on").fill("2026-09-15");
  await organizer.getByRole("button", { name: "Create season" }).click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("draft");
  const slug = new URL(organizer.url()).pathname.split("/")[2] ?? "";
  // Team management lives in the Teams tab.
  const seasonUrl = organizer.url();
  await organizer.goto(`${seasonUrl}/teams`);
  for (const team of ["Team Alpha", "Team Bravo", "Team Charlie"]) {
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
  await organizer.getByTestId("open-dashboard").click();
  await expect(organizer.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await organizer.getByTestId("open-import").click();
  await organizer.getByTestId("import-textarea").evaluate((el, csv) => {
    (el as HTMLTextAreaElement).value = csv;
  }, playersCsv());
  await organizer.getByTestId("import-preview-btn").click();
  await expect(organizer.getByTestId("import-preview")).toContainText("2 valid", {
    timeout: 20_000,
  });
  await organizer.getByTestId("import-commit").click();
  await expect(organizer.getByTestId("stat-total")).toContainText("2");
  await organizer.getByLabel("Select all on page").check();
  await organizer.getByTestId("bulk-approve").click();
  await expect(organizer.getByTestId("stat-approved")).toContainText("2");
  await organizer.goto(`/seasons/${slug}`);
  await organizer.getByTestId("advance-status").click(); // close registration
  await expect(organizer.getByTestId("competition-status")).toHaveText("registration closed");

  // Create the auction and open it (setup surface), then go live.
  await organizer.getByTestId("open-auction").click();
  await expect(organizer.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  // Feasibility: these fixtures run a handful of players against squads of 8,
  // which the setup screen now refuses until the shortfall is accepted on the
  // record (it is the state that used to become an unclosable auction).
  await organizer.getByTestId("accept-short-squads").check();
  await organizer.getByTestId("create-auction").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("scheduled", {
    timeout: 20_000,
  });

  // --- The owner model (M-IP4-3): invitation → acceptance → grant → claim -------
  // The organizer mints one owner invitation per team from the cockpit.
  const teamsByBidder = ["Team Alpha", "Team Bravo", "Team Charlie"];
  await organizer.goto(`/seasons/${slug}/auction/cockpit`);
  await expect(organizer.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  const ownerJoinUrls: string[] = [];
  for (const team of teamsByBidder) {
    await organizer.getByLabel("Team", { exact: true }).selectOption({ label: team });
    await organizer.getByTestId("invite-owner").click();
    await expect
      .poll(
        async () => {
          const url = (await organizer.getByTestId("owner-invite-url").textContent())?.trim() ?? "";
          return url.includes("/owner-join/") && !ownerJoinUrls.includes(url) ? url : "";
        },
        { timeout: 20_000 },
      )
      .not.toBe("");
    ownerJoinUrls.push(
      ((await organizer.getByTestId("owner-invite-url").textContent()) ?? "").trim(),
    );
  }

  // Owners accept their invitations (this also makes them org members).
  const bidders: { ctx: BrowserContext; page: Page }[] = [];
  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await otpLogin(page, `87${STAMP.slice(0, 6)}${String(i)}0`);
    await page.goto(ownerJoinUrls[i] as string);
    await page.getByTestId("accept-owner-invite").click();
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", {
      timeout: 30_000,
    });
    bidders.push({ ctx, page });
  }

  // The organizer grants each accepted owner a paddle (no claim without one).
  await organizer.goto(`/seasons/${slug}/auction/cockpit`);
  await expect(organizer.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  for (const team of teamsByBidder) {
    await organizer
      .locator(".owner-row", { hasText: team })
      .getByRole("button", { name: "Grant paddle" })
      .click();
    await expect(
      organizer.locator(".owner-row", { hasText: team }).getByText("granted", { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
  }

  // Granted owners claim their paddles on the live page.
  for (let i = 0; i < 3; i++) {
    const { page } = bidders[i] as { page: Page };
    await page.goto(`/seasons/${slug}/auction/live`);
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", {
      timeout: 30_000,
    });
    await page
      .getByLabel("Team", { exact: true })
      .selectOption({ label: teamsByBidder[i] as string });
    await page.getByTestId("claim-paddle").click();
    await expect(page.getByTestId("my-paddle")).toBeVisible({ timeout: 20_000 });
  }
  // Back to the setup surface for queueing + opening (the M-IP4-1 journey).
  await organizer.goto(`/seasons/${slug}/auction`);
  await expect(organizer.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });

  // Organizer: queue lots + open the auction from the setup page, then go live.
  await organizer.getByTestId("queue-all").click();
  await expect(organizer.getByTestId("lot-L001")).toContainText("queued");
  await organizer.getByTestId("accept-short-open").check();
  await organizer.getByTestId("auction-open").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("live");
  await organizer.getByTestId("open-live").click();
  await expect(organizer.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await expect(organizer.getByTestId("connection-state")).toHaveText("open", {
    timeout: 20_000,
  });

  // Open the first lot: every window sees it with a running countdown.
  await organizer.getByTestId("conduct-open-lot").click();
  const everyone = [organizer, ...bidders.map((b) => b.page)];
  for (const page of everyone) {
    await expect(page.getByTestId("current-lot")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("countdown")).not.toHaveText("—", { timeout: 20_000 });
  }

  // Bidder A bids the minimum; every window converges on the leader.
  const [bidderA, bidderB, bidderC] = bidders.map((b) => b.page) as [Page, Page, Page];
  await bidderA.getByTestId("bid-next").click();
  for (const page of everyone) {
    await expect(page.getByTestId("leading-bid")).toContainText("Team Alpha", {
      timeout: 20_000,
    });
  }

  // Bidder B outbids; Bidder C lands the "last-second" bid — the default 30s/15s
  // window means C's bid inside the final 15s extends. To make it deterministic
  // we simply bid twice more: each acceptance near the window's edge is proven
  // by the extension counter appearing.
  await bidderB.getByTestId("bid-next").click();
  for (const page of everyone) {
    await expect(page.getByTestId("leading-bid")).toContainText("Team Bravo", {
      timeout: 20_000,
    });
  }
  // Wait until the countdown is inside the anti-snipe window, then C bids.
  await expect
    .poll(
      async () => {
        const text = (await organizer.getByTestId("countdown").textContent()) ?? "";
        const seconds = Number.parseInt(text.replace("s", ""), 10);
        return Number.isFinite(seconds) && seconds <= 14 && seconds > 2;
      },
      { timeout: 40_000, intervals: [250] },
    )
    .toBe(true);
  await bidderC.getByTestId("bid-next").click();
  for (const page of everyone) {
    await expect(page.getByTestId("leading-bid")).toContainText("Team Charlie", {
      timeout: 20_000,
    });
    // Anti-snipe executed: the extension counter shows on every window.
    await expect(page.getByTestId("current-lot")).toContainText("1 extension", {
      timeout: 20_000,
    });
  }

  // Organizer gavels the lot: sold to Team Charlie everywhere.
  await holdCloseLot(organizer);
  for (const page of everyone) {
    await expect(page.getByTestId("ceremony")).toBeVisible({ timeout: 20_000 });
  }

  // --- Engine restart: state survives, clients reconnect, windows converge ------
  const auctionsBefore = await Promise.all(
    everyone.map(async (page) => (await page.getByTestId("snapshot-version").textContent()) ?? ""),
  );
  expect(new Set(auctionsBefore).size).toBe(1); // already convergent pre-restart
  const reset = await organizer.request.post(`${ENGINE}/admin/reset`, {
    headers: { "x-engine-secret": ENGINE_SECRET },
    data: {},
  });
  expect(reset.ok()).toBe(true);
  // Open the second lot AFTER the restart-equivalent reset: the engine replays
  // from the event log, the lot opens, and every reconnected window sees it.
  await organizer.getByTestId("conduct-open-lot").click();
  for (const page of everyone) {
    await expect(page.getByTestId("current-lot")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("countdown")).not.toHaveText("—", { timeout: 20_000 });
  }
  // No divergence: every window reports the identical snapshot version.
  await expect
    .poll(
      async () => {
        const versions = await Promise.all(
          everyone.map(
            async (page) => (await page.getByTestId("snapshot-version").textContent()) ?? "",
          ),
        );
        return new Set(versions).size;
      },
      { timeout: 20_000, intervals: [500] },
    )
    .toBe(1);

  // Close it out: pass the lot (no bids), auction completes cleanly.
  await holdCloseLot(organizer);
  await expect(organizer.getByTestId("ceremony")).toBeVisible({ timeout: 20_000 });
  await organizer.getByTestId("conduct-complete").click();
  for (const page of everyone) {
    await expect(page.getByTestId("live-status")).toHaveText("completed", { timeout: 20_000 });
  }

  for (const { ctx } of bidders) {
    await ctx.close();
  }
  await organizerCtx.close();
});
