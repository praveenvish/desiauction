import { expect, type Page } from "@playwright/test";

/**
 * The organizer's auction page is tabbed (Setup/Overview · Players · Paddles ·
 * Room · Log). Every tab stays in the DOM, but only the open one is visible —
 * so a spec that clicks a control opens its tab first. Text assertions work on
 * hidden tabs; clicks and `toBeVisible` do not.
 */
export type AuctionTab = "Setup" | "Overview" | "Players" | "Paddles" | "Room" | "Log";

export async function showAuctionTab(page: Page, tab: AuctionTab): Promise<void> {
  const target = page
    .getByRole("tablist", { name: "Auction sections" })
    .getByRole("tab", { name: new RegExp(`^${tab}`) });
  await target.click();
  await expect(target).toHaveAttribute("aria-selected", "true");
}

/** Issue a paddle to the signed-in organizer from the Paddles tab (test runs). */
export async function issuePaddleTo(page: Page, team: string): Promise<void> {
  await showAuctionTab(page, "Paddles");
  await page.getByLabel("Issue a paddle to yourself for").selectOption({ label: team });
  await page.getByTestId("issue-paddle").click();
  await expect(page.getByTestId("paddles-panel")).toContainText(team, { timeout: 20_000 });
}
