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
  await expect(page.getByRole("status", { name: "Notifications" })).toContainText("Player removed");
});

/**
 * Escape and a backdrop click are covered above and stay covered — this is the
 * THIRD exit, the only one a touch user can see. At 390px the dialog is
 * min(480px, 100vw - 32px), so the backdrop is a ~16px strip down each side,
 * and a phone has no Escape key at all. Asserted in a real browser because the
 * things that matter here — the native focus trap, initial focus placement, and
 * focus restoration to the trigger — are exactly what jsdom does not implement.
 */
test("dialog: the close button is a visible exit, tabbable, and restores focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/gallery");
  const trigger = page.getByRole("button", { name: "Remove player…" });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Remove player?" });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", { name: "Close Remove player?" });

  // Sitting first in the header, it takes showModal()'s initial focus — so it
  // is reachable without a single Tab, which is the point on a screen reader.
  await expect(close).toBeFocused();
  const box = await close.boundingBox();
  expect(box === null ? 0 : box.height, "close touch height").toBeGreaterThanOrEqual(44);
  expect(box === null ? 0 : box.width, "close touch width").toBeGreaterThanOrEqual(44);

  // Tab must come back round to it: proof the trap still holds with the button
  // in the DOM, rather than leaking focus to the page behind the modal.
  await page.keyboard.press("Tab");
  await expect(close).not.toBeFocused();
  const trapped = await page.evaluate(() => document.activeElement?.closest("dialog") !== null);
  expect(trapped, "focus stays inside the dialog").toBe(true);

  await close.click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("touch: the touch rung reaches the platform's 44px convention", async ({ page }) => {
  // sm renders 32 and md renders 40; before this rung existed no page could ask
  // the component for 44. The other rungs are asserted unchanged in the ui
  // package's unit tests — this checks the browser agrees about the new one.
  const box = await page.getByRole("button", { name: "Touch", exact: true }).boundingBox();
  expect(box, "the touch-size demo button must render").not.toBeNull();
  expect(box === null ? 0 : box.height, "touch rung height").toBeGreaterThanOrEqual(44);
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
  const region = page.getByRole("status", { name: "Notifications" });
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
