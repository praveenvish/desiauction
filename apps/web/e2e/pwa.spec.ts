import { spawn, type ChildProcess } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

import { splashImages } from "../src/lib/apple-splash";
import { axeClean } from "./axe";

// THE INSTALLED APP, PROVEN IN A REAL BROWSER (public/sw.js, src/lib/pwa.ts).
//
// Every spec runs with the worker allowed (playwright.config.ts); this one
// tests the worker itself. It registers in production builds only, so the
// worker tests need the precompiled harness:
//
//   PLAYWRIGHT_PRECOMPILED=1 pnpm exec playwright test e2e/pwa.spec.ts

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

  // iOS's launch screen: one link per screen and orientation, each one served.
  const startup = page.locator('link[rel="apple-touch-startup-image"]');
  await expect(startup).toHaveCount(splashImages().length);
  for (const href of await startup.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href") ?? ""),
  )) {
    const image = await request.get(href);
    expect(image.ok(), href).toBe(true);
    expect(image.headers()["content-type"], href).toBe("image/png");
  }
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

/*
 * OFFLINE AS A PHONE MEETS IT: THE SERVER CANNOT BE REACHED.
 *
 * Every engine, Safari's included. Playwright's own offline switch reaches a
 * service worker's requests in Chromium only (in Firefox the worker fetched
 * the page anyway; in WebKit the navigation died inside Playwright), so this
 * block does not use it. It starts its own production server on a second
 * port, loads the app, STOPS THE SERVER, and navigates: the worker's fetch
 * gets no response at all, exactly as on a phone with no signal. Then it
 * starts the server again and recovers.
 */
test.describe("server unreachable", () => {
  test.skip(!PRODUCTION, "the worker registers in production builds only");
  test.describe.configure({ mode: "serial" });

  const PORT = 3061;
  const ORIGIN = `http://localhost:${String(PORT)}`;
  let server: ChildProcess | null = null;

  async function startServer(): Promise<void> {
    server = spawn(
      "node",
      [
        "--env-file-if-exists=../../.env.local",
        "node_modules/next/dist/bin/next",
        "start",
        "--port",
        String(PORT),
      ],
      {
        // The build the main harness serves, and the flag its server needs.
        env: { ...process.env, NEXT_DIST_DIR: ".next-e2e", ALLOW_INSECURE_LOCAL_PRODUCTION: "1" },
        // Its own process group, so stopping it stops Next's child too.
        detached: true,
        stdio: "ignore",
      },
    );
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`${ORIGIN}/healthz`)).ok;
          } catch {
            return false;
          }
        },
        { timeout: 60_000 },
      )
      .toBe(true);
  }

  async function stopServer(): Promise<void> {
    const running = server;
    server = null;
    if (running?.pid === undefined) {
      return;
    }
    const exited = new Promise((resolve) => running.once("exit", resolve));
    process.kill(-running.pid, "SIGTERM");
    await exited;
    await expect
      .poll(async () => {
        try {
          await fetch(`${ORIGIN}/healthz`);
          return "up";
        } catch {
          return "down";
        }
      })
      .toBe("down");
  }

  test.beforeEach(startServer);
  test.afterEach(stopServer);

  test("a page opened with no server shows the offline screen, then the page once it is back", async ({
    page,
  }) => {
    await underWorker(page, `${ORIGIN}/help`);
    await stopServer();

    await page.evaluate(() => {
      window.location.assign("/pricing");
    });
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/pricing");
    await axeClean(page, "offline screen");

    // Still down: Try again lands on the same screen, at the same address.
    await page.getByRole("link", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();

    await startServer();
    await page.getByRole("link", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "You're offline" })).toHaveCount(0);
    await expect(page.locator("main").first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/pricing");
  });

  test("the offline screen passes in the dark too", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await underWorker(page, `${ORIGIN}/help`);
    await stopServer();
    await page.goto(`${ORIGIN}/features`);
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await axeClean(page, "offline screen (dark)");
  });
});

test.describe("offline", () => {
  test.skip(!PRODUCTION, "the worker registers in production builds only");

  test("a page opened offline shows the offline screen, and comes back", async ({
    page,
    context,
    browserName,
  }) => {
    // The browser's own offline flag, and its `online` event bringing the page
    // back. Playwright can set that flag for a worker in Chromium only; the
    // block above proves the offline screen in every engine.
    test.skip(browserName !== "chromium", "Playwright's offline switch misses workers here");
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
