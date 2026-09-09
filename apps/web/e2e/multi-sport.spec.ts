import { expect, test, type Page } from "@playwright/test";
import { latestOtp } from "./otp";

/*
 * A SEASON THAT IS NOT CRICKET, ALL THE WAY THROUGH.
 *
 * SP-1 shipped four sport packs and every e2e in this suite created a cricket
 * season — so nothing ever asked whether the other three worked. They did not:
 * the role gates in front of the (deliberately open) `registrations.role`
 * column all asked CRICKET, so a football roster imported zero rows and adding
 * one by hand failed — and the two forms where a role is CHOSEN (the public
 * registration dropdown, the organizer's add-player dialog) were built from
 * cricket's four, so a footballer had nothing to pick in the first place.
 *
 * A suite that only ever exercises the default is a suite that cannot see a
 * default being wrong. This one picks football on purpose.
 */
const STAMP = String(Date.now()).slice(-8);
const PHONE_ORG = `82${STAMP}`;

async function otpLogin(page: Page, phone: string): Promise<void> {
  if (!page.url().includes("/login")) {
    await page.goto("/login");
  }
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code");
  const code = await latestOtp(phone);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill("E2E Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
}

/** A football roster, in the words a club's own sheet uses. */
function footballCsv(): string {
  const header = "name,phone,role";
  // "CB" is the football pack's own alias for defender. The aliases existed the
  // whole time; nothing asked the pack.
  const written = ["goalkeeper", "CB", "midfielder", "Striker"];
  const rows = written.map((role, i) => {
    const phone = `8${STAMP}${i}`.slice(0, 10);
    return `Football Player ${String(i)},${phone},${role}`;
  });
  return [header, ...rows].join("\n");
}

test("a football season admits players: the import reads the pack, not cricket", async ({
  page,
}) => {
  await otpLogin(page, PHONE_ORG);

  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`FC Org ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();

  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`FC Cup ${STAMP}`);
  // THE LINE THIS FILE EXISTS FOR.
  await page.getByLabel("Sport").selectOption("football");
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
  }, footballCsv());
  await page.getByTestId("import-preview-btn").click();

  // Every one of these lines used to read "invalid role", so the organizer's
  // only possible reading was that their roster was wrong.
  await expect(page.getByTestId("import-preview")).toContainText("4 valid", { timeout: 20_000 });
  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("stat-total")).toContainText("4");

  /*
   * And the aliases resolved to the PACK's own roles rather than the spelling
   * the file used: "CB" became defender, "Striker" became forward.
   *
   * Case-insensitively on purpose. These render lower-cased today, because the
   * dashboard calls `roleLabel`, which is `roleLabelIn(CRICKET, …)` and falls
   * back to `role.replace(/_/g, " ")` for a role cricket has never heard of.
   * That is a real defect and it is not this one — it is 48 call sites across
   * 19 files, all of which want the season's pack instead. Asserting the
   * casing here would pin the bug and make fixing it a test failure; asserting
   * the word proves what this test is for, which is that the ROLE arrived.
   */
  const table = page.getByTestId("reg-table");
  for (const role of [/goalkeeper/i, /defender/i, /midfielder/i, /forward/i]) {
    await expect(table).toContainText(role);
  }
});
