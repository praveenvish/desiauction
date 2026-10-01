import { expect, test } from "@playwright/test";

import { axeClean } from "./axe";

/**
 * THE FREE TOOLS (SEO-1 Phase 4d). Each one is used, not just loaded: the
 * calculator's numbers are the auction's own reserve rule and ladders, the
 * template follows the chosen sport, and the draft reverses every round.
 */
test("the tools hub links to every tool", async ({ page }) => {
  const response = await page.goto("/tools");
  expect(response?.status()).toBe(200);
  await expect(page.locator('main a[href^="/tools/"]')).toHaveCount(3);
  await axeClean(page, "/tools");
});

test("purse calculator: the reserve rule, a purse too small, and a points ladder", async ({
  page,
}) => {
  await page.goto("/tools/purse-calculator");
  // ₹1,00,000 purse, minimum squad 11, base ₹2,000: the reserve rule keeps
  // 10 × ₹2,000 back, so the biggest first bid is ₹80,000.
  await expect(page.getByTestId("calc-first-bid")).toHaveText(/80,000/);
  await expect(page.getByTestId("calc-warnings")).toHaveCount(0);

  // A purse that cannot buy a minimum squad at base price is called out.
  await page.getByLabel("Purse per team (₹)").fill("20000");
  await expect(page.getByTestId("calc-warnings")).toContainText("cannot fill its minimum squad");

  // Points: a 1,000-point purse bids in steps of 5 first (pointsSlabs).
  await page.getByLabel("Auction in").selectOption("points");
  await expect(page.getByTestId("calc-ladder")).toContainText("+5 pts");
  await expect(page.getByTestId("calc-warnings")).toHaveCount(0);

  for (const theme of ["daylight", "floodlight"] as const) {
    await page.evaluate((value) => {
      window.localStorage.setItem("da-theme", value);
    }, theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await axeClean(page, `/tools/purse-calculator · ${theme}`);
  }
});

test("registration form template follows the chosen sport", async ({ page }) => {
  await page.goto("/tools/registration-form");
  const questions = page.getByTestId("template-questions");
  await expect(questions).toContainText("Batting style");
  await expect(questions).toContainText("Wicket-keeper");

  await page.getByLabel("Sport").selectOption("football");
  await expect(questions).toContainText("Goalkeeper");
  await expect(questions).not.toContainText("Batting style");
  await axeClean(page, "/tools/registration-form");
});

test("snake draft reverses the order every round", async ({ page }) => {
  await page.goto("/tools/snake-draft");
  const rounds = page.getByTestId("draft-order").locator(":scope > li");
  await expect(rounds).toHaveCount(4);
  await expect(rounds.nth(0).locator("ol > li").first()).toHaveText("Team 1");
  await expect(rounds.nth(1).locator("ol > li").first()).toHaveText("Team 6");
  await axeClean(page, "/tools/snake-draft");
});

test("no tool scrolls sideways on a 360px phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of [
    "/tools/purse-calculator",
    "/tools/registration-form",
    "/tools/snake-draft",
  ]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} overflows by ${String(overflow)}px`).toBeLessThanOrEqual(1);
  }
});
