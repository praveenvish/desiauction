import { expect, test, type Page } from "@playwright/test";
import { latestOtp } from "./otp";

// RESPONSIVE CERTIFICATION (WS-9.1). The QA certification returned "Blocked"
// for every breakpoint because the browser-automation surface it used rendered
// at a fixed 1512×682 and ignored window resize. Blocked is not passed, and a
// release gate cannot rest on an untested phase — so the check moved here,
// where the viewport is ours to set.
//
// The assertion is deliberately narrow and objective: the page body must never
// scroll sideways. Wide content (tables, ledgers, boards) is allowed to scroll
// inside its own container; what is not allowed is the DOCUMENT overflowing,
// which is what makes a phone user drag the whole layout around to read it.

const STAMP = String(Date.now()).slice(-8);
const PHONE = `76${STAMP}`;

const BREAKPOINTS = [
  { label: "320 · small phone", width: 320, height: 640 },
  { label: "375 · phone", width: 375, height: 812 },
  { label: "768 · tablet", width: 768, height: 1024 },
  { label: "1024 · small laptop", width: 1024, height: 768 },
  { label: "1280 · laptop", width: 1280, height: 800 },
  { label: "1440 · desktop", width: 1440, height: 900 },
  { label: "1920 · wide", width: 1920, height: 1080 },
] as const;

/** Public surfaces need no session, so they carry the widest coverage cheaply. */
const PUBLIC_ROUTES = ["/", "/pricing", "/features", "/help", "/c", "/login"];

/** The console pages an organizer actually works in. */
const CONSOLE_ROUTES = ["/home", "/tournaments", "/orgs", "/account", "/inbox"];

async function otpLogin(page: Page, phone: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
    timeout: 15_000,
  });
  const code = await latestOtp(phone);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("What should we call you?").fill("Viewport Tester");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/home/);
}

/**
 * The document must not scroll sideways. A 1px tolerance absorbs sub-pixel
 * rounding in scaled layouts; anything above that is a real overflow a user
 * would feel.
 */
async function assertNoHorizontalOverflow(page: Page, route: string, label: string): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    // Name the widest offender so a failure is actionable rather than a number.
    culprit: (() => {
      const limit = document.documentElement.clientWidth;
      for (const node of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
        const box = node.getBoundingClientRect();
        if (box.right > limit + 1 && box.width > 0) {
          const styles = getComputedStyle(node);
          // Containers that opt into their own scrolling are doing the right
          // thing; only elements that push the PAGE wider are failures.
          if (styles.overflowX === "auto" || styles.overflowX === "scroll") {
            continue;
          }
          return `${node.tagName.toLowerCase()}.${node.className.toString().slice(0, 60)}`;
        }
      }
      return null;
    })(),
  }));
  expect(
    overflow.scrollWidth,
    `${route} overflows at ${label}${overflow.culprit === null ? "" : ` — widest: ${overflow.culprit}`}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

for (const breakpoint of BREAKPOINTS) {
  test(`public surfaces hold their width at ${breakpoint.label}`, async ({ page }) => {
    await page.setViewportSize({ width: breakpoint.width, height: breakpoint.height });
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      await assertNoHorizontalOverflow(page, route, breakpoint.label);
    }
  });
}

test("the console holds its width across every breakpoint", async ({ page }) => {
  await otpLogin(page, PHONE);
  for (const breakpoint of BREAKPOINTS) {
    await page.setViewportSize({ width: breakpoint.width, height: breakpoint.height });
    for (const route of CONSOLE_ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      await assertNoHorizontalOverflow(page, route, breakpoint.label);
    }
  }
});

test("the primary navigation is reachable on a phone and on a desktop", async ({ page }) => {
  await otpLogin(page, `77${STAMP}`);
  // Below the rail's breakpoint the nav model swaps to bottom tabs; SOME
  // visible primary navigation must exist at every width, or a phone user is
  // stranded on whatever page they landed on.
  for (const breakpoint of [BREAKPOINTS[0], BREAKPOINTS[3], BREAKPOINTS[6]]) {
    await page.setViewportSize({ width: breakpoint.width, height: breakpoint.height });
    await page.goto("/home");
    await expect(
      page.getByRole("navigation", { name: "Primary" }).locator("visible=true").first(),
      `no visible primary navigation at ${breakpoint.label}`,
    ).toBeVisible();
  }
});
