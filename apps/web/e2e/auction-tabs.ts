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

/**
 * Issue a paddle to the signed-in organizer from the Paddles tab (test runs).
 *
 * PROVE THE PADDLE, NOT THE PANEL. This used to assert
 * `paddles-panel toContainText(team)` — but the panel holds the "Issue a paddle
 * to yourself for" select, whose options name every team, so it passed before
 * the click had done anything. A CI run of the issuance spec issued nothing
 * (Paddles 0/2, and a log of AuctionCreated plus three LotPrepared) and the
 * helper waved it through; the spec then waited five minutes on a queue button
 * the setup page never showed. A paddle ROW for the team is the proof.
 */
export async function issuePaddleTo(page: Page, team: string): Promise<void> {
  await showAuctionTab(page, "Paddles");
  const panel = page.getByTestId("paddles-panel");
  await page.getByLabel("Issue a paddle to yourself for").selectOption({ label: team });
  const issue = page.getByTestId("issue-paddle");
  await expect(issue).toBeEnabled();
  await issue.click();
  await expect(
    panel.locator("[data-testid^='paddle-P']", { hasText: team }),
    `no paddle row for ${team} — the issue was refused or never sent`,
  ).toBeVisible({ timeout: 20_000 });
}

/**
 * Queue every prepared lot from the Setup tab.
 *
 * The setup page shows ONE step's panel at a time and follows the first step
 * still to do. "Team owners" comes before "Lot order", and both stay open to
 * act on once the auction exists — so which panel is showing depends on
 * whether two paddles are already CLAIMED. A spec that is not testing that
 * hand-off picks the step itself, exactly as an organizer can, instead of
 * relying on the page to have moved on. (`auction-setup.spec.ts` is the one
 * that tests the hand-off, and keeps clicking straight through.)
 */
export async function queueAllFromSetup(page: Page): Promise<void> {
  await showAuctionTab(page, "Setup");
  await page.getByTestId("setup-step-open-lots").click();
  await page.getByTestId("setup-body-lots").getByTestId("queue-all").click();
}
