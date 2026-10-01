import { expect, test } from "@playwright/test";

import { axeClean } from "./axe";

/**
 * THE AUDIENCE PAGES (SEO-1 Phase 4b): `/for` and `/for/[slug]`.
 *
 * Two audiences at opposite ends — a company league and a village tournament —
 * each checked for its own words, its season steps, and that its sport links
 * land on real sport pages. The SEO guardrail (seo.spec.ts) covers indexing
 * for all of them through the sitemap.
 */
const PAGES = [
  {
    path: "/for/corporate-leagues",
    headline: "Run your company's league like a franchise auction",
    point: "Budgets in points, not salaries",
    sport: "/sports/cricket",
  },
  {
    path: "/for/village-tournaments",
    headline: "Run your village or district tournament's auction",
    point: "Cash is a first-class payment",
    sport: "/sports/kabaddi",
  },
] as const;

test("the audience hub links to every audience page", async ({ page }) => {
  const response = await page.goto("/for");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "Every kind of league runs differently" }),
  ).toBeVisible();
  await expect(page.locator('main a[href^="/for/"]')).toHaveCount(5);
  await axeClean(page, "/for");
});

for (const audience of PAGES) {
  test(`${audience.path}: its own words, its sports, readable in both themes`, async ({ page }) => {
    const response = await page.goto(audience.path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: audience.headline })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: audience.point })).toBeVisible();
    await expect(page.locator(".audience-steps li")).not.toHaveCount(0);

    for (const theme of ["daylight", "floodlight"] as const) {
      await page.evaluate((value) => {
        window.localStorage.setItem("da-theme", value);
      }, theme);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await axeClean(page, `${audience.path} · ${theme}`);
    }

    // The sport card hands on to that sport's own page.
    await page.locator(`main a[href="${audience.sport}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${audience.sport}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}

test("an unknown audience is a real 404", async ({ page }) => {
  const response = await page.goto("/for/astronauts");
  expect(response?.status()).toBe(404);
});

test("an audience page does not scroll sideways on a 360px phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const audience of PAGES) {
    await page.goto(audience.path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${audience.path} overflows by ${String(overflow)}px`).toBeLessThanOrEqual(1);
  }
});
