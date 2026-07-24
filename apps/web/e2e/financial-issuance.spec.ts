import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// PX-8 COMPLETION · FOUNDER DEMONSTRATION — a FRESH organization, no demo seed,
// no SQL, no engineering assistance:
//
//   fresh org → no finance profile → declare profile → open receipt series →
//   conduct auction → complete settlement → capture payment →
//   the FOLLOWER automatically issues the receipt → it appears in the register →
//   it dispatches → Financial Operations is healthy.
//
// This is the journey PX-8 could not walk before: previously nothing could ENTER
// the financial lifecycle from the product, and the finance e2e had to read the
// demo seed. Everything below is done by one person, in a browser.

test.describe.configure({ mode: "serial" });

const STAMP = String(Date.now()).slice(-8);
const FOUNDER = `64${STAMP}`;

async function otpLogin(page: Page, phone: string): Promise<void> {
  if (!page.url().includes("/login")) {
    await page.goto("/login");
  }
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
    timeout: 30_000,
  });
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
    return `Issue Player ${i},${phone},batter,C`;
  });
  return [header, ...rows].join("\n");
}

test("founder demo: a fresh org declares finance, settles, and the platform issues the receipt itself", async ({
  page,
}) => {
  test.setTimeout(300_000);

  // --- A brand-new founder and a brand-new organization ----------------------
  await otpLogin(page, FOUNDER);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("What should we call you?").fill("Issuance Founder");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("onboarding-org")).toBeVisible();

  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`Issue Org ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();
  await expect(page).toHaveURL(/\/org\/[^/]+$/);
  const orgSlug = new URL(page.url()).pathname.split("/")[2] ?? "";
  expect(orgSlug).not.toBe("");

  // --- Grant the two authorities this journey needs, from the product --------
  await page.getByTestId("authority-person").selectOption({ label: "Issuance Founder" });
  await page.getByTestId("authority-role").selectOption("settlement:controller");
  await page.getByTestId("grant-authority").click();
  await expect(page.getByTestId("authority-list")).toContainText("Settlement controller", {
    timeout: 20_000,
  });

  await page.getByTestId("finance-person").selectOption({ label: "Issuance Founder" });
  await page.getByTestId("finance-role").selectOption("finops:controller");
  await page.getByTestId("grant-finance").click();
  await expect(page.getByTestId("finance-authority-list")).toContainText("Finance controller", {
    timeout: 20_000,
  });

  // --- NO FINANCE PROFILE: the lifecycle is shut ------------------------------
  await page.getByTestId("open-finance").click();
  await expect(page).toHaveURL(new RegExp(`/org/${orgSlug}/money`));
  await expect(page.getByTestId("profile-status")).toHaveText("not declared");
  await expect(page.getByText("Nothing can be issued yet")).toBeVisible();
  // Without a profile there is no series card and no candidates card at all.
  await expect(page.getByTestId("series-card")).toHaveCount(0);
  await expect(page.getByTestId("candidates-card")).toHaveCount(0);
  await axeClean(page, "finance · undeclared");

  // --- Declare the profile, with auto-receipt ---------------------------------
  await page.getByTestId("declare-profile").click();
  await page.getByTestId("profile-legal-name").fill(`Issue Org ${STAMP} Trust`);
  await page.getByTestId("profile-posture").selectOption("none");
  await expect(page.getByTestId("profile-auto-receipt")).toBeChecked();
  await page.getByTestId("submit-profile").click();
  await expect(page.getByTestId("profile-status")).toHaveText("v1", { timeout: 20_000 });
  await expect(page.getByTestId("auto-receipt-state")).toContainText("on");

  // --- Open the receipt series ------------------------------------------------
  await expect(page.getByTestId("series-card")).toBeVisible();
  await expect(page.getByTestId("no-receipt-series")).toBeVisible();
  await page.getByTestId("open-series").click();
  await page.getByTestId("series-kind").selectOption("receipt");
  await page.getByTestId("submit-series").click();
  await expect(page.getByTestId("series-table")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("no-receipt-series")).toHaveCount(0);
  // The platform derives the next number; the screen only shows it.
  await expect(page.locator("[data-testid^='next-receipt-']")).toContainText("RCT/");
  await expect(page.locator("[data-testid^='next-receipt-']")).toContainText("000001");
  await axeClean(page, "finance · declared");

  // --- Conduct an auction -----------------------------------------------------
  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Issue Cup ${STAMP}`);
  await page.getByLabel("Location").fill("Nagpur");
  await page.getByLabel("Starts on").fill("2026-08-01");
  await page.getByLabel("Ends on").fill("2026-09-15");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-status")).toHaveText("draft");
  const slug = new URL(page.url()).pathname.split("/")[2] ?? "";

  // Team management lives in the Teams tab.
  const seasonUrl = page.url();
  await page.goto(`${seasonUrl}/teams`);
  for (const team of ["Risers", "Royals"]) {
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
  await page.getByTestId("create-auction").click();
  await expect(page.getByTestId("auction-status")).toHaveText("scheduled", { timeout: 20_000 });
  for (const team of ["Risers", "Royals"]) {
    await page.getByLabel("Team", { exact: true }).selectOption({ label: team });
    await page.getByTestId("issue-paddle").click();
    await expect(page.getByTestId("paddles-panel")).toContainText(team, { timeout: 20_000 });
  }
  await page.getByTestId("queue-all").click();
  await expect(page.getByTestId("lots-table")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("auction-open").click();
  await expect(page.getByTestId("auction-status")).toHaveText("live", { timeout: 20_000 });
  await page.getByTestId("auction-complete").click();
  await expect(page.getByTestId("auction-status")).toHaveText("completed", { timeout: 20_000 });

  // --- Complete settlement, and CAPTURE a payment -----------------------------
  await page.goto(`/seasons/${slug}/money`);
  await expect(page.getByTestId("money-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await page.getByTestId("basis-select").selectOption("fixed");
  await page.getByLabel("Risers owes (₹)").fill("50000");
  await page.getByTestId("open-case").click();
  await expect(page.getByTestId("case-status")).toHaveText("Opened", { timeout: 20_000 });
  await page.getByTestId("verify-case").click();
  await expect(page.getByTestId("case-status")).toHaveText("Verified", { timeout: 20_000 });
  await page.getByTestId("compute-obligations").click();
  await expect(page.getByTestId("case-status")).toHaveText("Collecting", { timeout: 20_000 });

  const risers =
    (await page
      .getByTestId("pay-team")
      .locator("option", { hasText: "Risers" })
      .getAttribute("value")) ?? "";
  await page.getByTestId("pay-team").selectOption(risers);
  await page.getByTestId("pay-method").selectOption("manual:cash");
  await page.getByTestId("pay-amount").fill("50000");
  await page.getByTestId("record-payment").click();
  await expect(page.getByTestId("payments-table")).toContainText("created", { timeout: 20_000 });

  // THE CAPTURE — the fact the whole financial lifecycle hangs from.
  await page.getByRole("button", { name: "Attest receipt" }).first().click();
  await expect(page.getByTestId("payments-table")).toContainText("captured", { timeout: 20_000 });
  await expect(page.getByTestId("discharged")).toContainText("₹50,000");

  // --- Finance names it as awaiting a receipt ---------------------------------
  await page.goto(`/org/${orgSlug}/money`);
  await expect(page.getByTestId("candidates-table")).toContainText("Risers", { timeout: 30_000 });
  await expect(page.getByTestId("stat-awaiting")).toHaveText("1");

  // --- THE POLICY ISSUES IT ----------------------------------------------------
  // No issue button is pressed. The follower is the platform's own ingest; the
  // runner calls it on a tick, and Reconciliation offers the same run to a human.
  await page.goto(`/org/${orgSlug}/money/reconciliation`);
  await expect(page.getByTestId("reconciliation-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await page.getByTestId("run-follower").click();
  await expect(page.getByTestId("ingest-current")).toBeVisible({ timeout: 30_000 });

  // --- The receipt appears in the register, issued by nobody -------------------
  await page.goto(`/org/${orgSlug}/money`);
  await expect(page.getByTestId("stat-awaiting")).toHaveText("0", { timeout: 30_000 });
  await expect(page.getByTestId("stat-issued")).toHaveText("1");
  await expect(page.getByTestId("register-table")).toContainText("Receipt");
  await expect(page.getByTestId("register-table")).toContainText("Risers");
  // The lane advanced: 1 issued, next is 2. Dense, no gap.
  await expect(page.locator("[data-testid^='next-receipt-']")).toContainText("000002");

  // --- It reproduces from the log, and carries its settlement reference --------
  await page.locator("[data-testid^='doc-'] a").first().click();
  await expect(page.getByTestId("document-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("reproduction-verdict")).toHaveAttribute(
    "data-reproducible",
    "true",
  );
  await expect(page.getByTestId("settlement-ref")).toContainText("payment");
  await expect(page.getByTestId("doc-timeline")).toContainText("Document issued");
  await axeClean(page, "finance · auto-issued document");

  // --- Financial Operations is healthy ----------------------------------------
  await page.goto(`/org/${orgSlug}/money`);
  await expect(page.getByTestId("ops-overall")).toHaveText("healthy", { timeout: 30_000 });
  for (const component of ["follower", "documents", "settlement-sync", "dispatch"]) {
    await expect(page.getByTestId(`health-${component}`)).toHaveAttribute("data-status", "healthy");
  }

  await page.goto(`/org/${orgSlug}/money/reconciliation`);
  await expect(page.getByTestId("certification-verdict")).toHaveText("matched", {
    timeout: 30_000,
  });
});
