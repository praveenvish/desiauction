import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { latestOtp } from "./otp";

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

/*
 * A GOOGLE FORM EXPORT, IN THE SHAPE ONE ARRIVES IN.
 *
 * Headers are the form's QUESTIONS, the first two columns are the form's own
 * bookkeeping, roles are spelled the way people write them, and dates are
 * dd/mm/yyyy. Before column mapping existed this file was refused at line 1
 * with "Missing required column(s): name, phone, role" and imported nobody.
 */
function googleFormCsv(options: { withSizes?: boolean } = {}): string {
  const header =
    "Timestamp,Email Address,Player Name,Mobile Number,Which role do you play?,Date of Birth" +
    (options.withSizes === true ? ",T-shirt size" : "");
  const spellings = ["Batsman", "Fast Bowler", "All Rounder", "Wicket Keeper Batsman"];
  const rows = Array.from({ length: 4 }, (_, i) => {
    const phone = `7${STAMP}${i}`.slice(0, 10);
    return [
      "15/03/2026 14:32:11",
      `player${String(i)}@example.com`,
      `Form Player ${String(i)}`,
      phone,
      spellings[i % 4],
      "15/03/1998",
      ...(options.withSizes === true ? ["L"] : []),
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

test("the operations journey: import, dashboard, search, filter, bulk, export, audit", async ({
  page,
}) => {
  await otpLogin(page, PHONE_ORG);

  // Org + competition, open for registration.
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`Ops Org ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();

  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Ops Cup ${STAMP}`);
  await page.getByLabel("Location").fill("Malad");
  await page.getByLabel("Starts on").fill("2026-08-01");
  await page.getByLabel("Ends on").fill("2026-08-15");
  await page.getByRole("button", { name: "Create season" }).click();
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
  await page.getByTestId("open-import").click();
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
  // The SHELL gained a global search trigger whose aria-label is also "Search",
  // so a bare label match now resolves to two elements. This one means the
  // page's own filter box.
  await page.getByRole("textbox", { name: "Search" }).fill("Player 3");
  await page.getByTestId("search-submit").click();
  await expect(page.getByTestId("page-indicator")).toContainText("1 total");

  // Export produces a CSV download.
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-csv").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/registrations\.csv$/);
});

// A real 1×1 PNG — the media path validates the content type, not the pixels.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/*
 * MEDIA_STORAGE=local WRITES INTO public/, AND A BUILT SERVER DOES NOT SERVE
 * WHAT WAS WRITTEN AFTER THE BUILD.
 *
 * `next start` serves public/ from the manifest it captured at build time, so a
 * photo uploaded during the run 404s and the <img> never paints — the test fails
 * on a property of the harness, not of the product. That local path is DEV/e2e
 * only by design (ARCHITECTURE R4); production PUTs to a bucket and this whole
 * class of problem does not exist there.
 *
 * Runs against `next dev`, where CI's nightly runs it.
 */
test("an organizer adds one player by hand, then imports their photo by filename", async ({
  page,
}) => {
  /*
   * SCOPED TO THIS TEST, and that is the fix.
   *
   * This used to be a bare `test.skip(condition, reason)` at module scope,
   * which is Playwright's FILE-level skip — so a flag meant to exclude one
   * photo test silently excluded the whole file: the CSV import journey, the
   * axe check, and the Google Form mapping test with them. Under
   * PLAYWRIGHT_PRECOMPILED the suite reported "4 skipped" and read as though
   * registration operations were covered.
   */
  test.skip(
    process.env["PLAYWRIGHT_PRECOMPILED"] === "1",
    "local media is written after the build; a built server cannot serve it",
  );
  await otpLogin(page, `82${STAMP}`);
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`Hand Org ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();

  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Hand Cup ${STAMP}`);
  await page.getByRole("button", { name: "Create season" }).click();
  await page.getByTestId("open-dashboard").click();
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true");

  // Add one player through the dialog (no CSV, no self-registration).
  await page.getByTestId("open-add-player").click();
  const addDialog = page.getByRole("dialog");
  await addDialog.getByLabel("Full name").fill("Hand Added Player");
  await addDialog.getByLabel("Mobile number").fill(`97${STAMP}`);
  await page.getByTestId("add-player-submit").click();
  // Step two only exists because the row does — the number proves it was written.
  const number = (await page.getByTestId("added-number").textContent({ timeout: 20_000 })) ?? "";
  expect(number).toMatch(/^R[A-Z0-9]{6}$/);
  await page.getByTestId("add-player-done").click();
  await expect(page.getByTestId("stat-total")).toContainText("1");
  await expect(page.getByTestId("stat-submitted")).toContainText("1");
  await expect(page.getByTestId("reg-table")).toContainText("Hand Added Player");

  // Import a photo for them by naming the file after their registration number.
  await page.getByTestId("open-import").click();
  await page.getByRole("tab", { name: "Photos" }).click();
  await page
    .getByTestId("photo-files")
    .setInputFiles([{ name: `${number}.png`, mimeType: "image/png", buffer: PNG_1PX }]);
  await expect(page.getByTestId("photo-match-table")).toContainText("Hand Added Player");
  await expect(page.getByTestId("photo-match-table")).toContainText("by reg. number");
  await page.getByTestId("photo-upload-all").click();
  // A clean batch closes the dialog itself, and the row swaps initials for the
  // uploaded image — which only renders once consent was recorded (DPDP §5).
  await expect(page.getByTestId("photo-match-table")).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId("reg-table").locator("img").first()).toBeVisible();
});

test("registration operations dashboard: axe zero violations", async ({ page }) => {
  await otpLogin(page, `83${STAMP}`);
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`Axe Org ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();
  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Axe Cup ${STAMP}`);
  await page.getByRole("button", { name: "Create season" }).click();
  await page.getByTestId("open-dashboard").click();
  await expect(page.getByTestId("stat-row")).toBeVisible();
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual([]);
});

/*
 * PHASE 1 — the file a club actually hands over goes in without anybody
 * renaming a column in a spreadsheet first.
 *
 * This is the whole feature end to end: read the file, check the mapping the
 * product guessed against the file's own sample values, preview, commit, and
 * find the players on the dashboard under the roles the FORM spelled its own
 * way.
 */
test("a Google Form export imports through the mapping step", async ({ page }) => {
  const stamp = String(Date.now()).slice(-8);
  await otpLogin(page, `76${stamp}`);

  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`Form Org ${stamp}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();

  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Form Cup ${stamp}`);
  await page.getByLabel("Location").fill("Malad");
  await page.getByLabel("Starts on").fill("2026-08-01");
  await page.getByLabel("Ends on").fill("2026-08-15");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-status")).toHaveText("draft");
  await page.getByTestId("advance-status").click();
  await page.getByTestId("advance-status").click();
  await expect(page.getByTestId("competition-status")).toHaveText("registration open");

  await page.getByTestId("open-dashboard").click();
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true");

  await page.getByTestId("open-import").click();
  await page.getByTestId("import-textarea").evaluate((el, csv) => {
    (el as HTMLTextAreaElement).value = csv;
  }, googleFormCsv());

  // One press reads the headers, maps them and validates. The mapper renders
  // beside the preview, so the translation is on screen before any commit.
  await page.getByTestId("import-preview-btn").click();
  await expect(page.getByTestId("column-mapper")).toBeVisible({ timeout: 20_000 });

  // The guess is right, and the screen SHOWS it rather than asserting it: the
  // form's own question maps to our field, with its first value beside it.
  await expect(page.getByTestId("mapping-select-2")).toHaveValue("name");
  await expect(page.getByTestId("mapping-select-3")).toHaveValue("phone");
  await expect(page.getByTestId("mapping-select-4")).toHaveValue("role");
  await expect(page.getByTestId("mapping-select-5")).toHaveValue("date_of_birth");
  // Timestamp and Email Address are the form's bookkeeping — imported nowhere.
  await expect(page.getByTestId("mapping-select-0")).toHaveValue("");
  await expect(page.getByTestId("mapping-select-1")).toHaveValue("");
  // Nothing is outstanding, so the required-field warning is absent.
  await expect(page.getByTestId("mapping-missing")).toHaveCount(0);

  await expect(page.getByTestId("import-preview")).toContainText("4 valid", { timeout: 20_000 });
  await page.getByTestId("import-commit").click();

  await expect(page.getByTestId("stat-total")).toContainText("4");
  // The roles the FORM spelled ("Batsman", "Wicket Keeper Batsman") arrived as
  // the four the product understands, and the table prints each one's PROSE
  // NAME through `lib/playing-roles`.
  //
  // This used to assert "all rounder" / "wicket keeper" — the raw stored token
  // with its underscores swapped — which is what the registration desk showed
  // before 4532c8f unified three copies of the same four words. That commit's
  // whole point was that the desk lowercased the enum "in a column between
  // Title Case badges", so the assertion was pinning the inconsistency the fix
  // removed. It survived on main because there was no e2e job in CI and the
  // local precompiled path did not work (PA-1R Phase 8.2) — nothing had run it.
  //
  // `fix/ci-green` reached the same conclusion independently and asserted it as
  // case-insensitive regexes. This merge keeps the EXACT labels, because
  // /wicket.?keeper/i matches the raw token "wicket keeper" too — it would pass
  // on a regression to precisely the state 4532c8f removed, which is the one
  // thing this assertion exists to catch.
  await expect(page.getByTestId("reg-table")).toContainText("All rounder");
  await expect(page.getByTestId("reg-table")).toContainText("Wicket-keeper");

  /*
   * PHASE 3 — the SECOND file, which is how a club actually works: the roster
   * comes once, then again with the corrections. Before this the re-import did
   * nothing at all and called the whole squad duplicates.
   */
  await page.getByTestId("open-import").click();
  await page.getByTestId("import-textarea").evaluate(
    (el, csv) => {
      (el as HTMLTextAreaElement).value = csv;
    },
    googleFormCsv({ withSizes: true }),
  );
  await page.getByTestId("import-preview-btn").click();

  // The preview now states what committing would DO, not just how many rows
  // parsed: everyone is already here, and four of them gain a size.
  await expect(page.getByTestId("import-diff-counts")).toContainText("0 new", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("import-diff-counts")).toContainText("4 changed");
  // ...and it shows the change itself, old value beside new, before any write.
  await expect(page.getByTestId("import-diff-table")).toContainText("T-shirt size");
  await expect(page.getByTestId("import-diff-table")).toContainText("(blank)");

  await page.getByTestId("import-commit").click();
  // Still four players — updated in place, never duplicated.
  await expect(page.getByTestId("stat-total")).toContainText("4");
});
