import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { formatPhone } from "../src/lib/format-phone";
import { latestOtp } from "./otp";

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
  const code = await latestOtp(phone);
  await page.getByLabel("6-digit code").fill(code);
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

  /*
   * THE MENU IS BUILT FROM WHAT THIS PERSON DOES (RN-1).
   *
   * This used to assert a fixed four — Tournaments, Organizations, Home, Help
   * — for everybody, which is what it was: one rail handed to every account
   * whatever they held. A brand-new account runs no club and plays in nothing,
   * so it is offered neither index: both are empty for them, and LAW 3 says a
   * destination that would come up empty is ABSENT. What they get instead is
   * the way in — Home, which asks whether they want to run a tournament or
   * play in one, and the public directory.
   */
  const nav = rail(page).first();
  /*
   * EXACTLY TWO LISTS (LAW 1), scoped by list rather than by landmark: the nav
   * landmark also holds the brand lockup and the signed-in footer, so asking it
   * for every link is asking the wrong question.
   *
   * List one is the primary menu — WORK. List two is utility — SERVICES. There
   * used to be a third between them, the role groups, which is how the sidebar
   * came to show nine links in three idioms with no stated hierarchy.
   */
  await expect(nav.getByRole("list")).toHaveCount(2);
  await expect(nav.getByRole("list").first().getByRole("link")).toHaveText([
    "Home",
    "Find tournaments",
  ]);
  await expect(nav.getByRole("link", { name: "Tournaments", exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Organizations" })).toHaveCount(0);

  // Help left the rail under RN-1 — that is what freed the slots beside Home.
  await expect(nav.getByRole("list").nth(1).getByRole("link")).toHaveText([
    "Notifications",
    "Account",
    "Help",
  ]);

  await nav.getByRole("link", { name: "Find tournaments" }).click();
  await expect(page).toHaveURL(/\/c/);
  await page.goto("/home");

  // User menu → Account; signed-in phone is shown in the menu header, grouped
  // for readability ("is this YOUR number?" — format-phone.ts) rather than the
  // raw stored digit run.
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByTestId("shell-session-phone")).toHaveText(formatPhone(`+91${PHONE}`));
  await page.getByRole("menuitem", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByTestId("account-phone")).toHaveText(formatPhone(`+91${PHONE}`));
});

test("search navigates; the identity bar names every surface consistently", async ({ page }) => {
  await otpLogin(page, PHONE_PALETTE);

  /*
   * Search: ⌘K opens the top bar's field — keyboard-first, no modal.
   *
   * This account holds nothing yet, so "Organizations" is NOT in its rail
   * (see the test above). It is still in the palette, deliberately: LAW 3
   * governs what the product offers unprompted, and a search result answers a
   * question somebody asked. Creating a club is precisely what a new account
   * is here to do, so "organiz" has to find the place that does it.
   */
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("organiz");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/orgs/);

  // Create an org + competition to earn a context bar. The dialog is closed
  // until its trigger is clicked — a closed <dialog> keeps its form in the DOM
  // but display:none, so filling straight through would match nothing.
  await page.getByTestId("new-org").click();
  await page.getByLabel("Club name").filter({ visible: true }).fill(`Shell Org ${STAMP}`);
  await page.getByRole("button", { name: "Create club" }).click();
  await expect(page.getByTestId("org-name")).toHaveText(`Shell Org ${STAMP}`);
  // Creating an org navigates to it client-side (see the @action/redirect
  // note in docs); the heading can paint before the URL settles, and the
  // `goto` below was cancelled by that navigation on WebKit.
  await page.waitForURL(/\/org\//);
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
  /*
   * "Players", not "Registrations": RN-1 Phase 4 took the organizer's strip
   * from nine tabs to seven by joining the surfaces that answer one question —
   * Players is Registrations AND Lineups — and the page announces the same
   * name the tab does, rather than contradicting it one line apart.
   */
  await tabs.getByRole("link", { name: "Players" }).click();
  await expect(page).toHaveURL(/\/registrations$/);
  await expect(heading).toHaveText("Players");
  await expect(breadcrumb).toContainText(`Shell Cup ${STAMP}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(tabs.getByRole("link", { name: "Players" })).toHaveAttribute("aria-current", "page");

  // /home now shows the competition and pins work (device-local).
  await page.goto("/home");
  await expect(page.getByTestId("home-competitions")).toContainText(`Shell Cup ${STAMP}`);
  await expect(page.getByTestId("home-recent")).toContainText(`Shell Cup ${STAMP}`);
  await page.getByRole("button", { name: `Pin Shell Cup ${STAMP}` }).click();
  await expect(page.getByTestId("home-pinned")).toContainText(`Shell Cup ${STAMP}`);

  // A second org + competition light the switchers.
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Club name").filter({ visible: true }).fill(`Shell Org B ${STAMP}`);
  await page.getByRole("button", { name: "Create club" }).click();
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
    /*
     * LAW 4: the bar is the SAME menu as the desktop rail — same items, same
     * order — so a brand-new account gets Home and Find tournaments here too.
     * It used to map only the fixed four, and never the role items, so a team
     * owner on a phone could not reach their team, their plan or the auction
     * room from navigation at all.
     */
    const tabs = rail(page).last();
    await expect(tabs.getByRole("link")).toHaveText(["Home", "Find"]);
    await tabs.getByRole("link", { name: "Find" }).click();
    await expect(page).toHaveURL(/\/c/);
    await page.goto("/home");

    /*
     * NOTHING CLIPS AT 320px — the narrowest phone the product supports, and
     * the check the bar's CSS comment promises. `BAR_LABEL_MAX` in
     * navigation.test.ts bounds the label at eleven characters by arithmetic;
     * only this can fail for the right reason, because only this renders the
     * real font into the real cell. The five-tab case steps down to 10px via
     * `.bottom-tabs:has(> :nth-child(5))`.
     */
    await page.setViewportSize({ width: 320, height: 640 });
    const clipped = await tabs.evaluate((bar) =>
      [...bar.querySelectorAll<HTMLElement>('[class*="tab-label"]')]
        .filter((label) => label.scrollWidth > label.clientWidth + 0.5)
        .map((label) => label.textContent ?? ""),
    );
    expect(clipped, "a bottom-tab label is cut off at 320px").toEqual([]);

    /*
     * THUMB-SIZED, at the narrowest width. The bar is the whole menu on a
     * phone, and this product is used one-handed on a shared handset in a
     * noisy hall on auction night. 44px is the rung the product standardised
     * on; the bar also carries `env(safe-area-inset-bottom)` so the last row
     * is not under the home indicator.
     */
    const tabLinks = await tabs.getByRole("link").all();
    expect(tabLinks.length).toBeGreaterThan(0);
    for (const link of tabLinks) {
      const box = await link.boundingBox();
      expect(box, "a bottom tab has no box").not.toBeNull();
      expect(
        box?.height ?? 0,
        `"${await link.textContent()}" is under the 44px rung`,
      ).toBeGreaterThanOrEqual(44);
    }
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
    /*
     * `waitForURL`, not `toHaveURL`. The gate redirects through the client
     * router, so `goto` can resolve while that redirect is still in flight;
     * `toHaveURL` then matches and the NEXT iteration's `goto` is cancelled by
     * the redirect it never waited for. `waitForURL` waits for the navigation
     * itself, which is the thing being asserted.
     */
    await page.waitForURL(/\/login/);
  }
});

/**
 * BOTH THEMES (RN-1 Phase 6).
 *
 * This scanned the default theme only, so the console's floodlight surface —
 * a different set of colours on every token — had never been scanned at all.
 * Contrast is the whole category axe is best at and the one that a theme swap
 * is most likely to break, which makes "we scan for a11y" and "we scan the
 * product" two different claims.
 *
 * The theme is replayed from localStorage before first paint (THEME_BOOTSTRAP
 * in the root layout), so setting the key and reloading is how a returning
 * visitor actually arrives in it.
 */
for (const theme of ["daylight", "floodlight"] as const) {
  test(`shell accessibility: /home and /help scan clean · ${theme}`, async ({ page }) => {
    await otpLogin(page, `8${theme === "daylight" ? "3" : "1"}${STAMP}`);
    await page.evaluate((value) => {
      window.localStorage.setItem("da-theme", value);
    }, theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    // Let the route content replace the loading skeleton before scanning.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const homeScan = await new AxeBuilder({ page }).analyze();
    expect(homeScan.violations, JSON.stringify(homeScan.violations, null, 2)).toEqual([]);
    await page.goto("/help");
    await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();
    const helpScan = await new AxeBuilder({ page }).analyze();
    expect(helpScan.violations, JSON.stringify(helpScan.violations, null, 2)).toEqual([]);
  });
}

/*
 * THE PAGE ANSWERS THE CLICK (page-load audit). A soft navigation marks the
 * document `data-nav-pending` and the content region `aria-busy` until the next
 * page commits — the client-side stand-in for a `loading.tsx`, which cannot sit
 * above these gated pages. The server's answer is held back here so the pending
 * window is long enough to observe; on a phone it is 0.5–0.7 s for real.
 */
test("a click marks the page busy until the next page arrives, then releases it", async ({
  page,
}) => {
  await page.goto("/help");
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname === "/pricing",
    async (route) => {
      if (route.request().headers()["rsc"] !== undefined) await held;
      await route.continue();
    },
  );

  const html = page.locator("html");
  const content = page.locator("#main-content");
  await page.getByRole("link", { name: "Pricing", exact: true }).first().click();
  await expect(html).toHaveAttribute("data-nav-pending", "");
  await expect(content).toHaveAttribute("aria-busy", "true");

  release();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(html).not.toHaveAttribute("data-nav-pending");
  await expect(content).not.toHaveAttribute("aria-busy");
  // Back at full contrast on arrival — no fade-in for an accessibility scan to catch.
  await expect(content).toHaveCSS("opacity", "1");
});
