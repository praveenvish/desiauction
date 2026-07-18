import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// M-IP4-3 FOUNDER DEMONSTRATION: conduct & ceremony. Organizer invites a team
// owner → grants a paddle → owner claims → auction opens from the COCKPIT →
// live bids → gavel → compensating UNDO → ledger → replay viewer → engine
// restart → recovery dashboard → spectator joins → auction completes. Every
// browser converges to the same AuctionSnapshot; axe scans every new surface.

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
  const inbox = await page.context().newPage();
  await inbox.goto(`/dev/inbox?phone=${encodeURIComponent(`+91${phone}`)}`);
  const code = await inbox.getByTestId(`code-+91${phone}`).first().textContent();
  await inbox.close();
  await page.getByLabel(`Code sent to +91${phone}`).fill(code ?? "");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function axeClean(page: Page, surface: string): Promise<void> {
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations, `${surface}: ${JSON.stringify(scan.violations, null, 2)}`).toEqual([]);
}

function playersCsv(stamp: string): string {
  const header = "name,phone,role,base_price_band";
  const rows = Array.from({ length: 3 }, (_, i) => {
    const phone = `9${stamp}${i}`.slice(0, 10);
    return `Ceremony Player ${i},${phone},batter,C`;
  });
  return [header, ...rows].join("\n");
}

test("conduct & ceremony: owner workflow, cockpit, undo, ledger, replay, recovery, spectator", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  // Fresh per ATTEMPT (not per file): a retry must never reuse phones — OTP
  // issuance for a just-used number rate-limits and the login would stall.
  const STAMP = String(Date.now()).slice(-8);

  // --- Stage: org → competition → 2 teams → 3 players → auction ---------------
  const organizerCtx = await browser.newContext();
  const organizer = await organizerCtx.newPage();
  await otpLogin(organizer, `86${STAMP}`);
  await organizer.goto("/orgs");
  await organizer.getByLabel("Organization name").fill(`Ceremony Org ${STAMP}`);
  await organizer.getByRole("button", { name: "Create organization" }).click();
  await expect(organizer.getByTestId("org-name")).toBeVisible();

  await organizer.goto("/competitions");
  await organizer.getByLabel("Competition name").fill(`Ceremony Cup ${STAMP}`);
  await organizer.getByLabel("Location").fill("Powai");
  await organizer.getByLabel("Starts on").fill("2026-08-01");
  await organizer.getByLabel("Ends on").fill("2026-09-15");
  await organizer.getByRole("button", { name: "Create competition" }).click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("draft");
  const slug = new URL(organizer.url()).pathname.split("/")[2] ?? "";
  for (const team of ["Arrows", "Blasters"]) {
    await organizer.getByLabel("Team name").fill(team);
    await organizer.getByTestId("add-team").click();
    await expect(organizer.locator(".team-name", { hasText: team })).toBeVisible();
  }
  await organizer.getByTestId("advance-status").click(); // setup
  await expect(organizer.getByTestId("competition-status")).toHaveText("setup");
  await organizer.getByTestId("advance-status").click(); // open registration
  await expect(organizer.getByTestId("competition-status")).toHaveText("registration open");
  await organizer.getByTestId("open-dashboard").click();
  await expect(organizer.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await organizer.getByTestId("import-textarea").evaluate((el, csv) => {
    (el as HTMLTextAreaElement).value = csv;
  }, playersCsv(STAMP));
  await organizer.getByTestId("import-preview-btn").click();
  await expect(organizer.getByTestId("import-preview")).toContainText("3 valid", {
    timeout: 20_000,
  });
  await organizer.getByTestId("import-commit").click();
  await expect(organizer.getByTestId("stat-total")).toContainText("3", { timeout: 20_000 });
  await organizer.getByLabel("Select all on page").check();
  await organizer.getByTestId("bulk-approve").click();
  await expect(organizer.getByTestId("stat-approved")).toContainText("3");
  await organizer.goto(`/competitions/${slug}`);
  await organizer.getByTestId("advance-status").click();
  await expect(organizer.getByTestId("competition-status")).toHaveText("registration closed");
  await organizer.getByTestId("open-auction").click();
  await expect(organizer.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await organizer.getByTestId("create-auction").click();
  await expect(organizer.getByTestId("auction-status")).toHaveText("scheduled", {
    timeout: 20_000,
  });

  // --- Owner workflow: invite → accept → grant → claim, for both teams --------
  await organizer.goto(`/competitions/${slug}/auction/cockpit`);
  await expect(organizer.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await axeClean(organizer, "cockpit");

  const joinUrls: string[] = [];
  for (const team of ["Arrows", "Blasters"]) {
    await organizer.getByLabel("Team").selectOption({ label: team });
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
    await otpLogin(page, `85${STAMP.slice(0, 6)}${String(i)}0`);
    await page.goto(joinUrls[i] as string);
    await expect(page.getByTestId("owner-join-card")).toBeVisible();
    await page.getByTestId("accept-owner-invite").click();
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", {
      timeout: 30_000,
    });
    // No grant yet: the claim UI refuses to exist (production rule visible).
    await expect(page.getByTestId("no-grant-hint")).toBeVisible();
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
    await page.goto(`/competitions/${slug}/auction/live`);
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", {
      timeout: 30_000,
    });
    await page.getByLabel("Team").selectOption({ label: teamOfOwner[i] as string });
    await page.getByTestId("claim-paddle").click();
    await expect(page.getByTestId("my-paddle")).toBeVisible({ timeout: 20_000 });
  }

  // --- Conduct from the cockpit: queue, open auction, open L001 ----------------
  await organizer.reload();
  await expect(organizer.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await organizer.getByTestId("cockpit-queue-lots").click();
  await expect(organizer.getByTestId("queue-L001")).toBeVisible({ timeout: 20_000 });
  await organizer.getByTestId("cockpit-open-auction").click();
  await expect(organizer.getByTestId("ribbon-status")).toHaveText("live", { timeout: 20_000 });
  await organizer.getByTestId("open-L001").click();
  await expect(organizer.getByTestId("ceremony")).toHaveAttribute("data-phase", "opening", {
    timeout: 20_000,
  });

  // A spectator screen joins mid-night: read-only ceremony, no conduct anywhere.
  const bigScreen = await organizerCtx.newPage();
  await bigScreen.goto(`/competitions/${slug}/auction/spectate`);
  await expect(bigScreen.getByTestId("spectate-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await expect(bigScreen.getByTestId("status-ribbon")).toBeVisible();
  await expect(bigScreen.getByTestId("ceremony")).toBeVisible();
  // Spectator isolation: no conduct surface exists on this page.
  await expect(bigScreen.getByTestId("conduct-panel")).toHaveCount(0);
  await expect(bigScreen.getByTestId("cockpit-panel")).toHaveCount(0);
  await axeClean(bigScreen, "spectate");

  // --- Live bids: owner A bids, owner B outbids; every window converges --------
  const [ownerA, ownerB] = owners as [Page, Page];
  await ownerA.getByTestId("bid-next").click();
  for (const page of [organizer, ownerA, ownerB, bigScreen]) {
    await expect(page.getByTestId("ribbon-bid")).toContainText("Arrows", { timeout: 20_000 });
  }
  await ownerB.getByTestId("bid-next").click();
  for (const page of [organizer, ownerA, ownerB, bigScreen]) {
    await expect(page.getByTestId("ribbon-bid")).toContainText("Blasters", { timeout: 20_000 });
  }

  // --- Gavel → SOLD ceremony → compensating UNDO → back on the block ----------
  await organizer.getByTestId("cockpit-gavel").click();
  await expect(organizer.getByTestId("ceremony")).toHaveAttribute("data-phase", "sold", {
    timeout: 20_000,
  });
  await expect(bigScreen.getByTestId("ceremony")).toHaveAttribute("data-phase", "sold", {
    timeout: 20_000,
  });
  await organizer.getByTestId("cockpit-undo").click();
  await expect(organizer.getByTestId("ceremony")).toHaveAttribute("data-phase", "reopened", {
    timeout: 20_000,
  });
  // The purse restored on EVERY surface (compensation, not deletion).
  await expect(bigScreen.getByTestId("spectate-team-P02")).toContainText("₹2,00,00,000", {
    timeout: 20_000,
  });
  // Owner A takes the lead on the reopened lot right away (bidding restarts
  // from the base — prior money is voided-but-visible).
  await ownerA.getByTestId("bid-next").click();
  await expect(organizer.getByTestId("ribbon-bid")).toContainText("Arrows", { timeout: 20_000 });
  // Anti-snipe: owner B outbids inside the final 15s — the timer extends and
  // the ceremony announces it everywhere.
  await expect
    .poll(
      async () => {
        const text = (await organizer.getByTestId("ribbon-timer").textContent()) ?? "";
        const seconds = Number.parseInt(text.replace("s", ""), 10);
        // ≥6s of runway: under parallel-suite load the click → server-action →
        // engine round trip must still land before expiry closes the lot.
        return Number.isFinite(seconds) && seconds <= 14 && seconds > 6;
      },
      { timeout: 40_000, intervals: [250] },
    )
    .toBe(true);
  await ownerB.getByTestId("bid-next").click();
  await expect(organizer.getByTestId("ceremony")).toHaveAttribute("data-phase", "extension", {
    timeout: 20_000,
  });
  await expect(bigScreen.getByTestId("ceremony")).toHaveAttribute("data-phase", "extension", {
    timeout: 20_000,
  });
  await organizer.getByTestId("cockpit-gavel").click();
  await expect(organizer.getByTestId("ceremony")).toHaveAttribute("data-phase", "sold", {
    timeout: 20_000,
  });

  // --- The ledger: the sale, the undo pair, the re-sale — all visible ----------
  const ledgerPage = await organizerCtx.newPage();
  await ledgerPage.goto(`/competitions/${slug}/auction/ledger`);
  await expect(ledgerPage.getByTestId("ledger-table")).toBeVisible();
  await expect(ledgerPage.getByTestId("ledger-meta")).toContainText("immutable, append-only");
  const ledgerBody = ledgerPage.getByTestId("ledger-table");
  await expect(ledgerBody).toContainText("SOLD");
  await expect(ledgerBody).toContainText("UNDO — lot reopened");
  await expect(ledgerBody).toContainText("Bid voided");
  await expect(ledgerBody).toContainText("Owner invited");
  await expect(ledgerBody).toContainText("Paddle grant issued");
  await axeClean(ledgerPage, "ledger");

  // --- Replay viewer: scrub history, final frame identical to the engine -------
  await ledgerPage.goto(`/competitions/${slug}/auction/replay`);
  await expect(ledgerPage.getByTestId("replay-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await expect(ledgerPage.getByTestId("replay-convergence")).toContainText("identical bytes", {
    timeout: 20_000,
  });
  // Scrub to the beginning and back — pure visualization, nothing mutates.
  await ledgerPage.getByTestId("replay-slider").fill("1");
  await expect(ledgerPage.getByTestId("replay-status")).toHaveText("scheduled");
  await ledgerPage
    .getByTestId("replay-slider")
    .fill((await ledgerPage.getByTestId("replay-slider").getAttribute("max")) ?? "1");
  await expect(ledgerPage.getByTestId("replay-convergence")).toContainText("identical bytes");
  await axeClean(ledgerPage, "replay");

  // --- Engine restart + recovery dashboard ------------------------------------
  const reset = await organizer.request.post(`${ENGINE}/admin/reset`, {
    headers: { "x-engine-secret": ENGINE_SECRET },
    data: {},
  });
  expect(reset.ok()).toBe(true);
  await ledgerPage.goto(`/competitions/${slug}/auction/engine`);
  await expect(ledgerPage.getByTestId("engine-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await expect(ledgerPage.getByTestId("engine-health")).toHaveText("healthy", { timeout: 20_000 });
  await expect(ledgerPage.getByTestId("diag-recovery-status")).toHaveText("verified");
  await expect(ledgerPage.getByTestId("diag-watchdog")).toHaveText("ticking");
  await expect(ledgerPage.getByTestId("diag-projection")).toHaveText("verified");
  const version = await ledgerPage.getByTestId("diag-version").textContent();
  expect(Number(version)).toBeGreaterThan(10);
  await expect(ledgerPage.getByTestId("diag-snapshot-hash")).not.toHaveText("…");
  await axeClean(ledgerPage, "engine");

  // --- Close out the night: withdraw the pool remainder, complete --------------
  await organizer.reload();
  await expect(organizer.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  for (const lot of ["L002", "L003"]) {
    await organizer.getByTestId(`withdraw-${lot}`).click();
    await expect(organizer.getByTestId(`queue-${lot}`)).toHaveCount(0, { timeout: 20_000 });
  }
  await organizer.getByTestId("cockpit-complete").click();
  await expect(organizer.getByTestId("ribbon-status")).toHaveText("completed", {
    timeout: 20_000,
  });
  // Every window converges on the completed snapshot — no divergence.
  for (const page of [ownerA, ownerB, bigScreen]) {
    await expect(page.getByTestId("ribbon-status")).toHaveText("completed", { timeout: 20_000 });
  }
  const versions = await Promise.all(
    [organizer, ownerA, ownerB, bigScreen].map(
      async (page) => (await page.getByTestId("ribbon-version").textContent()) ?? "",
    ),
  );
  expect(new Set(versions).size).toBe(1);

  for (const page of owners) {
    await page.context().close();
  }
  await organizerCtx.close();
});
