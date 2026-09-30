import { expect, test } from "@playwright/test";

/**
 * SEO-1 Phase 8: the real-visitor speed endpoint. Unauthenticated and built to
 * be harmless to abuse — every answer is 204, a real sample and garbage alike,
 * so it confirms nothing to a caller.
 */
test("the vitals endpoint takes a sample and shrugs at garbage", async ({ request }) => {
  const good = await request.post("/api/vitals", {
    data: { name: "LCP", value: 1850, rating: "good", path: "/pricing?ref=x" },
  });
  expect(good.status()).toBe(204);
  for (const data of [{ name: "FID", value: 1 }, "not json", { name: "LCP", value: -5 }]) {
    const bad = await request.post("/api/vitals", { data });
    expect(bad.status()).toBe(204);
  }
});

test("a page loads the vitals reporter without a policy violation", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(errors.filter((text) => /vitals|Content Security Policy/i.test(text))).toEqual([]);
});
