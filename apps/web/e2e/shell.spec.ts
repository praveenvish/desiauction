import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { formatPhone } from "../src/lib/format-phone";

// PX-2 Product Shell verification: authenticated landing, rail navigation,
// breadcrumbs + competition tabs, command palette, user menu, mobile chrome,
// route visibility. Permanent — every future milestone builds inside this.

const STAMP = String(Date.now()).slice(-8);
// Distinct phone per test: the OTP hourly limit (5/phone) plus retries makes
// shared numbers flaky under parallel load (PX-3 finding).
const PHONE = `84${STAMP}`;
const PHONE_PALETTE = `79${STAMP}`;

async function otpLogin(page: Page, phone: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  // First-hit dev compiles make the send slow under parallel load; allow for it.
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
    timeout: 15_000,
  });
  const inbox = await page.context().newPage();
  await inbox.goto(`/dev/inbox?phone=${encodeURIComponent(`+91${phone}`)}`);
  const code = await inbox.getByTestId(`code-+91${phone}`).first().textContent();
  await inbox.close();
  await page.getByLabel("6-digit code").fill(code ?? "");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  // First-time onboarding is one question (2026-07-24 collapse) — then /home.
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("What should we call you?").fill("Shell Tester");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/home/);
}

function rail(page: Page) {
  // The nav model renders twice (rail ≥720px, bottom tabs below); scope to the
  // visible one so assertions hold at any viewport.
  //
  // Both copies answer to "Primary" again. They had drifted apart — the mobile
  // bottom tabs were renamed "Sections" while the desktop rail stayed
  // "Primary" — and this helper was briefly widened to accept either. That hid
  // the defect rather than fixing it: one landmark with two names depending on
  // screen width, and `responsive.spec.ts` unable to find the primary
  // navigation on a phone at all. The name was put back in
  // packages/ui/src/shell/app-shell.tsx, so this asks for the one true name.
  return page.getByRole("navigation", { name: "Primary" }).locator("visible=true");
}

test("login lands on /home; the rail reaches every workspace; account is in the user menu", async ({
  page,
}) => {
  await otpLogin(page, PHONE);

  // New-account home: the shell's one h1 greets the name onboarding just
  // collected — "Welcome to DesiAuction" is the /onboarding page's own
  // heading, not /home's.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Shell Tester");

  // Rail navigation: four items. Money was pulled from the rail (DA-18) — a
  // primary nav item is a promise, and /money is still a "being built during
  // the beta" placeholder, so it stays reachable only from the season's own
  // Money tab, not the top-level rail. Help is last — it lands on the Public
  // shell (no rail), so the loop ends there and returns via URL.
  const nav = rail(page).first();
  for (const [label, url] of [
    ["Tournaments", /\/tournaments/],
    ["Organizations", /\/orgs/],
    ["Home", /\/home/],
    ["Help", /\/help/],
  ] as const) {
    await nav.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(url);
  }
  await page.goto("/home");

  // User menu → Account; signed-in phone is shown in the menu header, grouped
  // for readability ("is this YOUR number?" — format-phone.ts) rather than the
  // raw stored digit run.
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByTestId("shell-session-phone")).toHaveText(formatPhone(`+91${PHONE}`));
  await page.getByRole("menuitem", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByTestId("account-phone")).toHaveText(`+91${PHONE}`);
});

test("search navigates; the identity bar names every surface consistently", async ({ page }) => {
  await otpLogin(page, PHONE_PALETTE);

  // Search: ⌘K opens the top bar's field — keyboard-first, no modal.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("organiz");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/orgs/);

  // Create an org + competition to earn a context bar. The dialog is closed
  // until its trigger is clicked — a closed <dialog> keeps its form in the DOM
  // but display:none, so filling straight through would match nothing.
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`Shell Org ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toHaveText(`Shell Org ${STAMP}`);
  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Shell Cup ${STAMP}`);
  await page.getByLabel("Location").fill("Malad, Mumbai");
  await page.getByLabel("Starts on").fill("2026-08-01");
  await page.getByLabel("Ends on").fill("2026-08-15");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page).toHaveURL(/\/seasons\/shell-cup/);

  // Identity bar: the season IS the h1 on its overview, and its ancestor — the
  // org — is the trail above. The name is never printed twice.
  const heading = page.getByRole("heading", { level: 1 });
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(heading).toHaveText(`Shell Cup ${STAMP}`);
  await expect(breadcrumb).toContainText(`Shell Org ${STAMP}`);
  await expect(breadcrumb).not.toContainText(`Shell Cup ${STAMP}`);

  // A section below it: the section becomes the title, the season joins the trail.
  const tabs = page.getByRole("navigation", { name: "Season sections" });
  await tabs.getByRole("link", { name: "Registrations" }).click();
  await expect(page).toHaveURL(/\/registrations$/);
  await expect(heading).toHaveText("Registrations");
  await expect(breadcrumb).toContainText(`Shell Cup ${STAMP}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(tabs.getByRole("link", { name: "Registrations" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // /home now shows the competition and pins work (device-local).
  await page.goto("/home");
  await expect(page.getByTestId("home-competitions")).toContainText(`Shell Cup ${STAMP}`);
  await expect(page.getByTestId("home-recent")).toContainText(`Shell Cup ${STAMP}`);
  await page.getByRole("button", { name: `Pin Shell Cup ${STAMP}` }).click();
  await expect(page.getByTestId("home-pinned")).toContainText(`Shell Cup ${STAMP}`);

  // A second org + competition light the switchers.
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(`Shell Org B ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toHaveText(`Shell Org B ${STAMP}`);
  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Shell Cup B ${STAMP}`);
  await page.getByLabel("Location").fill("Malad, Mumbai");
  await page.getByLabel("Starts on").fill("2026-09-01");
  await page.getByLabel("Ends on").fill("2026-09-15");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page).toHaveURL(/\/seasons\/shell-cup-b/);

  // Season switcher: jump from Cup B back to the first cup.
  await page.getByRole("button", { name: "Switch season" }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^Shell Cup ${STAMP}`) }).click();
  await expect(page).toHaveURL(/\/seasons\/shell-cup-(?!b)/);

  // Org switcher: multi-org users can jump straight to an org home. It shares
  // the season switcher's slot in the top bar (one cluster, context-driven) —
  // the season switcher renders inside a season workspace, the org switcher
  // everywhere else — so it only appears once we step back out of the season.
  await page.goto("/orgs");
  await page.getByRole("button", { name: "Switch organization" }).click();
  await page.getByRole("menuitem", { name: `Shell Org B ${STAMP}` }).click();
  await expect(page).toHaveURL(/\/org\/shell-org-b/);
  await expect(page.getByTestId("org-name")).toHaveText(`Shell Org B ${STAMP}`);
});

test("mobile chrome: bottom tabs navigate and the drawer opens", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await otpLogin(page, `85${STAMP}`);
    const tabs = rail(page).last();
    await tabs.getByRole("link", { name: "Tournaments" }).click();
    await expect(page).toHaveURL(/\/tournaments/);
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Account" }).click();
    await expect(page).toHaveURL(/\/account/);
  } finally {
    await context.close();
  }
});

test("public shell wraps anonymous pages; console routes stay gated", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.goto("/help");
  await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();
  for (const route of ["/home", "/inbox", "/money"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("shell accessibility: /home and /help scan clean", async ({ page }) => {
  await otpLogin(page, `83${STAMP}`);
  // Let the route content replace the loading skeleton before scanning.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const homeScan = await new AxeBuilder({ page }).analyze();
  expect(homeScan.violations, JSON.stringify(homeScan.violations, null, 2)).toEqual([]);
  await page.goto("/help");
  await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();
  const helpScan = await new AxeBuilder({ page }).analyze();
  expect(helpScan.violations, JSON.stringify(helpScan.violations, null, 2)).toEqual([]);
});
