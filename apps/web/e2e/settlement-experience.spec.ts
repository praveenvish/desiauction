import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { latestOtp } from "./otp";

// PX-7 FOUNDER DEMONSTRATION: complete an auction → open the Settlement
// Workspace → review the case → verify → record a manual payment → waive one
// obligation → close the case → view the closure evidence → replay it →
// settlement complete. No developer assistance, no SQL, no spreadsheet.
//
// Also covers: the capability partition through the BROWSER (an org owner with
// no settlement grant cannot see the books at all), the money-authority grant
// surface, the dashboard's saved views and search, deep links, invalid
// transitions, a11y on every new surface, and the 360px phone layout.
//
// The `committed` basis (dues folded from real sales) is proven against a REAL
// conducted auction in settlement-experience.regression.test.ts. This spec uses
// the `fixed` basis so the journey stays about SETTLEMENT rather than re-running
// an auction night that conduct-ceremony.spec.ts already certifies.

test.describe.configure({ mode: "serial" });

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

async function onboardWithName(page: Page, phone: string, name: string): Promise<void> {
  await otpLogin(page, phone);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("What should we call you?").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/home/);
}

/** A click before React attaches is a no-op — wait for the panel to say it is live. */
async function moneyReady(page: Page): Promise<void> {
  await expect(page.getByTestId("money-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
}

async function caseReady(page: Page): Promise<void> {
  await expect(page.getByTestId("case-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
}

async function axeClean(page: Page, surface: string): Promise<void> {
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations, `${surface}: ${JSON.stringify(scan.violations, null, 2)}`).toEqual([]);
}

function playersCsv(stamp: string): string {
  const header = "name,phone,role,base_price_band";
  const rows = Array.from({ length: 3 }, (_, i) => {
    const phone = `9${stamp}${i}`.slice(0, 10);
    return `Settle Player ${i},${phone},batter,C`;
  });
  return [header, ...rows].join("\n");
}

async function inSecondBrowser(browser: Browser, fn: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

let slug = "";
let orgSlug = "";
let caseUrl = "";
const STAMP = String(Date.now()).slice(-8);
const OWNER = `76${STAMP}`;
const TREASURER = `77${STAMP}`;

test("founder demo: complete an auction → settle it → close, prove and replay the evidence", async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);

  // --- Stage: org → competition → 2 teams → 3 players → completed auction -----
  await onboardWithName(page, OWNER, "Settlement Founder");
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`Settle Org ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();
  orgSlug = new URL(page.url()).pathname.split("/")[2] ?? "";

  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Settle Cup ${STAMP}`);
  await page.getByLabel("Location").fill("Thane");
  await page.getByLabel("Starts on").fill("2026-08-01");
  await page.getByLabel("Ends on").fill("2026-09-15");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-status")).toHaveText("draft");
  slug = new URL(page.url()).pathname.split("/")[2] ?? "";

  // Team management lives in the Teams tab.
  const seasonUrl = page.url();
  await page.goto(`${seasonUrl}/teams`);
  for (const team of ["Kings", "Chargers"]) {
    await page.getByTestId("open-add-team").click();
    await page.getByLabel("Team name").filter({ visible: true }).fill(team);
    await page.getByTestId("add-team-workspace").click();
    await expect(page.getByTestId("teams-list")).toContainText(team);
  }
  await page.goto(seasonUrl);
  await page.getByTestId("advance-status").click();
  await expect(page.getByTestId("competition-status")).toHaveText("setup");
  await page.getByTestId("advance-status").click();
  await expect(page.getByTestId("competition-status")).toHaveText("registration open");

  await page.getByTestId("open-dashboard").click();
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await page.getByTestId("open-import").click();
  await page.getByTestId("import-textarea").evaluate((el, csv) => {
    (el as HTMLTextAreaElement).value = csv;
  }, playersCsv(STAMP));
  await page.getByTestId("import-preview-btn").click();
  await expect(page.getByTestId("import-preview")).toContainText("3 valid", { timeout: 20_000 });
  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("stat-total")).toContainText("3", { timeout: 20_000 });
  await page.getByLabel("Select all on page").check();
  await page.getByTestId("bulk-approve").click();
  await expect(page.getByTestId("stat-approved")).toContainText("3");

  await page.goto(`/seasons/${slug}`);
  await page.getByTestId("advance-status").click();
  await expect(page.getByTestId("competition-status")).toHaveText("registration closed");
  await page.getByTestId("open-auction").click();
  await expect(page.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  // Feasibility: these fixtures run a handful of players against squads of 8,
  // which the setup screen now refuses until the shortfall is accepted on the
  // record (it is the state that used to become an unclosable auction).
  await page.getByTestId("accept-short-squads").check();
  await page.getByTestId("create-auction").click();
  await expect(page.getByTestId("auction-status")).toHaveText("scheduled", { timeout: 20_000 });

  // Opening needs ≥2 paddles and ≥1 queued lot; completing needs zero
  // unresolved lots. Nothing is sold: the dues are declared, not bid.
  for (const team of ["Kings", "Chargers"]) {
    await page.getByLabel("Team", { exact: true }).selectOption({ label: team });
    await page.getByTestId("issue-paddle").click();
    await expect(page.getByTestId("paddles-panel")).toContainText(team, { timeout: 20_000 });
  }
  await page.getByTestId("queue-all").click();
  await expect(page.getByTestId("lots-table")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("accept-short-open").check();
  await page.getByTestId("auction-open").click();
  await expect(page.getByTestId("auction-status")).toHaveText("live", { timeout: 20_000 });
  await page.getByTestId("auction-complete").click();
  await expect(page.getByTestId("auction-status")).toHaveText("completed", { timeout: 20_000 });

  // --- The partition: an org OWNER has no money power until it is granted -----
  // The competition's Money TAB is ABSENT, not disabled — and the surface 404s.
  // (Scoped to the tab row: the rail's own "Money" is the personal one, always there.)
  const tabRow = page.getByRole("navigation", { name: "Season sections" });
  await page.goto(`/seasons/${slug}`);
  await expect(tabRow).toBeVisible();
  await expect(tabRow.getByRole("link", { name: "Money", exact: true })).toHaveCount(0);
  const forbidden = await page.request.get(`/seasons/${slug}/money`);
  expect(forbidden.status()).toBe(404);

  // --- Money authority: grant the founder a settlement role from the product --
  await page.goto(`/org/${orgSlug}`);
  await expect(page.getByTestId("money-authority")).toBeVisible();
  await expect(page.getByTestId("money-authority")).toContainText("Nobody can settle yet");
  await axeClean(page, "org · money authority");

  await page.getByTestId("authority-person").selectOption({ label: "Settlement Founder" });
  await page.getByTestId("authority-role").selectOption("settlement:controller");
  await page.getByTestId("grant-authority").click();
  await expect(page.getByTestId("authority-list")).toContainText("Settlement controller", {
    timeout: 20_000,
  });

  // The tab and the surface agree the moment the grant lands.
  await page.goto(`/seasons/${slug}`);
  await expect(tabRow.getByRole("link", { name: "Money", exact: true })).toBeVisible();

  // --- Open the case ----------------------------------------------------------
  await page.goto(`/seasons/${slug}/money`);
  await moneyReady(page);
  await page.getByTestId("basis-select").selectOption("fixed");
  await page.getByLabel("Kings owes (₹)").fill("1,20,000");
  await page.getByLabel("Chargers owes (₹)").fill("80000");
  await page.getByTestId("open-case").click();
  await expect(page.getByTestId("case-status")).toHaveText("Opened", { timeout: 20_000 });
  await axeClean(page, "settlement console · opened");

  // --- Verify → compute -------------------------------------------------------
  await page.getByTestId("verify-case").click();
  await expect(page.getByTestId("case-status")).toHaveText("Verified", { timeout: 20_000 });
  await page.getByTestId("compute-obligations").click();
  await expect(page.getByTestId("case-status")).toHaveText("Collecting", { timeout: 20_000 });

  // The money the organizer declared is the money the case now carries.
  await expect(page.getByTestId("total-obligations")).toContainText("₹2,00,000");
  await expect(page.getByTestId("outstanding")).toContainText("₹2,00,000");
  await expect(page.getByTestId("obligations-table")).toContainText("Kings");
  await axeClean(page, "settlement console · collecting");

  // --- Record a manual payment, then attest it --------------------------------
  // The option is labelled "Kings — owes ₹1,20,000"; its value is the team id.
  const kingsOption =
    (await page
      .getByTestId("pay-team")
      .locator("option", { hasText: "Kings" })
      .getAttribute("value")) ?? "";
  await page.getByTestId("pay-team").selectOption(kingsOption);
  await page.getByTestId("pay-method").selectOption("manual:cash");
  await page.getByTestId("pay-amount").fill("1,20,000");
  await page.getByTestId("record-payment").click();
  // The gateway enums (`created`/`captured`) are no longer printed at a desk
  // where the money arrived as cash in an envelope.
  await expect(page.getByTestId("payments-table")).toContainText("Recorded", { timeout: 20_000 });

  // Recording is not collecting: nothing moves until a human attests it.
  await expect(page.getByTestId("discharged")).toContainText("₹0");
  await page.getByRole("button", { name: "Confirm received" }).first().click();
  await expect(page.getByTestId("payments-table")).toContainText("Received", { timeout: 20_000 });
  await expect(page.getByTestId("discharged")).toContainText("₹1,20,000");
  await expect(page.getByTestId("outstanding")).toContainText("₹80,000");

  // --- Waive the remaining obligation (controller, with a reason) -------------
  // Settling is refused while a rupee is outstanding — the button is not offered.
  await expect(page.getByTestId("settle-case")).toBeDisabled();

  // Kings' Waive is DISABLED — they owe nothing now. Only Chargers can be waived.
  const kingsRow = page.getByRole("row", { name: /Kings/ });
  await expect(kingsRow.getByRole("button", { name: "Waive" })).toBeDisabled();
  await page
    .getByRole("row", { name: /Chargers/ })
    .getByRole("button", { name: "Waive" })
    .click();
  // A waiver without a reason cannot be submitted: it is recorded against a name.
  await page.getByTestId("waive-amount").fill("80000");
  await expect(page.getByTestId("confirm-waive")).toBeDisabled();
  await page.getByTestId("waive-reason").fill("Sponsor covered the shortfall");
  await page.getByTestId("confirm-waive").click();
  await expect(page.getByTestId("waived")).toContainText("₹80,000", { timeout: 20_000 });
  await expect(page.getByTestId("outstanding")).toContainText("₹0");

  // --- Settle → close ---------------------------------------------------------
  // Settling locks every amount on the case, so it confirms first.
  await page.getByTestId("settle-case").click();
  await page.getByTestId("confirm-settle").click();
  await expect(page.getByTestId("case-status")).toHaveText("Settled", { timeout: 20_000 });
  await expect(page.getByTestId("closure-ready")).toBeVisible();
  await axeClean(page, "settlement console · settled");

  // Closing seals the evidence for ever — the highest-consequence act on the
  // surface, and the one that shipped with no confirmation at all.
  await page.getByTestId("close-case").click();
  await page.getByTestId("confirm-close").click();
  await expect(page.getByTestId("case-status")).toHaveText("Reconciled", { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Settlement complete" })).toBeVisible();
  await axeClean(page, "settlement console · reconciled");

  // --- The evidence, and the replay that proves it ----------------------------
  await page.getByTestId("view-evidence").click();
  await expect(page).toHaveURL(/\/money\/case\//);
  caseUrl = page.url();
  await caseReady(page);
  await expect(page.getByTestId("review-status")).toHaveText("Reconciled");

  await page.getByRole("tab", { name: "Evidence" }).click();
  await expect(page.getByTestId("evidence-grid")).toBeVisible();
  const digest = await page.getByTestId("evidence-verificationDigest").textContent();
  expect((digest ?? "").trim()).toHaveLength(64);

  await page.getByTestId("replay-evidence").click();
  await expect(page.getByTestId("replay-result")).toHaveAttribute("data-matches", "true", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("replay-result")).toContainText("byte-for-byte");
  await axeClean(page, "case review · evidence");
});

test("case review: the audit surfaces, deep-linked", async ({ page }) => {
  await otpLogin(page, OWNER);

  // A tab is a URL — "look at the evidence" is a link, not an instruction.
  await page.goto(`${caseUrl.split("?")[0] ?? ""}?tab=timeline`);
  await caseReady(page);
  await expect(page.getByTestId("review-timeline")).toBeVisible();
  await expect(page.getByTestId("review-timeline")).toContainText("Case opened");
  await expect(page.getByTestId("review-timeline")).toContainText("Case CLOSED — evidence sealed");
  // Money events read as money: a team NAME and RUPEES, never paise and a ULID.
  await expect(page.getByTestId("review-timeline")).toContainText("Kings paid ₹1,20,000");
  await expect(page.getByTestId("review-timeline")).toContainText(
    "₹80,000 of what Chargers owed was waived",
  );
  // The override's stated reason and the person who gave it.
  await expect(page.getByTestId("review-timeline")).toContainText("Sponsor covered the shortfall");
  await expect(page.getByTestId("review-timeline")).toContainText("Settlement Founder");

  await page.getByRole("tab", { name: "Payments" }).click();
  await expect(page.getByTestId("review-payments")).toContainText("Cash");
  // The attester is NAMED: the action promises "recorded against your name".
  await expect(page.getByTestId("review-payments")).toContainText(
    "confirmed by hand by Settlement Founder",
  );

  await page.getByRole("tab", { name: "Verification" }).click();
  // The pin the money stands on, and the books it moved.
  await expect(page.getByText("Auction pin")).toBeVisible();
  await expect(page.getByTestId("review-journal")).toBeVisible();

  await page.getByRole("tab", { name: "Obligations" }).click();
  await expect(page.getByTestId("review-obligations")).toContainText("Kings");
  await axeClean(page, "case review · obligations");

  // An unknown tab falls back rather than rendering nothing.
  await page.goto(`${caseUrl.split("?")[0] ?? ""}?tab=nonsense`);
  await caseReady(page);
  await expect(page.getByTestId("review-obligations")).toBeVisible();
});

test("settlement dashboard: stats, saved views, search and bulk navigation", async ({ page }) => {
  await otpLogin(page, OWNER);
  await page.goto(`/org/${orgSlug}`);
  await page.getByTestId("open-settlement").click();
  await expect(page).toHaveURL(new RegExp(`/org/${orgSlug}/settlement`));

  await expect(page.getByTestId("stat-closed")).toHaveText("1");
  await expect(page.getByTestId("stat-attention")).toHaveText("0");
  await expect(page.getByTestId("stat-outstanding")).toContainText("₹0");
  await expect(page.getByTestId("stat-today")).toContainText("₹1,20,000");

  // The default view is "needs attention" — and nothing needs attention.
  await expect(page.getByText("Nothing matches this view")).toBeVisible();

  await page.getByTestId("view-closed").click();
  await expect(page.getByTestId("case-list")).toBeVisible();
  await expect(page.getByTestId("case-list")).toContainText(`Settle Cup ${STAMP}`);
  await expect(page.getByTestId("case-list")).toContainText("₹2,00,000");

  // Search narrows; a miss says so rather than showing everything.
  await page.getByTestId("case-search").fill("nonexistent-competition");
  await expect(page.getByText("Nothing matches this view")).toBeVisible();
  await page.getByTestId("case-search").fill("Settle Cup");
  await expect(page.getByTestId("case-list")).toBeVisible();

  // The saved view is a URL a treasurer can bookmark.
  await page.goto(`/org/${orgSlug}/settlement?view=all&status=closed`);
  await expect(page.getByTestId("case-list")).toContainText(`Settle Cup ${STAMP}`);
  await axeClean(page, "settlement dashboard");

  // Bulk navigation: the whole card is the door back into the case.
  // (Scoped to the list — a `case-` prefix also matches the search field.)
  await page.getByTestId("case-list").getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/seasons/${slug}/money`));
});

test("permissions: a member with no settlement grant cannot reach the books", async ({
  browser,
}) => {
  await inSecondBrowser(browser, async (stranger) => {
    await onboardWithName(stranger, TREASURER, "Curious Stranger");
    // A non-member is indistinguishable from a non-existent competition.
    const console_ = await stranger.request.get(`/seasons/${slug}/money`);
    expect(console_.status()).toBe(404);
    const dashboard = await stranger.request.get(`/org/${orgSlug}/settlement`);
    expect(dashboard.status()).toBe(404);
    const review = await stranger.request.get(`${caseUrl.split("?")[0] ?? ""}`);
    expect(review.status()).toBe(404);
  });
});

test("responsive: the settlement console holds at 360px with no horizontal scroll", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const phone = await context.newPage();
  try {
    await otpLogin(phone, OWNER);
    await phone.goto(`/seasons/${slug}/money`);
    await moneyReady(phone);
    await expect(phone.getByTestId("case-status")).toBeVisible();

    // Money tables collapse to labelled rows rather than growing a scrollbar.
    const overflow = await phone.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await expect(phone.getByTestId("obligations-table")).toBeVisible();
    await axeClean(phone, "settlement console · 360px");

    await phone.goto(`${caseUrl.split("?")[0] ?? ""}?tab=payments`);
    await caseReady(phone);
    await expect(phone.getByTestId("review-payments")).toBeVisible();
    const reviewOverflow = await phone.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(reviewOverflow).toBe(false);
  } finally {
    await context.close();
  }
});
