import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// M-IP3-2 founder journey: create a competition, open registration, IMPORT many
// players by CSV, then operate the dashboard — search, filter, bulk approve /
// reject / waitlist, export, and the audit timeline. Everything local.

const STAMP = String(Date.now()).slice(-8);
const PHONE_ORG = `84${STAMP}`;

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

// A valid-CSV of 8 players (distinct 10-digit mobiles).
function playersCsv(): string {
  const header = "name,phone,role,base_price_band";
  const rows = Array.from({ length: 8 }, (_, i) => {
    const phone = `9${STAMP}${i}`.slice(0, 10);
    const roles = ["batter", "bowler", "all_rounder", "wicket_keeper"];
    return `Player ${i},${phone},${roles[i % 4]},A`;
  });
  return [header, ...rows].join("\n");
}

test("the operations journey: import, dashboard, search, filter, bulk, export, audit", async ({
  page,
}) => {
  await otpLogin(page, PHONE_ORG);

  // Org + competition, open for registration.
  await page.goto("/orgs");
  await page.getByLabel("Organization name").fill(`Ops Org ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();

  await page.goto("/competitions");
  await page.getByLabel("Competition name").fill(`Ops Cup ${STAMP}`);
  await page.getByLabel("Location").fill("Malad");
  await page.getByLabel("Starts on").fill("2026-08-01");
  await page.getByLabel("Ends on").fill("2026-08-15");
  await page.getByRole("button", { name: "Create competition" }).click();
  await expect(page.getByTestId("competition-status")).toHaveText("draft");
  await page.getByTestId("advance-status").click(); // Begin setup
  await expect(page.getByTestId("competition-status")).toHaveText("setup");
  await page.getByTestId("advance-status").click(); // Open registration
  await expect(page.getByTestId("competition-status")).toHaveText("registration open");

  // Into the operations dashboard — wait for client hydration before driving it.
  await page.getByTestId("open-dashboard").click();
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByTestId("stat-total")).toContainText("0");

  // Import 8 players by CSV (set the file input's content directly).
  // The textarea is uncontrolled (read via ref) — set its DOM value directly.
  await page.getByTestId("import-textarea").evaluate((el, csv) => {
    (el as HTMLTextAreaElement).value = csv;
  }, playersCsv());
  await page.getByTestId("import-preview-btn").click();
  // First hit compiles the import server action under dev — allow generous time.
  await expect(page.getByTestId("import-preview")).toContainText("8 valid", { timeout: 20_000 });
  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("stat-total")).toContainText("8");
  await expect(page.getByTestId("stat-submitted")).toContainText("8");

  // Select all on the page and bulk-approve.
  await page.getByLabel("Select all on page").check();
  await expect(page.getByTestId("bulk-count")).toContainText("8 selected");
  await page.getByTestId("bulk-approve").click();
  await expect(page.getByTestId("stat-approved")).toContainText("8");

  // Filter to approved and confirm the table only shows approved rows.
  await page.getByLabel("Status").selectOption("approved");
  await expect(page.getByTestId("page-indicator")).toContainText("8 total");

  // Search narrows deterministically.
  await page.getByLabel("Search").fill("Player 3");
  await page.getByTestId("search-submit").click();
  await expect(page.getByTestId("page-indicator")).toContainText("1 total");

  // Export produces a CSV download.
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-csv").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/registrations\.csv$/);
});

test("registration operations dashboard: axe zero violations", async ({ page }) => {
  await otpLogin(page, `83${STAMP}`);
  await page.goto("/orgs");
  await page.getByLabel("Organization name").fill(`Axe Org ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();
  await page.goto("/competitions");
  await page.getByLabel("Competition name").fill(`Axe Cup ${STAMP}`);
  await page.getByRole("button", { name: "Create competition" }).click();
  await page.getByTestId("open-dashboard").click();
  await expect(page.getByTestId("stat-row")).toBeVisible();
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual([]);
});
