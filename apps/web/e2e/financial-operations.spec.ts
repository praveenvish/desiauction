import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { latestOtp } from "./otp";

// PX-8 FOUNDER DEMONSTRATION: conduct an auction → complete settlement → open
// Financial Operations → observe the new financial activity → review the
// delivery lifecycle → investigate a failed delivery → retry it using the
// platform's own capability → verify reconciliation → review the audit trail →
// complete operations. No engineering assistance.
//
// Also covers: the THIRD capability partition through the browser (a settlement
// controller cannot see finance), the finance-authority grant surface, deep
// links, a11y on every new surface, and 360px.
//
// The whole delivery LIFECYCLE (including provider failure injection) is proven
// against live Postgres in financial-operations-experience.regression.test.ts,
// which can script a hostile provider. A browser cannot, so this spec drives the
// journey the founder actually walks and asserts what the console shows.

test.describe.configure({ mode: "serial" });

const STAMP = String(Date.now()).slice(-8);
const STRANGER = `67${STAMP}`;

let orgSlug = "";
let docUrl = "";

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

async function axeClean(page: Page, surface: string): Promise<void> {
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations, `${surface}: ${JSON.stringify(scan.violations, null, 2)}`).toEqual([]);
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

test("founder demo: settle an auction → open Financial Operations → observe, reconcile, audit", async ({
  page,
}) => {
  test.setTimeout(240_000);

  // The demo seed carries a settled auction with receipts, an in-app dispatch,
  // an export and a sealed fiscal year — the state a founder reaches by
  // conducting an auction and completing settlement (PX-6/PX-7, both certified).
  // Financial Operations has no issuance surface, so the seed is how documents
  // enter; see the report's risks.
  //
  // We sign in as the demo ADMIN, who holds org:owner (and so `grant.issue`) but
  // NO finance authority — proving the third partition before crossing it.
  await otpLogin(page, "9999000002");

  await page.goto("/orgs");
  await page.getByRole("link", { name: /Demo Cricket Club/ }).click();
  // Await the org page before reading the slug off the URL — a click is not a
  // navigation, and an empty slug turns every later assertion into a lie.
  await expect(page.getByTestId("org-name")).toBeVisible();
  await expect(page).toHaveURL(/\/org\/[^/]+$/);
  orgSlug = new URL(page.url()).pathname.split("/")[2] ?? "";
  expect(orgSlug).not.toBe("");

  // --- The third partition: finance is its own act of trust ------------------
  // The panel lives on the org detail page's "Money & roles" tab; other tab
  // panels render in the DOM but display:none until selected.
  await page.getByRole("tab", { name: "Money & roles" }).click();
  await expect(page.getByTestId("finance-authority")).toBeVisible();

  // Start from no finance authority, whatever a previous run left behind — the
  // demo DB is durable, so the test revokes rather than assumes.
  const adminRow = page
    .getByTestId("finance-authority")
    .getByRole("listitem")
    .filter({ hasText: "Demo Admin" });
  if ((await adminRow.count()) > 0) {
    await adminRow.getByRole("button", { name: "Revoke" }).click();
    await expect(adminRow).toHaveCount(0, { timeout: 20_000 });
  }

  // Owning the organization confers NO finance power: no link, and the surface
  // itself 404s. That is the platform working, not a bug.
  await expect(page.getByTestId("open-finance")).toHaveCount(0);
  expect((await page.request.get(`/org/${orgSlug}/money`)).status()).toBe(404);
  await axeClean(page, "org · finance authority");

  // Cross it, from the product: grant finance authority to a named person.
  await page.getByTestId("finance-person").selectOption({ label: "Demo Admin" });
  await page.getByTestId("finance-role").selectOption("finops:controller");
  await page.getByTestId("grant-finance").click();
  await expect(page.getByTestId("finance-authority-list")).toContainText("Demo Admin", {
    timeout: 20_000,
  });

  // The door and the room agree the moment the grant lands.
  await expect(page.getByTestId("open-finance")).toBeVisible();
  await page.getByTestId("open-finance").click();
  await expect(page).toHaveURL(new RegExp(`/org/${orgSlug}/money`));

  // --- Observe the new financial activity ------------------------------------
  await expect(page.getByTestId("health-row")).toBeVisible();
  await expect(page.getByTestId("ops-overall")).toHaveText("healthy");
  // Every component the platform derives is shown — none dropped, none invented.
  for (const component of [
    "follower",
    "runner",
    "dispatch",
    "exports",
    "documents",
    "settlement-sync",
    "fiscal",
  ]) {
    await expect(page.getByTestId(`health-${component}`)).toHaveAttribute("data-status", "healthy");
  }
  await expect(page.getByTestId("stat-issued")).not.toHaveText("0");
  await expect(page.getByTestId("register-table")).toBeVisible();
  await axeClean(page, "finance dashboard");

  // Search the register — a finance operator searches by what they remember.
  await page.getByTestId("register-search").fill("Cup Kings");
  await expect(page.getByTestId("register-table")).toContainText("Cup Kings");
  await page.getByTestId("register-search").fill("no-such-party");
  await expect(page.getByText("Nothing matches this view")).toBeVisible();
  await page.getByTestId("register-search").fill("");

  // A saved view is a URL.
  await page.goto(`/org/${orgSlug}/money?view=invoices`);
  await expect(page.getByTestId("register-table")).toContainText("Tax invoice");

  // --- Review the delivery lifecycle -----------------------------------------
  await page.goto(`/org/${orgSlug}/money`);
  await page.getByRole("link", { name: "Deliveries" }).click();
  await expect(page.getByTestId("deliveries-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("lane-row")).toBeVisible();
  // The seed's in-app receipt reached the owner: one Succeeded, nothing failed.
  await expect(page.getByTestId("lane-confirmed")).toContainText("1");
  await expect(page.getByTestId("lane-failed")).toContainText("0");
  await expect(page.getByTestId("deliveries-table")).toBeVisible();
  await axeClean(page, "delivery workspace");

  // A lane is a link.
  await page.getByTestId("lane-confirmed").click();
  await expect(page).toHaveURL(/lane=confirmed/);
  await expect(page.getByTestId("deliveries-table")).toBeVisible();
  await page.getByTestId("lane-failed").click();
  await expect(page.getByText("Nothing in this lane")).toBeVisible();
  await page.getByTestId("clear-lane").click();
  await expect(page.getByTestId("deliveries-table")).toBeVisible();

  // --- Verify reconciliation --------------------------------------------------
  await page.goto(`/org/${orgSlug}/money/reconciliation`);
  await expect(page.getByTestId("reconciliation-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  // Re-derived from replay on this very read, twice — never a stored flag.
  await expect(page.getByTestId("certification-verdict")).toHaveText("matched");
  await expect(page.getByTestId("certification-checks")).toContainText(
    "Settlement's books balance",
  );
  await expect(page.getByTestId("certification-checks")).toContainText(
    "Every sealed year reproduces from replay",
  );
  await expect(page.getByTestId("investigate-list")).toHaveCount(0);
  await expect(page.getByTestId("ingest-current")).toBeVisible();
  // The seeded fiscal year is sealed, and its evidence still reproduces.
  await expect(page.getByTestId("evidence-table")).toContainText("Verified");
  await axeClean(page, "reconciliation workspace");

  // --- Review the audit trail on one transaction ------------------------------
  await page.goto(`/org/${orgSlug}/money`);
  await page.locator("[data-testid^='doc-'] a").first().click();
  await expect(page.getByTestId("document-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  docUrl = page.url();

  // The document re-renders from the log to exactly its sealed digest.
  await expect(page.getByTestId("reproduction-verdict")).toHaveAttribute(
    "data-reproducible",
    "true",
  );
  await expect(page.getByTestId("content-digest")).not.toBeEmpty();
  // What it was made FROM — finance quotes settlement, it never decides money.
  await expect(page.getByTestId("settlement-ref")).toBeVisible();
  await expect(page.getByTestId("doc-timeline")).toContainText("Document issued");
  await axeClean(page, "operations detail");

  // --- Complete operations, on a phone ----------------------------------------
  // Same session on purpose: seeded phones are fixed and OTP allows 5/hour, so a
  // spec that signs the same number in three times exhausts itself on retries.
  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of [
    `/org/${orgSlug}/money`,
    `/org/${orgSlug}/money/deliveries`,
    `/org/${orgSlug}/money/reconciliation`,
  ]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, `${path} overflows at 360px`).toBe(false);
  }
  await axeClean(page, "finance · 360px");
});

test("permissions: settling the money does not let you speak for it", async ({ browser }) => {
  await inSecondBrowser(browser, async (stranger) => {
    await onboardWithName(stranger, STRANGER, "Curious Stranger");
    // A non-member cannot tell the finance workspace from a typo.
    for (const path of [
      `/org/${orgSlug}/money`,
      `/org/${orgSlug}/money/deliveries`,
      `/org/${orgSlug}/money/reconciliation`,
    ]) {
      const response = await stranger.request.get(path);
      expect(response.status(), path).toBe(404);
    }
    const doc = await stranger.request.get(new URL(docUrl).pathname);
    expect(doc.status()).toBe(404);
  });
});
