import { mkdirSync } from "node:fs";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { latestOtp } from "./otp";

/*
 * SOCIAL CAPTURE — reel 06, "Ek link." (not a test; it lives here, never in e2e/).
 * Adapted from e2e/public-registration.spec.ts. An organiser opens registration
 * for a fictional season and shares one link; players sign themselves up from
 * their phones (name, role); the organiser's list fills up and they approve.
 * Fictional club, first-name-only players. Screenshots of real screens only.
 *
 *   cp docs/brand/social-launch/reels/capture-ek-link.spec.ts apps/web/e2e/zz-capture.spec.ts
 *   (cd apps/web && OUT=../docs/brand/social-launch/reels/.work/ek-link PLAYWRIGHT_PRECOMPILED=1 NEXT_DIST_DIR=.next-e2e \
 *     npx playwright test e2e/zz-capture.spec.ts --project=chromium); rm apps/web/e2e/zz-capture.spec.ts
 */

const OUT = process.env["OUT"] ?? "/tmp/ek-link-capture";
const STAMP = String(Date.now()).slice(-8);
const COLD = { timeout: 30_000 } as const;
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
/** Organisers run this from a phone: their screens are shot at phone width too. */
const ORG_PHONE = { width: 430, height: 932 };
const PLAYERS: [string, string][] = [
  ["Arjun", "Batter"],
  ["Kabir", "Bowler"],
  ["Rehan", "All-rounder"],
  ["Vikram", "Wicket-keeper"],
  ["Sahil", "Batter"],
  ["Dev", "Bowler"],
  ["Ishaan", "All-rounder"],
];

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

async function otpLogin(page: Page, phone: string, name: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", COLD);
  await page.getByLabel("6-digit code").clear();
  await page.getByLabel("6-digit code").pressSequentially(await latestOtp(phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/, COLD);
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill(name);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
}

/** One player: the shared link → verify → name → role → consent → submitted. */
async function register(
  browser: Browser,
  registerUrl: string,
  phone: string,
  name: string,
  role: string,
  shots: boolean,
): Promise<void> {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await page.goto(registerUrl);
  await expect(page.getByTestId("register-preview")).toBeVisible(COLD);
  if (shots) await shot(page, "reg-landing");
  const here = page.url();
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByTestId("register-verify-cta").click();
  await expect(page.getByTestId("register-verify-form")).toHaveAttribute("data-step", "code", COLD);
  await page.getByLabel("6-digit code").clear();
  await page.getByLabel("6-digit code").pressSequentially(await latestOtp(phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(here, COLD);
  await expect(page.getByTestId("register-step-profile")).toBeVisible(COLD);
  await page.getByLabel("Your name").fill(name);
  if (shots) await shot(page, "reg-name");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: role, exact: true }).check();
  if (shots) await shot(page, "reg-role");
  await page.getByTestId("register-continue").click();
  await expect(page.getByTestId("register-step-review")).toBeVisible(COLD);
  await page.getByTestId("register-consent").check();
  if (shots) await shot(page, "reg-review");
  await page.getByTestId("register-submit").click();
  await expect(page.getByTestId("registration-submitted")).toBeVisible(COLD);
  if (shots) await shot(page, "reg-submitted");
  await page.goto("about:blank").catch(() => {});
  await ctx.close();
}

async function orgShot(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", COLD);
  await shot(page, name);
}

test("capture: ek link (reel 06)", async ({ browser }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  const orgCtx = await browser.newContext({ viewport: ORG_PHONE, deviceScaleFactor: 3 });
  const org = await orgCtx.newPage();
  await otpLogin(org, `87${STAMP}`, "Sunday Organiser");

  await org.goto("/orgs");
  await org.getByTestId("new-org").click();
  await org.getByLabel("Club name").filter({ visible: true }).fill("Sunday League");
  await org.getByRole("button", { name: "Create club" }).click();
  await expect(org.getByTestId("org-name")).toBeVisible();

  await org.goto("/seasons");
  await org.getByTestId("new-season").click();
  await org.getByLabel("Season name").filter({ visible: true }).fill("Sunday Cup");
  await org.getByLabel("Location").fill("Pune");
  await org.getByLabel("Starts on").fill("2026-11-01");
  await org.getByLabel("Ends on").fill("2026-11-15");
  await org.getByRole("button", { name: "Create season" }).click();
  await expect(org.getByTestId("competition-status")).toHaveText("draft");
  const seasonUrl = new URL(org.url()).pathname;
  const registerUrl = `${seasonUrl}/register`;
  await org.getByTestId("advance-status").click();
  await expect(org.getByTestId("competition-status")).toHaveText("setup");
  await org.getByTestId("advance-status").click();
  await expect(org.getByTestId("competition-status")).toHaveText("registration open");
  // Published, so the shared link shows the season (the public page, not a login wall).
  await org.getByTestId("toggle-visibility").click();
  await org.getByTestId("confirm-publish").click();
  await expect(org.getByTestId("visibility-row")).toContainText("Live");
  await shot(org, "season-open");

  // The organiser's share block: "Registration is open — share this link".
  await orgShot(org, `${seasonUrl}/registrations`, "list-0");
  const share = org.getByTestId("share-registration");
  await share.scrollIntoViewIfNeeded();
  await org.waitForTimeout(500);
  await share.screenshot({ path: `${OUT}/share-link.png` });

  // Players sign up from the link; the first one is shot step by step.
  for (const [i, [name, role]] of PLAYERS.entries()) {
    await register(browser, registerUrl, `88${STAMP.slice(0, 6)}${String(i)}1`, name, role, i === 0);
    if (i === 0) await orgShot(org, `${seasonUrl}/registrations`, "list-1");
    if (i === 3) await orgShot(org, `${seasonUrl}/registrations`, "list-4");
  }
  await orgShot(org, `${seasonUrl}/registrations`, "list-7");

  // The organiser approves them all (at phone width the list's select-all is
  // hidden; the review card's "Approve all 7" is the phone's way).
  await org.getByRole("button", { name: /Approve all/ }).click();
  await expect(org.getByTestId("stat-approved")).toContainText("7", COLD);
  await shot(org, "list-approved");
});
