import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { latestOtp, resetOtpBudget } from "./otp";

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
  // These specs sign in as the FIXED demo identities, so across a long run they
  // exhaust the product's five-codes-per-number-per-hour limit and the login
  // form silently never leaves the phone step. Clearing the harness's own
  // consumption keeps the limit intact where it matters (see otp.ts).
  await resetOtpBudget(phone);

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
    // The row's own "Revoke" only opens a confirmation dialog — a money
    // authority is not removed on one click. The dialog's own Revoke,
    // testid `confirm-revoke-finance`, is the action.
    await adminRow.getByRole("button", { name: "Revoke" }).click();
    await page.getByTestId("confirm-revoke-finance").click();
    await expect(adminRow).toHaveCount(0, { timeout: 20_000 });
    // The money door's HREF is decided on the server from the viewer's finance
    // capability, so it is whatever it was when this page was rendered — which
    // was before the revoke. Reload, or the next assertion reads a stale link
    // and reports a partition failure that is really a cache.
    await page.reload();
  }

  // Owning the organization confers NO finance power: no link, and the surface
  // itself 404s. That is the platform working, not a bug.
  // The 404 above IS the assertion. There used to be a second half — "and no
  // link" — but settlement and finance now share one door whose destination is
  // decided by the ORG's finance state, not the viewer's, so its href says
  // nothing about this person's authority. Asserting on it tested the wrong
  // thing; the surface refusing the request tests the right one.
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
  await expect(page.getByTestId("open-money-ops")).toHaveAttribute(
    "href",
    new RegExp(`/org/${orgSlug}/money$`),
  );
  await page.getByTestId("open-money-ops").click();
  await expect(page).toHaveURL(new RegExp(`/org/${orgSlug}/money`));

  // --- Observe the new financial activity ------------------------------------
  await expect(page.getByTestId("health-row")).toBeVisible();
  // Healthy because the finops RUNNER is running — globalSetup starts it now.
  // Without it this board is honestly degraded ("settlement ingest 5 events
  // behind", "job runner: nothing picked up for 26 days") and this assertion
  // could never pass: production runs three services and the harness ran two.
  // POLL, DO NOT SNAPSHOT. The runner ticks on its own clock, and this board is
  // server-rendered — so the page can legitimately be a tick behind the world it
  // is describing. Reload until every component agrees, then assert each one,
  // rather than asserting once against whichever instant the render caught.
  await expect
    .poll(
      async () => {
        const statuses = await page
          .getByTestId("health-row")
          .locator("[data-status]")
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-status")));
        if (statuses.length > 0 && statuses.every((status) => status === "healthy")) {
          return true;
        }
        await page.reload();
        return false;
      },
      { timeout: 40_000, intervals: [2_000] },
    )
    .toBe(true);
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
  /*
   * TWO ASSERTIONS, IN THIS ORDER, ON PURPOSE.
   *
   * Clearing the box calls `router.replace` with `q` deleted — no debounce, one
   * replace per input event — and then the server re-renders the register. The
   * `goto` below was being cancelled by that replace on WebKit.
   *
   * The URL is what the component controls, so it is asserted first: if it does
   * not clear, the fault is the input handler. The register repopulating is the
   * consequence, asserted second: if the URL clears and the rows do not come
   * back, that is a real defect and this line is where it surfaces — which is
   * why the wait is NOT hidden behind a single combined assertion.
   */
  await expect(page).toHaveURL(/\/money\?*$/, { timeout: 20_000 });
  await expect(page.getByTestId("register-table")).toContainText("Cup Kings", { timeout: 20_000 });

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
  // `waitForURL`, not `toHaveURL`: the lane is a <Link>, so this is a client
  // navigation to wait for rather than a value to poll.
  await page.waitForURL(/lane=confirmed/);
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
  // Certification is re-derived by the RUNNER on its own cadence, and the last
  // writes of this journey land moments before this read — so the first render
  // can legitimately catch "not certified yet" or a pass taken mid-write.
  // Reload until it settles; if it settles on "not matched" that is a real
  // finding and this will still fail.
  await expect
    .poll(
      async () => {
        const verdict = await page.getByTestId("certification-verdict").textContent();
        if (verdict === "matched") {
          return verdict;
        }
        await page.reload();
        return verdict;
      },
      { timeout: 60_000, intervals: [3_000] },
    )
    .toBe("matched");
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
