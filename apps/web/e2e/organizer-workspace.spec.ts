import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { clearNameGate } from "./onboarding";
import { latestOtp } from "./otp";

// PX-4 Organizer Workspace: the founder demo (org → competition → approve →
// teams → venues → fixtures → readiness → "Ready for auction"), the permission
// attack, invalid workflows, and a11y on the new surfaces.

const STAMP = String(Date.now()).slice(-8);
const ORGANIZER = `96${STAMP}`;
const PLAYER = `97${STAMP}`;
const VIEWER = `98${STAMP}`;

// Later tests operate on the founder demo's data — one worker, in order.
test.describe.configure({ mode: "serial" });

let orgUrl = "";
let competitionUrl = "";

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
  // PX-3: the name gate now guards every console route, not just /home — a
  // fresh account that stops here never reaches the org/tournament screens
  // this helper is used to reach.
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill("E2E Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
}

/**
 * A fresh account's FIRST login, choosing its own name.
 *
 * Deliberately not `otpLogin` + an onboarding assertion — `otpLogin` already
 * consumes the onboarding step itself (auto-filling "E2E Tester") so every
 * caller lands somewhere it can act on the console right away. Calling it here
 * and then asserting `/onboarding` was asserting a URL `otpLogin` had already
 * left; it could never pass. This is the bare sign-in sequence with the name
 * gate answered by the caller instead of the helper.
 */
async function onboardWithName(page: Page, phone: string, name: string): Promise<void> {
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
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("What should we call you?").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/home/);
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

test("founder demo: org → competition → approve → team roster → venue → fixtures → READY", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  await onboardWithName(page, ORGANIZER, "Priya Organizer");
  // Organizations are born where the work is: /orgs, not the onboarding wizard.
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page
    .getByLabel("Organization name")
    .filter({ visible: true })
    .fill(`Workspace CC ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toHaveText(`Workspace CC ${STAMP}`);
  orgUrl = page.url();

  // Venue + ground first (fixtures need an active ground).
  await page.goto(`${orgUrl}/venues`);
  await expect(page.getByTestId("venues-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await page.getByLabel("Venue name").fill("Azad Maidan");
  await page.getByLabel("City").fill("Mumbai");
  await page.getByTestId("add-venue").click();
  await expect(page.getByTestId("venue-name")).toHaveText("Azad Maidan", { timeout: 20_000 });
  await page.getByRole("button", { name: "Add a ground" }).click();
  await page.getByLabel("Ground name").fill("Main Oval");
  await page.getByTestId("add-ground").click();
  await expect(page.getByRole("cell", { name: "Main Oval" })).toBeVisible();

  // Competition with dates (lifecycle guard) → open registration.
  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Workspace Cup ${STAMP}`);
  await page.getByLabel("Location").fill("Malad, Mumbai");
  await page.getByLabel("Starts on").fill("2026-08-01");
  await page.getByLabel("Ends on").fill("2026-09-15");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-status")).toHaveText("draft");
  competitionUrl = page.url();
  await page.getByTestId("advance-status").click();
  await expect(page.getByTestId("competition-status")).toHaveText("setup");
  await page.getByTestId("advance-status").click();
  await expect(page.getByTestId("competition-status")).toHaveText("registration open");

  // Readiness Center exists from day one and names the blockers.
  await page.getByTestId("open-readiness").click();
  await expect(page).toHaveURL(/\/readiness$/);
  await expect(page.getByTestId("readiness-verdict")).not.toHaveText("Ready for auction");
  await expect(page.getByTestId("check-teams_present")).toContainText("Blocked");

  // Team workspace: create two teams via the new tab.
  await page
    .getByRole("navigation", { name: "Season sections" })
    .getByRole("link", { name: "Teams" })
    .click();
  await expect(page).toHaveURL(/\/teams$/);
  for (const [name, short] of [
    ["Malad Mavericks", "MAV"],
    ["Kandivali Kings", "KK"],
  ] as const) {
    await page.getByTestId("open-add-team").click();
    await page.getByLabel("Team name").filter({ visible: true }).fill(name);
    await page.getByLabel("Short name").fill(short);
    await page.getByTestId("add-team-workspace").click();
    await expect(page.getByTestId("teams-list")).toContainText(name);
  }
  await expect(page.getByTestId("teams-count")).toContainText("2 teams");

  // A player registers from a second browser.
  await inSecondBrowser(browser, async (playerPage) => {
    await playerPage.goto(`${competitionUrl}/register`);
    await expect(playerPage).toHaveURL(/\/login\?next=/);
    await otpLogin(playerPage, PLAYER);
    // PX-5 multi-step flow: profile → role → review → submit (a fresh
    // account is nameless, so the profile step comes first).
    await playerPage.getByLabel("Your name").fill("Player Two");
    await playerPage.getByRole("button", { name: "Continue" }).click();
    await playerPage.getByLabel("Playing role").selectOption("batter");
    await playerPage.getByTestId("register-continue").click();
    // The publication-consent checkbox is an affirmative act the register
    // flow requires before Submit does anything — see register-flow.tsx.
    await playerPage.getByTestId("register-consent").check();
    await playerPage.getByTestId("register-submit").click();
    await expect(playerPage.getByTestId("registration-submitted")).toBeVisible();
  });

  // Registration workspace: the Submitted stat tile is a one-click view;
  // approve, then assign to a team from the expanded row.
  await page.goto(`${competitionUrl}/registrations`);
  await page.getByTestId("stat-submitted").click();
  await expect(page).toHaveURL(/status=submitted/);
  await page.getByLabel("Select all on page").check();
  await page.getByTestId("bulk-approve").click();
  await expect(page.getByTestId("stat-approved")).toContainText("1", { timeout: 15_000 });
  await page.getByTestId("stat-approved").click();
  await expect(page).toHaveURL(/status=approved/);
  await page.getByRole("button", { name: "Details" }).first().click();
  await expect(page.getByTestId("assign-team-row")).toBeVisible();
  await page.getByLabel("Assign to team").selectOption({ label: "Malad Mavericks" });
  await page.getByTestId("assign-team").click();
  await expect(page.getByTestId("reg-table")).toContainText("Malad Mavericks");

  // Team roster shows the assignment (URL-addressed, server-rendered) — open
  // the roster of the team we assigned to, not whichever sorts first.
  await page.goto(`${competitionUrl}/teams`);
  await page
    .locator(".team-card", { hasText: "Malad Mavericks" })
    .getByRole("link", { name: "Prepare roster" })
    .click();
  // PX-5: registration captures names — the roster shows the person, not a number.
  await expect(page.getByTestId("roster-list")).toContainText("Player Two");

  // Close registration, generate → schedule → publish fixtures.
  await page.goto(competitionUrl);
  await page.getByTestId("advance-status").click();
  await expect(page.getByTestId("competition-status")).toHaveText("registration closed");
  await page.goto(`${competitionUrl}/fixtures`);
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await page.getByLabel("Start date").fill("2026-08-01");
  await page.getByLabel("Kickoff times").fill("18:00,20:00");
  await page.getByRole("checkbox", { name: /Main Oval/ }).check();
  await page.getByTestId("generate-fixtures").click();
  // Generation previews before it writes; confirm it.
  await page.getByTestId("confirm-generate").click();
  await expect(page.getByTestId("fixtures-table")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("schedule-all").click();
  await page.getByTestId("publish-all").click();

  // Readiness: create the auction, arrive at READY.
  await page.goto(`${competitionUrl}/readiness`);
  await expect(page.getByTestId("check-intake_closed")).toContainText("Pass");
  await expect(page.getByTestId("check-teams_present")).toContainText("Pass");
  await expect(page.getByTestId("check-pool_present")).toContainText("Pass");
  await expect(page.getByTestId("readiness-fixtures")).toContainText("published");
  await page.goto(`${competitionUrl}/auction`);
  // Feasibility: these fixtures run a handful of players against squads of 8,
  // which the setup screen now refuses until the shortfall is accepted on the
  // record (it is the state that used to become an unclosable auction).
  await page.getByTestId("accept-short-squads").check();
  await page.getByTestId("create-auction").click();
  await page.goto(`${competitionUrl}/readiness`);
  await expect(page.getByTestId("readiness-verdict")).toHaveText("Ready for auction");
});

test("permissions attack: a viewer sees, but cannot act", async ({ browser, page }) => {
  // The organizer from the founder demo invites a viewer.
  await otpLogin(page, ORGANIZER);
  await page.goto("/orgs");
  // The card is a link; the name inside it is a span, and clicking the span
  // navigates nowhere. Click the link.
  await page
    .getByTestId("orgs-list")
    .locator("a", { hasText: `Workspace CC ${STAMP}` })
    .first()
    .click();
  await expect(page).toHaveURL(/\/org\//);
  // The invite form lives behind the Members tab, in a dialog. Reaching for its
  // Select from the org overview waits for something that is not on screen yet.
  await page.getByRole("tab", { name: "Members" }).click();
  await page.getByTestId("open-invite").click();
  await page.getByLabel("They join as").selectOption("viewer");
  await page.getByTestId("create-invite").click();
  const inviteUrl = await page.getByTestId("invite-url").textContent();
  expect(inviteUrl).toContain("/join/");

  await inSecondBrowser(browser, async (viewerPage) => {
    await viewerPage.goto(inviteUrl ?? "");
    await otpLogin(viewerPage, VIEWER);
    await viewerPage.getByTestId("accept-invite").click();
    // A first-time member is asked their name once, and the invitation's
    // destination survives it — so they land in the org they just joined
    // rather than on /home.
    await clearNameGate(viewerPage, "Workspace Viewer");
    await expect(viewerPage.getByTestId("org-name")).toHaveText(`Workspace CC ${STAMP}`);

    const base = new URL(competitionUrl).pathname;
    // Registrations: read is refused politely, never a crash.
    await viewerPage.goto(`${base}/registrations`);
    // The page carries more than one live region — the refusal itself and the
    // shell's (empty) toast region — so `getByRole("alert")` is ambiguous here.
    // Assert the sentence the viewer actually reads.
    await expect(
      viewerPage.getByText(/don.t have permission to review registrations/i),
    ).toBeVisible();
    // Teams: list visible, creation absent.
    await viewerPage.goto(`${base}/teams`);
    await expect(viewerPage.getByTestId("teams-list")).toBeVisible();
    await expect(viewerPage.getByTestId("open-add-team")).not.toBeVisible();
    // Overview: lifecycle button absent for viewers.
    await viewerPage.goto(base);
    await expect(viewerPage.getByTestId("advance-status")).not.toBeVisible();
  });
});

test("invalid workflows: bad team names are refused; unknown slugs 404", async ({ page }) => {
  await otpLogin(page, ORGANIZER);
  const base = new URL(competitionUrl).pathname;
  await page.goto(`${base}/teams`);
  await page.getByTestId("open-add-team").click();
  await page.getByLabel("Team name").filter({ visible: true }).fill("ab");
  await page.getByTestId("add-team-workspace").click();
  await expect(page.getByRole("dialog")).toContainText(/name/i);

  const missing = await page.goto("/seasons/does-not-exist/readiness");
  expect(missing?.status()).toBe(404);
  const missingTeams = await page.goto("/seasons/does-not-exist/teams");
  expect(missingTeams?.status()).toBe(404);
});

test("organizer search: palette reaches sections and venues", async ({ page }) => {
  await otpLogin(page, ORGANIZER);
  await page.goto(new URL(competitionUrl).pathname);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("readiness");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/readiness$/);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("venues");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/venues$/);
});

test("accessibility: teams and readiness scan clean", async ({ page }) => {
  await otpLogin(page, ORGANIZER);
  const base = new URL(competitionUrl).pathname;
  await page.goto(`${base}/teams`);
  await expect(page.getByTestId("teams-count")).toBeVisible();
  const teamsScan = await new AxeBuilder({ page }).analyze();
  expect(teamsScan.violations, JSON.stringify(teamsScan.violations, null, 2)).toEqual([]);
  await page.goto(`${base}/readiness`);
  await expect(page.getByTestId("readiness-sections")).toBeVisible();
  const readinessScan = await new AxeBuilder({ page }).analyze();
  expect(readinessScan.violations, JSON.stringify(readinessScan.violations, null, 2)).toEqual([]);
});
