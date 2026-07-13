import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

// M-IP2-3 founder journey: create org -> invite via link -> second person
// accepts -> capability assignment -> ISOLATION between organizations.

const STAMP = String(Date.now()).slice(-8);
const PHONE_A = `93${STAMP}`;
const PHONE_B = `94${STAMP}`;

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
  await expect(page).toHaveURL(/\/(account|join)/);
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

test("the house journey: create, invite, accept, assign, isolate", async ({ browser, page }) => {
  // Founder A creates an organization.
  await otpLogin(page, PHONE_A);
  await page.goto("/orgs");
  await page.getByLabel("Organization name").fill(`MPL ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toHaveText(`MPL ${STAMP}`);
  const orgUrl = page.url();

  // A creates a staff invite link.
  await page.getByTestId("create-invite").click();
  const inviteUrl = await page.getByTestId("invite-url").textContent();
  expect(inviteUrl).toContain("/join/");

  // B follows the link: login gate -> join card -> accept -> lands in the org.
  await inSecondBrowser(browser, async (pageB) => {
    await pageB.goto(inviteUrl ?? "");
    await expect(pageB).toHaveURL(/\/login\?next=/);
    await otpLogin(pageB, PHONE_B);
    await expect(pageB.getByTestId("join-card")).toContainText(`MPL ${STAMP}`);
    await pageB.getByTestId("accept-invite").click();
    await expect(pageB.getByTestId("org-name")).toHaveText(`MPL ${STAMP}`);
    // B is staff: no invite panel, no grant buttons.
    await expect(pageB.getByTestId("invite-panel")).not.toBeVisible();
  });

  // A sees B as a member with the staff set and can revoke it.
  await page.reload();
  const members = page.getByTestId("members-panel");
  await expect(members).toContainText(`+91${PHONE_B}`);
  await expect(members).toContainText("org:staff");
  await page.getByRole("button", { name: "Remove staff" }).click();
  await expect(members).not.toContainText("org:staff");

  // Replay: the invite link is one-time — dead for anyone now.
  await inSecondBrowser(browser, async (pageC) => {
    await pageC.goto(inviteUrl ?? "");
    await otpLogin(pageC, PHONE_B);
    await expect(pageC.getByText("no longer valid")).toBeVisible();
  });

  // ISOLATION: B creates their own org; A cannot reach it — 404, not 403.
  let bOrgUrl = "";
  await inSecondBrowser(browser, async (pageB) => {
    await otpLogin(pageB, PHONE_B);
    await pageB.goto("/orgs");
    await pageB.getByLabel("Organization name").fill(`Rivals ${STAMP}`);
    await pageB.getByRole("button", { name: "Create organization" }).click();
    await expect(pageB.getByTestId("org-name")).toHaveText(`Rivals ${STAMP}`);
    bOrgUrl = pageB.url();
  });
  const response = await page.goto(bOrgUrl);
  expect(response?.status()).toBe(404);

  // A's own org still fine.
  await page.goto(orgUrl);
  await expect(page.getByTestId("org-name")).toHaveText(`MPL ${STAMP}`);
});

test("orgs pages: axe zero violations", async ({ page }) => {
  await otpLogin(page, `95${STAMP}`);
  await page.goto("/orgs");
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual([]);
});
