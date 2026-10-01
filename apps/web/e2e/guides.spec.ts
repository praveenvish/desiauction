import { expect, test } from "@playwright/test";

import { axeClean } from "./axe";

/** SEO-1 Phase 6: the guides, and the /blog placeholder they replaced. */
test("the guides index lists the guides", async ({ page }) => {
  const response = await page.goto("/guides");
  expect(response?.status()).toBe(200);
  await expect(page.locator('main a[href^="/guides/"]')).not.toHaveCount(0);
  await axeClean(page, "/guides");
});

test("a guide reads in both themes, bylined to the team", async ({ page }) => {
  await page.goto("/guides/auction-purse-and-base-price");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "How much purse and base price to set for a player auction",
    }),
  ).toBeVisible();
  await expect(page.getByText(/By the DesiAuction team/)).toBeVisible();
  // The worked example states the reserve rule's arithmetic.
  await expect(page.getByText("₹1,00,000 − 10 × ₹2,000 = ₹80,000", { exact: false })).toBeVisible();
  for (const theme of ["daylight", "floodlight"] as const) {
    await page.evaluate((value) => {
      window.localStorage.setItem("da-theme", value);
    }, theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await axeClean(page, `guide · ${theme}`);
  }
});

test("/blog now leads to the guides, permanently", async ({ request }) => {
  const response = await request.get("/blog", { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(response.headers()["location"]).toMatch(/\/guides$/);
});
