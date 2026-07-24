import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// PX-10 FOUNDER DEMONSTRATION: an anonymous visitor opens the landing page →
// reads the product overview → discovers competitions → reads help → views legal
// → navigates to registration → signs in → returns to help → finds Financial
// Operations documentation → views support → and search reaches every public
// destination. No engineering assistance.
//
// Also covers: every public page renders without authentication, accessibility
// on each section, 360px responsiveness, and an invalid-route attack.

test.describe.configure({ mode: "serial" });

const PUBLIC_ROUTES = [
  "/",
  "/features",
  "/pricing",
  "/help",
  "/help/auction-night",
  "/help/receipts-and-exports",
  "/help/faq",
  "/help/category/auction",
  "/legal",
  "/legal/terms",
  "/legal/privacy",
  "/legal/refunds",
  "/contact",
  "/support",
  "/releases",
  "/search?q=receipt",
];

async function axeClean(page: Page, surface: string): Promise<void> {
  // After a client-side (next/link) navigation, the new <title> is committed a
  // microtask after the DOM swaps. Wait for it so axe's document-title rule sees
  // the title the SSR HTML always carries — not a transient empty one.
  await page.waitForFunction(() => document.title.length > 0);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations, `${surface}: ${JSON.stringify(scan.violations, null, 2)}`).toEqual([]);
}

test("every public page renders without authentication", async ({ page }) => {
  test.setTimeout(180_000);
  for (const route of PUBLIC_ROUTES) {
    const response = await page.goto(route);
    expect(response?.status(), `${route} did not return 200`).toBe(200);
    // The public shell frames every one of them.
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeAttached();
    await expect(page.locator("main")).toBeVisible();
  }
});

test("founder demo: landing → discover → help → legal → register → sign in → help → support → search", async ({
  page,
}) => {
  test.setTimeout(240_000);

  // --- Anonymous visitor opens the landing page -----------------------------
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "The auction night your tournament deserves", level: 1 }),
  ).toBeVisible();
  await axeClean(page, "/");

  // --- Reads the product overview -------------------------------------------
  await page.getByRole("link", { name: "Features" }).first().click();
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.getByRole("heading", { name: "Everything a tournament needs" })).toBeVisible();
  await axeClean(page, "/features");

  // --- Discovers competitions ------------------------------------------------
  await page.getByRole("link", { name: "Tournaments" }).first().click();
  await expect(page).toHaveURL(/\/c$/);
  await expect(page.getByRole("heading", { name: "Tournaments", level: 1 })).toBeVisible();

  // --- Reads Help documentation ---------------------------------------------
  await page.getByRole("link", { name: "Help" }).first().click();
  await expect(page).toHaveURL(/\/help$/);
  await page.getByRole("link", { name: "A tour of DesiAuction" }).click();
  await expect(page).toHaveURL(/\/help\/getting-started$/);
  await expect(page.getByRole("navigation", { name: "In this article" })).toBeVisible();
  await axeClean(page, "/help/getting-started");

  // --- Views legal information ----------------------------------------------
  // .first(): the redesigned footer's bottom bar also carries a "Privacy
  // Policy" link; the article link inside <main> comes first in the DOM.
  await page.goto("/legal");
  await page.getByRole("link", { name: "Privacy Policy" }).first().click();
  await expect(page).toHaveURL(/\/legal\/privacy$/);
  await expect(page.getByText("beta draft").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Version history" })).toBeVisible();
  await axeClean(page, "/legal/privacy");

  // --- Navigates to registration, then signs in -----------------------------
  // Registration begins at sign-in (phone-first). The landing's primary CTA and
  // the header both lead there; the visitor takes the header. A fresh number
  // each run avoids the OTP hourly cap and exercises the real new-visitor path.
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login/);
  const freshPhone = `73${String(Date.now()).slice(-8)}`;
  await otpLogin(page, freshPhone);

  // --- Returns to Help -------------------------------------------------------
  await page.goto("/help");
  await expect(page.getByRole("heading", { name: "Help centre", level: 1 })).toBeVisible();

  // --- Finds Financial Operations documentation ------------------------------
  await page.getByLabel("Search help").fill("financial operations receipts");
  // The public shell also carries a search trigger; mean the help form.
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/search\?q=/);
  await expect(page.getByTestId("search-results")).toBeVisible();
  await page.getByRole("link", { name: /Receipts, invoices and exports/ }).click();
  await expect(page).toHaveURL(/\/help\/receipts-and-exports$/);
  await expect(page.getByRole("heading", { name: /Tally/ })).toBeVisible();

  // --- Views Support ---------------------------------------------------------
  await page.goto("/support");
  await expect(page.getByRole("heading", { name: "Support", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reporting a bug" })).toBeVisible();
  await axeClean(page, "/support");

  // --- Search reaches every public destination -------------------------------
  await page.goto("/search?q=refund");
  await expect(page.getByRole("link", { name: /Refund Policy/ }).first()).toBeVisible();
  await page.goto("/search?q=pricing");
  await expect(page.getByRole("link", { name: /Pricing/ }).first()).toBeVisible();
  await page.goto("/search?q=release");
  await expect(page.getByRole("link", { name: /Release notes/ })).toBeVisible();
});

test("invalid routes render the branded 404 — no crash, no leak", async ({ page }) => {
  for (const route of [
    "/help/not-a-real-article",
    "/legal/not-a-real-document",
    "/help/category/not-a-category",
    "/pricing/nonsense",
  ]) {
    const response = await page.goto(route);
    expect(response?.status(), `${route} should be 404`).toBe(404);
    await expect(page.getByText("This page doesn't exist")).toBeVisible();
  }
});

test("search is navigation only and honest about no matches", async ({ page }) => {
  await page.goto("/search?q=zzzznothingmatchesthis");
  await expect(page.getByTestId("search-empty")).toBeVisible();
  // No form on the results posts anything — it's a GET search. Scoped to main:
  // the shell footer legitimately carries the newsletter POST form everywhere.
  const posts = await page.locator("main").locator('form[method="post"]').count();
  expect(posts).toBe(0);
});

test("360px: every public page fits with no horizontal scroll", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 360, height: 780 });
  for (const route of PUBLIC_ROUTES) {
    await page.goto(route);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${route} scrolls horizontally at 360px`).toBeLessThanOrEqual(1);
  }
});

async function otpLogin(page: Page, phone: string): Promise<void> {
  if (!page.url().includes("/login")) {
    await page.goto("/login");
  }
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
    timeout: 30_000,
  });
  const inbox = await page.context().newPage();
  await inbox.goto(`/dev/inbox?phone=${encodeURIComponent(`+91${phone}`)}`);
  const code = await inbox.getByTestId(`code-+91${phone}`).first().textContent();
  await inbox.close();
  await page.getByLabel(`Code sent to +91${phone}`).fill(code ?? "");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
