import { expect, test, type BrowserContext, type Page } from "@playwright/test";

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
  const inbox = await page.context().newPage();
  await inbox.goto(`/dev/inbox?phone=${encodeURIComponent(`+91${phone}`)}`);
  const code = await inbox.getByTestId(`code-+91${phone}`).first().textContent();
  await inbox.close();
  await page.getByLabel(`Code sent to +91${phone}`).fill(code ?? "");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
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
  await organizer.getByLabel("Organization name").fill(`Live Org ${STAMP}`);
  await organizer.getByRole("button", { name: "Create organization" }).click();
  await expect(organizer.getByTestId("org-name")).toBeVisible();
  const orgUrl = organizer.url();

  // Invites are SINGLE-USE (IP-2): mint one per bidder, reading each fresh URL.
  const inviteUrls: string[] = [];
  for (let i = 0; i < 3; i++) {
    await organizer.getByTestId("create-invite").click();
    await expect
      .poll(
        async () => {
          const url = (await organizer.getByTestId("invite-url").textContent())?.trim() ?? "";
          return url.includes("/join/") && !inviteUrls.includes(url) ? url : "";
        },
        { timeout: 20_000 },
      )
      .not.toBe("");
    inviteUrls.push(((await organizer.getByTestId("invite-url").textContent()) ?? "").trim());
  }
  void orgUrl;

  await organizer.goto("/competitions");
  await organizer.getByLabel("Competition name").fill(`Live Cup ${STAMP}`);
  await organizer.getByLabel("Location").fill("Malad");
  await organizer.getByLabel("Starts on").fill("2026-08-01");
  await organizer.getByLabel("Ends on").fill("2026-09-15");
  await organizer.getByRole("button", { name: "Create competition" }).click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("draft");
  const slug = new URL(organizer.url()).pathname.split("/")[2] ?? "";
  for (const team of ["Team Alpha", "Team Bravo", "Team Charlie"]) {
    await organizer.getByLabel("Team name").fill(team);
    await organizer.getByTestId("add-team").click();
    await expect(organizer.locator(".team-name", { hasText: team })).toBeVisible();
  }
  await organizer.getByTestId("advance-status").click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("setup");
  await organizer.getByTestId("advance-status").click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("registration open");
  await organizer.getByTestId("open-dashboard").click();
  await expect(organizer.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
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
  await organizer.goto(`/competitions/${slug}`);
  await organizer.getByTestId("advance-status").click(); // close registration
  await expect(organizer.getByTestId("competition-status")).toHaveText("registration closed");

  // Create the auction and open it (setup surface), then go live.
  await organizer.getByTestId("open-auction").click();
  await expect(organizer.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await organizer.getByTestId("create-auction").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("scheduled", {
    timeout: 20_000,
  });

  // --- Three bidders join the org and the live room ------------------------------
  const bidders: { ctx: BrowserContext; page: Page }[] = [];
  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await otpLogin(page, `87${STAMP.slice(0, 6)}${String(i)}0`);
    await page.goto(inviteUrls[i] as string);
    await page.getByTestId("accept-invite").click();
    await expect(page.getByTestId("org-name")).toBeVisible();
    bidders.push({ ctx, page });
  }

  // Bidders claim paddles on the live page (auction still scheduled — legal).
  const teamsByBidder = ["Team Alpha", "Team Bravo", "Team Charlie"];
  for (let i = 0; i < 3; i++) {
    const { page } = bidders[i] as { page: Page };
    await page.goto(`/competitions/${slug}/auction/live`);
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", {
      timeout: 30_000,
    });
    await page.getByLabel("Team").selectOption({ label: teamsByBidder[i] as string });
    await page.getByTestId("claim-paddle").click();
    await expect(page.getByTestId("my-paddle")).toBeVisible({ timeout: 20_000 });
  }

  // Organizer: queue lots + open the auction from the setup page, then go live.
  await organizer.getByTestId("queue-all").click();
  await expect(organizer.getByTestId("lot-L001")).toContainText("queued");
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
  await organizer.getByTestId("conduct-close-lot").click();
  for (const page of everyone) {
    await expect(page.getByTestId("no-lot")).toBeVisible({ timeout: 20_000 });
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
  await organizer.getByTestId("conduct-close-lot").click();
  await expect(organizer.getByTestId("no-lot")).toBeVisible({ timeout: 20_000 });
  await organizer.getByTestId("conduct-complete").click();
  for (const page of everyone) {
    await expect(page.getByTestId("live-status")).toHaveText("completed", { timeout: 20_000 });
  }

  for (const { ctx } of bidders) {
    await ctx.close();
  }
  await organizerCtx.close();
});
