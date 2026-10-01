import { expect, test } from "@playwright/test";

import { axeClean } from "./axe";

/**
 * THE COMPARISON PAGES (SEO-1 Phase 4c): `/compare` and `/compare/[slug]`.
 *
 * The table is a real <table> with row and column headers, inside a labelled,
 * focusable region that scrolls on a phone instead of widening the page.
 */
const PAGES = [
  {
    path: "/compare/spreadsheet-and-whatsapp",
    headline: "A spreadsheet and a WhatsApp group, or DesiAuction?",
    oldWay: "Spreadsheet + WhatsApp group",
    firstRow: "Registration",
    enough: "When a spreadsheet and a WhatsApp group are enough",
  },
  {
    path: "/compare/manual-auction",
    headline: "Chits and a whiteboard, or a live auction app?",
    oldWay: "Manual auction",
    firstRow: "Calling a player",
    enough: "When a manual auction is enough",
  },
] as const;

test("the comparison hub links to every comparison", async ({ page }) => {
  const response = await page.goto("/compare");
  expect(response?.status()).toBe(200);
  await expect(page.locator('main a[href^="/compare/"]')).toHaveCount(PAGES.length);
  await axeClean(page, "/compare");
});

for (const comparison of PAGES) {
  test(`${comparison.path}: a real table, fair to the old way, in both themes`, async ({
    page,
  }) => {
    const response = await page.goto(comparison.path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: comparison.headline })).toBeVisible();
    const table = page.getByRole("table", {
      name: `${comparison.oldWay} compared with DesiAuction`,
    });
    await expect(table.getByRole("columnheader", { name: comparison.oldWay })).toBeVisible();
    await expect(table.getByRole("rowheader", { name: comparison.firstRow })).toBeVisible();
    // Says, in its own section, when the old way is enough.
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: comparison.enough,
      }),
    ).toBeVisible();

    for (const theme of ["daylight", "floodlight"] as const) {
      await page.evaluate((value) => {
        window.localStorage.setItem("da-theme", value);
      }, theme);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await axeClean(page, `${comparison.path} · ${theme}`);
    }
  });
}

test("on a phone each row is a card with both sides on screen", async ({ page }) => {
  // At 360px the table's DesiAuction column sat off-screen: a visitor saw only
  // the old way. A phone reads the same rows as cards instead.
  await page.setViewportSize({ width: 360, height: 780 });
  for (const comparison of PAGES) {
    await page.goto(comparison.path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(
      overflow,
      `${comparison.path} widens the page by ${String(overflow)}px`,
    ).toBeLessThanOrEqual(1);
    await expect(page.getByRole("table")).toBeHidden();
    // By the card's own heading: "Registration" also appears inside other cards.
    const card = page.locator(".compare-card").filter({
      has: page.getByRole("heading", { level: 3, name: comparison.firstRow, exact: true }),
    });
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByText("DesiAuction", { exact: true })).toBeVisible();
    await expect(card.getByText(comparison.oldWay, { exact: true })).toBeVisible();
    // Both sides fit across the screen: nothing in the card is clipped sideways.
    const box = await card.boundingBox();
    expect(box !== null && box.x >= 0 && box.x + box.width <= 360).toBe(true);
  }
  await axeClean(page, "compare cards at 360px");
});

test("an unknown comparison is a real 404", async ({ page }) => {
  const response = await page.goto("/compare/nothing");
  expect(response?.status()).toBe(404);
});
