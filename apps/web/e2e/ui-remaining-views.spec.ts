import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { canonical, stage } from "./ui-auction-fixtures";

test("populated tournament names, poster controls and ledger outcomes fit narrow views", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const s = await stage(browser, true);
  try {
    await s.conductor.getByTestId("cockpit-pause").click();
    await expect.poll(async () => (await canonical(s.auctionId)).projection.status).toBe("paused");
    await writeFile(
      info.outputPath("owned-remaining-views.json"),
      JSON.stringify({
        actorId: s.data.actorId,
        fixtureId: s.data.fixtureId,
        slug: s.data.slug,
        auctionId: s.auctionId,
      }),
      { mode: 0o600 },
    );
    const page = s.conductor;
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
    for (const route of [
      "/tournaments",
      `/seasons/${s.data.slug}/posters`,
      `/seasons/${s.data.slug}/auction/ledger`,
    ]) {
      expect((await page.goto(route))?.status()).toBe(200);
      for (const theme of ["daylight", "floodlight"]) {
        await page.evaluate((value) => {
          document.documentElement.setAttribute("data-theme", value);
        }, theme);
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 844 });
          await page.evaluate(async () => {
            await document.fonts.ready;
            await Promise.all(
              document
                .getAnimations()
                .filter((a) => a.constructor.name === "CSSTransition")
                .map((a) => a.finished.catch(() => undefined)),
            );
          });
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          if (route.endsWith("/ledger")) {
            const region = page.getByRole("region", { name: "Auction ledger records" });
            await region.focus();
            await expect(region).toBeFocused();
            const scrollable = await region.evaluate(
              (element) =>
                ["auto", "scroll"].includes(getComputedStyle(element).overflowX) &&
                element.scrollWidth > element.clientWidth,
            );
            if (scrollable) {
              await region.evaluate((element) => {
                element.scrollLeft = 0;
              });
              await page.keyboard.press("ArrowRight", { delay: 100 });
              await expect
                .poll(async () => region.evaluate((element) => element.scrollLeft))
                .toBeGreaterThan(0);
            }
          }
          expect(
            (await new AxeBuilder({ page }).options({ iframes: false }).analyze()).violations,
          ).toEqual([]);
          if (width === 320) {
            if (route.endsWith("/posters")) {
              const image = page.getByTestId("poster-preview-image");
              await expect(image).toHaveAttribute("width", "1080");
              await expect(image).toHaveAttribute("height", "1350");
              const bar = page.locator(".ps-phone-bar");
              for (const control of await bar.locator("button,a").all()) {
                const box = await control.boundingBox();
                expect(box).not.toBeNull();
                expect(box?.width).toBeGreaterThanOrEqual(44);
                expect(box?.height).toBeGreaterThanOrEqual(44);
              }
              const animated = bar.getByRole("button", { name: "Animated", exact: true });
              await animated.focus();
              await page.keyboard.press("Space");
              await expect(animated).toHaveAttribute("data-active", "true");
              const still = bar.getByRole("button", { name: "Poster", exact: true });
              await still.focus();
              await page.keyboard.press("Space");
              await expect(still).toHaveAttribute("data-active", "true");
            }
            if (route.endsWith("/ledger")) {
              const results = page.getByTestId("ledger-filter-results");
              await results.focus();
              await page.keyboard.press("Enter");
              await expect(page).toHaveURL(/filter=results/);
              const all = page.getByTestId("ledger-filter-all");
              await all.focus();
              await page.keyboard.press("Enter");
              await expect(page).toHaveURL(/filter=all/);
              await expect(page.locator(".ledger-grid")).toContainText("Auction created");
              const outcome = page
                .locator(".ledger-result")
                .filter({ hasText: "Auction created" })
                .first();
              expect(
                await outcome.evaluate(
                  (element) => element.getBoundingClientRect().right <= innerWidth,
                ),
              ).toBe(true);
            }
            await page.screenshot({
              path: info.outputPath(`${String(route.split("/").at(-1))}-${theme}-320.png`),
              fullPage: true,
            });
          }
        }
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await s.conductorContext.close();
    await s.ownerContext.close();
  }
});

test("poster frames retain their geometry while real image answers are delayed", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  // This proof holds actual network image replies; workers can hide those
  // requests from page routing. Ordinary native/offline tests keep workers.
  const s = await stage(browser, false, 120, { serviceWorkers: "block" });
  try {
    const page = s.conductor;
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [size, height] of [
      ["portrait", 1350],
      ["square", 1080],
      ["story", 1920],
    ] as const) {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let imageRequested = false;
      const observations: { phase: string; url?: string }[] = [];
      const record = async (phase: string, url?: string) => {
        observations.push(url === undefined ? { phase } : { phase, url });
        await writeFile(info.outputPath(`image-${size}-phases.json`), JSON.stringify(observations));
      };
      const pattern = `**/seasons/${s.data.slug}/posters/player/*`;
      await page.route(pattern, async (route) => {
        await record("real-image-request", route.request().url());
        const response = await route.fetch();
        imageRequested = true;
        await record("real-image-response-held");
        await gate;
        await route.fulfill({ response });
        await record("real-image-response-released");
      });
      try {
        await record("before-native-navigation-or-selection");
        if (size === "portrait")
          await page.goto(`/seasons/${s.data.slug}/posters`, { waitUntil: "commit" });
        else await page.getByLabel("Shape", { exact: true }).selectOption(size);
        await record("navigation-or-selection-dispatched");
        await expect.poll(() => imageRequested).toBe(true);
        await record("pending-frame-check");
        const image = page.getByTestId("poster-preview-image");
        await expect(image).toHaveAttribute("width", "1080");
        await expect(image).toHaveAttribute("height", String(height));
        // Global document/font settlement can wait for the deliberately held
        // resource in WebKit. This proof concerns the actual image frame;
        // ordinary text/reflow checks above still await fonts and transitions.
        await record("intrinsic-frame-before-image-completion");
        const before = await image.boundingBox();
        expect(before).not.toBeNull();
        expect(before?.height).toBeGreaterThan(100);
        release();
        await expect(image).toHaveAttribute("data-state", "ready");
        const after = await image.boundingBox();
        expect(after).not.toBeNull();
        if (!before || !after) throw new Error("Missing real preview frame");
        expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
        expect(await image.evaluate((element) => (element as HTMLImageElement).naturalHeight)).toBe(
          height,
        );
      } finally {
        release();
        await page.unroute(pattern);
      }
    }
  } finally {
    await s.conductorContext.close();
    await s.ownerContext.close();
  }
});
