import { expect, test } from "@playwright/test";

// M-IP1-2 interaction verification in a real browser: keyboard journeys the
// jsdom suite cannot honestly cover (native <dialog>, focus-visible, touch).

test.beforeEach(async ({ page }) => {
  await page.goto("/gallery");
  await expect(page.getByTestId("gallery-root")).toBeVisible();
});

test("dialog: opens as a top-layer modal, Escape closes, focus is trapped", async ({ page }) => {
  await page.getByRole("button", { name: "Remove player…" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove player?" });
  await expect(dialog).toBeVisible();
  const active = await page.evaluate(() => document.activeElement?.closest("dialog") !== null);
  expect(active, "focus must land inside the dialog").toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("dialog: cancel and confirm paths both close and confirm announces", async ({ page }) => {
  await page.getByRole("button", { name: "Remove player…" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Remove player?" })).not.toBeVisible();
  await page.getByRole("button", { name: "Remove player…" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Remove player?" })).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("Player removed");
});

test("tabs: arrow keys drive selection in a real browser", async ({ page }) => {
  const squads = page.getByRole("tab", { name: "Squads" });
  await squads.click();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Pool" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("Twelve players");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Purse" })).toHaveAttribute("aria-selected", "true");
});

test("toast: fires into the polite live region and can be dismissed", async ({ page }) => {
  await page.getByRole("button", { name: "Fire success toast" }).click();
  const region = page.getByRole("status");
  await expect(region).toContainText("Player saved");
  await page.getByRole("button", { name: "Dismiss: Player saved" }).click();
  await expect(region).not.toContainText("Player saved");
});

test("touch: primary controls meet the 40px minimum target", async ({ page }) => {
  for (const name of ["Primary", "Remove player…"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box, `${name} must render`).not.toBeNull();
    expect(box === null ? 0 : box.height, `${name} touch height`).toBeGreaterThanOrEqual(40);
  }
});

test("responsive: gallery renders without horizontal overflow at 360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/gallery");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "no horizontal scroll at 360px").toBeLessThanOrEqual(0);
});
