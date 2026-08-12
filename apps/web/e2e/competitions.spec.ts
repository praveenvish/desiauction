import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { latestOtp } from "./otp";

// M-IP3-1 founder journey: create an organization, create a competition, walk
// its lifecycle to open registration, add a team, register a player from a
// second device, and approve them from the triage queue. The tangible new
// capability the directive demands — a competition run end-to-end.

const STAMP = String(Date.now()).slice(-8);
const PHONE_ORG = `86${STAMP}`;
const PHONE_PLAYER = `87${STAMP}`;

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
  // Signed-in landing is never the login page itself (avoid matching /competitions
  // that appears inside a ?next= query string on a still-unauthenticated /login).
  await expect(page).not.toHaveURL(/\/login/);
  // PX-3: the name gate now guards every console route, not just /home — a
  // fresh account that stops here never reaches the org/competition screens
  // this helper is used to reach.
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill("E2E Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
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

test("the competition journey: create, open, team, register, approve", async ({
  browser,
  page,
}) => {
  // Organizer signs in and creates an organization (IP-2 surface).
  await otpLogin(page, PHONE_ORG);
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`Comp Org ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toHaveText(`Comp Org ${STAMP}`);

  // Create a competition with dates + location (so the lifecycle guard passes).
  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`MPL ${STAMP}`);
  await page.getByLabel("Location").fill("Malad, Mumbai");
  await page.getByLabel("Starts on").fill("2026-08-01");
  await page.getByLabel("Ends on").fill("2026-08-15");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-name")).toHaveText(`MPL ${STAMP}`);
  const competitionUrl = page.url();

  // Walk the lifecycle: draft → setup → registration_open (one gate at a time).
  await expect(page.getByTestId("competition-status")).toHaveText("draft");
  await page.getByTestId("advance-status").click(); // Begin setup
  await expect(page.getByTestId("competition-status")).toHaveText("setup");
  await page.getByTestId("advance-status").click(); // Open registration
  await expect(page.getByTestId("competition-status")).toHaveText("registration open");

  // Add a team — team management lives in the Teams tab.
  await page.goto(`${competitionUrl}/teams`);
  await page.getByTestId("open-add-team").click();
  await page.getByLabel("Team name").filter({ visible: true }).fill("Malad Mavericks");
  await page.getByTestId("add-team-workspace").click();
  await expect(page.getByTestId("teams-list")).toContainText("Malad Mavericks");

  // The registration link is live; a second person registers as a player.
  const registerUrl = `${competitionUrl}/register`;
  await inSecondBrowser(browser, async (playerPage) => {
    await playerPage.goto(registerUrl);
    await expect(playerPage).toHaveURL(/\/login\?next=/);
    await otpLogin(playerPage, PHONE_PLAYER);
    await playerPage.goto(registerUrl);
    // PX-5 multi-step flow: profile → role → review → submit (a fresh
    // account is nameless, so the profile step comes first).
    await playerPage.getByLabel("Your name").fill("Player One");
    await playerPage.getByRole("button", { name: "Continue" }).click();
    await playerPage.getByLabel("Playing role").selectOption("all_rounder");
    await playerPage.getByTestId("register-continue").click();
    await playerPage.getByTestId("register-submit").click();
    await expect(playerPage.getByTestId("registration-submitted")).toBeVisible();
  });

  // The organizer sees the registration in triage and approves it — triage
  // lives in the Registrations tab.
  await page.goto(`${competitionUrl}/registrations`);
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  const triage = page.getByTestId("reg-table");
  await expect(triage).toContainText(`+91${PHONE_PLAYER}`);
  await expect(triage).toContainText("submitted");
  await triage.getByRole("button", { name: "Approve" }).first().click();
  await expect(triage).toContainText("approved");
});

test("registration is refused before intake opens", async ({ browser, page }) => {
  const stamp = String(Date.now()).slice(-8);
  await otpLogin(page, `88${stamp}`);
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`Closed Org ${stamp}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();

  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Closed Cup ${stamp}`);
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-status")).toHaveText("draft");
  const registerUrl = `${page.url()}/register`;

  // A player hitting the register link on a draft competition is told it's closed.
  await inSecondBrowser(browser, async (playerPage) => {
    await playerPage.goto(registerUrl);
    await otpLogin(playerPage, `89${stamp}`);
    await playerPage.goto(registerUrl);
    await expect(playerPage.getByTestId("registration-closed")).toBeVisible();
  });
});

test("competitions pages: axe zero violations", async ({ page }) => {
  await otpLogin(page, `85${STAMP}`);
  await page.goto("/seasons");
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual([]);
});
