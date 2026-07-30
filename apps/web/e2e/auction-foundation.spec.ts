import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// M-IP4-1 founder demonstration: AuctionReady generation, auction creation,
// paddles, the lot queue, the frozen state machines, the replay proof and the
// timer model — architecture, not excitement. No bidding UI exists.

const STAMP = String(Date.now()).slice(-8);
const PHONE_ORG = `86${STAMP}`;

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
  await page.getByLabel("6-digit code").fill(code ?? "");
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

function playersCsv(): string {
  const header = "name,phone,role,base_price_band";
  const rows = Array.from({ length: 4 }, (_, i) => {
    const phone = `9${STAMP}${i}`.slice(0, 10);
    return `Auction Player ${i},${phone},batter,A`;
  });
  return [header, ...rows].join("\n");
}

test("the foundation journey: ready gate, create, paddles, queue, machines, replay, timer", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await otpLogin(page, PHONE_ORG);

  // Competition with two teams and an approved pool, intake closed.
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`Auction Org ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();
  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Auction Cup ${STAMP}`);
  await page.getByLabel("Location").fill("Malad");
  await page.getByLabel("Starts on").fill("2026-08-01");
  await page.getByLabel("Ends on").fill("2026-09-15");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-status")).toHaveText("draft");
  // Team management lives in the Teams tab.
  const seasonUrl = page.url();
  await page.goto(`${seasonUrl}/teams`);
  for (const team of ["Andheri Arrows", "Bandra Blasters"]) {
    await page.getByTestId("open-add-team").click();
    await page.getByLabel("Team name").filter({ visible: true }).fill(team);
    await page.getByTestId("add-team-workspace").click();
    await expect(page.getByTestId("teams-list")).toContainText(team);
  }
  await page.goto(seasonUrl);
  await page.getByTestId("advance-status").click(); // setup
  await expect(page.getByTestId("competition-status")).toHaveText("setup");
  await page.getByTestId("advance-status").click(); // open registration
  await expect(page.getByTestId("competition-status")).toHaveText("registration open");

  // Import + approve the pool (the IP-3 journey, condensed).
  await page.getByTestId("open-dashboard").click();
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  await page.getByTestId("open-import").click();
  await page.getByTestId("import-textarea").evaluate((el, csv) => {
    (el as HTMLTextAreaElement).value = csv;
  }, playersCsv());
  await page.getByTestId("import-preview-btn").click();
  await expect(page.getByTestId("import-preview")).toContainText("4 valid", { timeout: 20_000 });
  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("stat-total")).toContainText("4");
  await page.getByLabel("Select all on page").check();
  await page.getByTestId("bulk-approve").click();
  await expect(page.getByTestId("stat-approved")).toContainText("4");

  // Close intake, then into the auction page: the ready gate flips to pass.
  await page.goto(`/seasons/${new URL(page.url()).pathname.split("/")[2] ?? ""}`);
  await page.getByTestId("advance-status").click(); // close registration
  await expect(page.getByTestId("competition-status")).toHaveText("registration closed");
  await page.getByTestId("open-auction").click();
  await expect(page.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", {
    timeout: 30_000,
  });
  for (const check of ["intake_closed", "pool_present", "teams_present"]) {
    await expect(page.getByTestId(`check-${check}`)).toContainText("pass");
  }

  // Create the auction: deterministic lot queue from the approved pool.
  // Feasibility: these fixtures run a handful of players against squads of 8,
  // which the setup screen now refuses until the shortfall is accepted on the
  // record (it is the state that used to become an unclosable auction).
  await page.getByTestId("accept-short-squads").check();
  await page.getByTestId("create-auction").click();
  await expect(page.getByTestId("auction-status")).toHaveText("scheduled", { timeout: 20_000 });
  await expect(page.getByTestId("lot-L001")).toContainText("prepared");
  await expect(page.getByTestId("lot-L004")).toBeVisible();

  // Paddles: immutable identity, one per team.
  for (const team of ["Andheri Arrows", "Bandra Blasters"]) {
    await page.getByLabel("Team", { exact: true }).selectOption({ label: team });
    await page.getByTestId("issue-paddle").click();
  }
  await expect(page.getByTestId("paddle-P01")).toBeVisible();
  await expect(page.getByTestId("paddle-P02")).toBeVisible();

  // Queue all lots, open the auction (guard now satisfied), pause + resume.
  await page.getByTestId("queue-all").click();
  await expect(page.getByTestId("lot-L001")).toContainText("queued");
  await page.getByTestId("accept-short-open").check();
  await page.getByTestId("auction-open").click();
  await expect(page.getByTestId("auction-status")).toHaveText("live");
  await page.getByTestId("auction-pause").click();
  await expect(page.getByTestId("auction-status")).toHaveText("paused");
  await page.getByTestId("auction-resume").click();
  await expect(page.getByTestId("auction-status")).toHaveText("live");

  // Replay visualization: fold the event log, verify the projection matches.
  await page.getByTestId("verify-replay").click();
  await expect(page.getByTestId("replay-report")).toContainText("matches persisted state", {
    timeout: 20_000,
  });
});

test("auction foundation page: axe zero violations", async ({ page }) => {
  test.setTimeout(120_000);
  await otpLogin(page, `85${STAMP}`);
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page
    .getByLabel("Organization name")
    .filter({ visible: true })
    .fill(`Axe Auction Org ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();
  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Axe Auction Cup ${STAMP}`);
  await page.getByRole("button", { name: "Create season" }).click();
  await page.getByTestId("open-auction").click();
  await expect(page.getByTestId("ready-panel")).toBeVisible({ timeout: 30_000 });
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual([]);
});
