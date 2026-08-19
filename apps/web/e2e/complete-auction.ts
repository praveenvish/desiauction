import { expect, type Page } from "@playwright/test";

/**
 * CLOSE AN AUCTION, INCLUDING THE ONE THE ENGINE REFUSES FIRST.
 *
 * The completion dialog is a TWO-ACT flow, and every spec that got this wrong
 * failed the same way — the auction simply stayed "live" with a dialog sitting
 * open and nothing on screen explaining it.
 *
 *   Act 1  confirm → the command goes to the engine.
 *   Act 2  if the engine refuses with `squad_below_minimum`, the SAME dialog
 *          re-renders with the warning and a reason field; the confirm is
 *          `disabled` until that reason is typed, and a second confirm commits.
 *
 * Two things make this easy to get wrong. The reason field does not exist until
 * after act 1's server round trip, so a spec that fills it first fills nothing;
 * and it appears asynchronously, so a spec that SAMPLES with `isVisible()`
 * instead of waiting decides there is no second act and gives up.
 *
 * Fixtures here run deliberately small squads, so act 2 is the normal path.
 */
export async function completeAuction(
  page: Page,
  trigger: "conduct-complete" | "cockpit-complete",
  reason = "test fixture: minimal squads",
): Promise<void> {
  await page.getByTestId(trigger).click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 20_000 });
  await page.getByTestId("confirm-complete").click();

  const overrideReason = page.getByTestId("override-reason");
  const needsReason = await overrideReason
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (needsReason) {
    await overrideReason.fill(reason);
    await page.getByTestId("confirm-complete").click();
  }
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });
}
