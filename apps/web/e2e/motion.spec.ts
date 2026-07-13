import { expect, test } from "@playwright/test";

// M-IP1-4 verification in a real browser. The critical case: under
// prefers-reduced-motion the hold gate must still require the FULL duration
// of real held time (F-AX-1 — reduced motion never weakens a safety gate).

const HOLD_MS = 1500;

test.beforeEach(async ({ page }) => {
  await page.goto("/gallery");
  await page.getByTestId("hold-gavel").scrollIntoViewIfNeeded();
});

test("holding for the full duration fires exactly once and announces assertively", async ({
  page,
}) => {
  const gavel = page.getByTestId("hold-gavel");
  const box = await gavel.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) {
    return;
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(HOLD_MS + 400);
  await page.mouse.up();
  await expect(page.getByTestId("gavel-count")).toHaveText("SOLD ×1");
  await expect(page.getByTestId("announcer-assertive")).toHaveText("Sold. Lot closed.");
});

test("an early release never fires the gate", async ({ page }) => {
  const gavel = page.getByTestId("hold-gavel");
  const box = await gavel.boundingBox();
  if (box === null) {
    return;
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("gavel-count")).toHaveText("SOLD ×0");
});

test("REDUCED MOTION: the gate still requires the full held duration", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const gavel = page.getByTestId("hold-gavel");
  await gavel.scrollIntoViewIfNeeded();
  const box = await gavel.boundingBox();
  if (box === null) {
    return;
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Short hold must NOT fire even with animations disabled.
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect(page.getByTestId("gavel-count")).toHaveText("SOLD ×0");
  // Full hold still works.
  await page.mouse.down();
  await page.waitForTimeout(HOLD_MS + 400);
  await page.mouse.up();
  await expect(page.getByTestId("gavel-count")).toHaveText("SOLD ×1");
});

test("keyboard hold: Space held to completion gavels; early release does not", async ({ page }) => {
  const gavel = page.getByTestId("hold-gavel");
  await gavel.focus();
  await page.keyboard.down(" ");
  await page.waitForTimeout(500);
  await page.keyboard.up(" ");
  await expect(page.getByTestId("gavel-count")).toHaveText("SOLD ×0");
  await page.keyboard.down(" ");
  await page.waitForTimeout(HOLD_MS + 400);
  await page.keyboard.up(" ");
  await expect(page.getByTestId("gavel-count")).toHaveText("SOLD ×1");
});

test("polite announcements queue in order without clobbering", async ({ page }) => {
  await page.getByRole("button", { name: "Announce bid (polite)" }).click();
  await page.getByRole("button", { name: "Announce lead (polite)" }).click();
  const polite = page.getByTestId("announcer-polite");
  await expect(polite).toHaveText("Bid of ₹4,25,000 placed.");
  await expect(polite).toHaveText("You lead.", { timeout: 3000 });
});
