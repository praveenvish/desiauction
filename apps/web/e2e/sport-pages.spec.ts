import { expect, test } from "@playwright/test";

import { axeClean } from "./axe";

/**
 * THE SPORT PAGES (SEO-1 Phase 4): `/sports` and `/sports/[slug]`.
 *
 * Three pages with genuinely different rules, not three of one kind: cricket
 * (a duel, net run rate), basketball (a loss still scores) and battle royale
 * (a lobby, placement plus kills). Those sentences are rendered from the sport
 * pack, so asserting them here proves the page reads the engine's rules
 * rather than a hand-typed copy of them.
 *
 * The SEO guardrail (seo.spec.ts) already holds every one of these pages to
 * the indexing checks through the sitemap; this spec is about the reader.
 */
const PAGES = [
  {
    path: "/sports/cricket",
    headline: "Run your cricket player auction, IPL-style",
    rule: /Each match earns 2 for a win, 1 for a tie or no result\. Teams level on points are separated by net run rate\./,
    role: "Wicket-keeper",
    // The ENTRY label: cricket stores balls but is scored in overs.
    entered: /You enter runs, wickets and overs after each match/,
  },
  {
    path: "/sports/basketball",
    headline: "Auction players for your basketball league",
    rule: /Each game earns 2 for a win, 1 for a tie or no result, 1 for a loss\./,
    role: "Center",
    entered: /You enter points after each game/,
  },
  {
    path: "/sports/battle-royale",
    headline: "Run a battle royale squad auction",
    rule: /Each lobby pays by placement — 10, 6, 5, 4, 3, 2, 1, 1 from first place down — plus 1 per kill\. Squads level on points are separated by kills\./,
    role: "In-game leader",
    entered: /You enter kills after each lobby/,
  },
] as const;

test("the sports hub links to every sport page", async ({ page }) => {
  const response = await page.goto("/sports");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "Player auctions for every sport" }),
  ).toBeVisible();
  // Twelve packs, twelve pages (content/sports.test.ts holds the pairing).
  await expect(page.locator('a[href^="/sports/"]')).toHaveCount(12);
  await axeClean(page, "/sports");
});

for (const sport of PAGES) {
  test(`${sport.path}: the pack's own rules, readable in both themes`, async ({ page }) => {
    const response = await page.goto(sport.path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: sport.headline })).toBeVisible();
    await expect(page.getByText(sport.rule)).toBeVisible();
    await expect(page.getByText(sport.entered)).toBeVisible();
    await expect(page.locator(".sport-chips li", { hasText: sport.role }).first()).toBeVisible();

    // Both themes: a theme swap changes every colour token, which is exactly
    // what a contrast scan exists to catch.
    for (const theme of ["daylight", "floodlight"] as const) {
      await page.evaluate((value) => {
        window.localStorage.setItem("da-theme", value);
      }, theme);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await axeClean(page, `${sport.path} · ${theme}`);
    }
  });
}

test("an unknown sport is a real 404, not an empty page", async ({ page }) => {
  const response = await page.goto("/sports/curling");
  expect(response?.status()).toBe(404);
});

test("a sport page does not scroll sideways on a 360px phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const sport of PAGES) {
    await page.goto(sport.path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${sport.path} overflows by ${String(overflow)}px`).toBeLessThanOrEqual(1);
  }
});
