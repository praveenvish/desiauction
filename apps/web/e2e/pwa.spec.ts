import { expect, test, type Page } from "@playwright/test";

import { axeClean } from "./axe";

// THE INSTALLED APP, PROVEN IN A REAL BROWSER (public/sw.js, src/lib/pwa.ts).
//
// Every other spec blocks service workers (playwright.config.ts). This one
// lets them in, because the worker is what it tests. The worker registers in
// production builds only, so the worker tests need the precompiled harness:
//
//   PLAYWRIGHT_PRECOMPILED=1 pnpm exec playwright test e2e/pwa.spec.ts

test.use({ serviceWorkers: "allow" });

const PRODUCTION = process.env["PLAYWRIGHT_PRECOMPILED"] === "1";

/** Load a page, and wait until the worker controls it. */
async function underWorker(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

test("the site describes itself as an installable app", async ({ page, request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    id: string;
    display: string;
    start_url: string;
    icons: { sizes: string; purpose: string }[];
  };
  expect(manifest).toMatchObject({ id: "/", display: "standalone", start_url: "/" });
  // Chromium installs only with a 192 and a 512; Android masks with the maskable.
  expect(manifest.icons.map((icon) => `${icon.sizes}/${icon.purpose}`)).toEqual(
    expect.arrayContaining(["192x192/any", "512x512/any", "512x512/maskable"]),
  );

  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    "content",
    "DesiAuction",
  );
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
    "content",
    "yes",
  );
});

test("the worker and its offline page are never stored stale by the browser", async ({
  request,
}) => {
  for (const path of ["/sw.js", "/offline.html"]) {
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    const cacheControl = response.headers()["cache-control"] ?? "";
    expect(cacheControl, path).not.toMatch(/immutable/);
    expect(cacheControl, path).toMatch(/max-age=0|no-cache|no-store/);
  }
});

test.describe("offline", () => {
  test.skip(!PRODUCTION, "the worker registers in production builds only");

  test("a page opened offline shows the offline screen, and comes back", async ({
    page,
    context,
  }) => {
    await underWorker(page, "/help");

    await context.setOffline(true);
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    // At the address that was asked for, so retrying means retrying THAT.
    expect(new URL(page.url()).pathname).toBe("/pricing");
    await axeClean(page, "offline screen");

    // Back online, it opens the page by itself: no tap, no timer.
    await context.setOffline(false);
    await expect(page.getByRole("heading", { name: "You're offline" })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/pricing");
  });

  test("Try again works without waiting for the browser to notice", async ({ page, context }) => {
    await underWorker(page, "/help");
    await context.setOffline(true);
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await page.getByRole("link", { name: "Try again" }).click();
    // Still offline: the same screen, at the same address.
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/pricing");
    await context.setOffline(false);
  });

  test("the offline screen passes in the dark too", async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await underWorker(page, "/help");
    await context.setOffline(true);
    await page.goto("/features");
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await axeClean(page, "offline screen (dark)");
    await context.setOffline(false);
  });

  test("Chrome finds nothing stopping an install", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "installability is Chromium's own verdict");
    await underWorker(page, "/");
    const devtools = await page.context().newCDPSession(page);
    const { installabilityErrors } = (await devtools.send("Page.getInstallabilityErrors")) as {
      installabilityErrors: { errorId: string }[];
    };
    expect(installabilityErrors.map((error) => error.errorId)).toEqual([]);
  });

  test("build files are kept on the device; pages never are", async ({ page }) => {
    await underWorker(page, "/help");
    // The first load ran before the worker controlled the page.
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const cache = await caches.open("da-static");
          return (await cache.keys()).length;
        }),
      )
      .toBeGreaterThan(0);
    const stored = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        urls.push(...(await cache.keys()).map((request) => new URL(request.url).pathname));
      }
      return urls;
    });
    for (const path of stored) {
      expect(path === "/offline.html" || path.startsWith("/_next/static/"), path).toBe(true);
    }
  });
});
