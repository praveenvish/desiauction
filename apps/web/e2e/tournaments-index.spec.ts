import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { latestOtp } from "./otp";

// The tournaments index: first run, the summary band, and the toolbar
// (search / status / sort / layout) that filters the accordion.
//
// The toolbar runs entirely in the browser — no `searchParams`, no server
// round-trip — so nothing about it is covered by a server test. Everything
// asserted here is logic that can silently rot: which groups survive a filter,
// whether a hit inside a collapsed group is actually revealed, and whether the
// sub-line's season count still agrees with the header figure once the list is
// filtered down (it did not, once).

const STAMP = String(Date.now()).slice(-8);
// Distinct phone per spec: the OTP cap is 5 sends/phone/hour and retries burn
// through a shared number (PX-3 finding).
const PHONE = `73${STAMP}`;

async function otpLogin(page: Page, phone: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
    timeout: 15_000,
  });
  const code = await latestOtp(phone);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  // PX-3: the name gate now guards every console route, not just /home — a
  // fresh account that stops here never reaches the org/tournament screens
  // this helper is used to reach.
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill("E2E Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
}

/** Slugs carry a random suffix, so group test ids can only come from the URL. */
function slugFrom(url: string): string {
  return url.split("/tournaments/")[1]?.split(/[?#]/)[0] ?? "";
}

/**
 * Every FormDialog renders its form into the DOM whether or not it is open, and
 * these pages carry several (one "+ Season" per tournament, two create-org
 * affordances on /orgs). `getByLabel` is not role-based, so it matches the
 * closed copies too and trips strict mode. Scope to the open dialog — only one
 * is ever in the accessibility tree.
 */
function dialog(page: Page) {
  return page.getByRole("dialog");
}

/**
 * Every create here redirects onto a route this run has not compiled yet, and a
 * cold dev compile routinely outlasts the 5s assertion default (the repo's
 * standing allowance for the shared dev compiler).
 */
const COLD = { timeout: 30_000 } as const;

test("the tournaments index: first run, summary band, and the toolbar", async ({ page }) => {
  await otpLogin(page, PHONE);

  // A person with no org cannot create a tournament, so the org comes first.
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await dialog(page)
    .getByLabel("Organization name")
    .filter({ visible: true })
    .fill(`Tour Org ${STAMP}`);
  await dialog(page).getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toHaveText(`Tour Org ${STAMP}`, COLD);

  // First run owns the whole canvas: no toolbar, no summary band, one action.
  await page.goto("/tournaments");
  await expect(page.getByTestId("tournaments-empty")).toBeVisible();
  await expect(page.getByTestId("tg-search")).toHaveCount(0);

  await page.getByTestId("firstrun-tournament").click();
  await dialog(page)
    .getByLabel("Tournament name")
    .filter({ visible: true })
    .fill(`Alpha Cup ${STAMP}`);
  await dialog(page).getByRole("button", { name: "Create tournament" }).click();
  await expect(page).toHaveURL(/\/tournaments\/.+/, COLD);
  const alpha = slugFrom(page.url());

  // A second tournament, so filtering has something to filter out.
  await page.goto("/tournaments");
  await page.getByTestId("new-tournament").click();
  await dialog(page)
    .getByLabel("Tournament name")
    .filter({ visible: true })
    .fill(`Zulu Trophy ${STAMP}`);
  await dialog(page).getByRole("button", { name: "Create tournament" }).click();
  await expect(page).toHaveURL(/\/tournaments\/.+/, COLD);
  const zulu = slugFrom(page.url());

  // One season under Alpha — the figures and the status filter need real rows.
  await page.goto("/tournaments");
  await page.getByTestId(`add-season-${alpha}`).click();
  const seasonForm = dialog(page);
  await seasonForm.getByLabel("Season name").filter({ visible: true }).fill(`Alpha One ${STAMP}`);
  await seasonForm.getByLabel("Location").fill("Malad, Mumbai");
  await seasonForm.getByLabel("Starts on").fill("2026-08-01");
  await seasonForm.getByLabel("Ends on").fill("2026-08-15");
  await seasonForm.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-name")).toHaveText(`Alpha One ${STAMP}`, COLD);

  await page.goto("/tournaments");
  const summary = page.getByRole("list", { name: "Tournament summary" });
  await expect(summary).toBeVisible();
  // Two tournaments, one season, and no teams yet — the band counts what the
  // page can actually see, not a global total.
  await expect(summary).toContainText("Tournaments");
  await expect(summary).toContainText("Seasons");

  const alphaGroup = page.getByTestId(`tg-${alpha}`);
  const zuluGroup = page.getByTestId(`tg-${zulu}`);
  await expect(alphaGroup).toBeVisible();
  await expect(zuluGroup).toBeVisible();

  // A tournament with no seasons says so, and shows no season figures.
  await expect(zuluGroup).toContainText("no seasons yet");
  // The one with a season states the count once, in agreement with itself.
  await expect(alphaGroup).toContainText("1 season");

  // --- search -------------------------------------------------------------
  await page.getByTestId("tg-search").fill("Zulu");
  await expect(zuluGroup).toBeVisible();
  await expect(alphaGroup).toHaveCount(0);

  // A season name matches too, and the hit is REVEALED: a match inside a
  // collapsed group is a match the organizer cannot see.
  await page.getByTestId("tg-search").fill("Alpha One");
  await expect(alphaGroup).toBeVisible();
  await expect(zuluGroup).toHaveCount(0);
  await expect(alphaGroup.getByTestId("tg-season")).toBeVisible();

  // Nothing matches — a dead end gets an explanation, not an empty page.
  await page.getByTestId("tg-search").fill("nothing-matches-this");
  await expect(page.getByTestId("tg-noresults")).toBeVisible();

  await page.getByTestId("tg-search").fill("");
  await expect(alphaGroup).toBeVisible();
  await expect(zuluGroup).toBeVisible();
  // Nothing stays forced open once the filter clears. A group filtered out is
  // unmounted, so coming back it takes the default again — and only the first
  // group defaults to open, which under "Newest" is Zulu, not Alpha.
  await expect(alphaGroup.getByTestId("tg-season")).toBeHidden();

  // --- status filter ------------------------------------------------------
  // The new season is a draft, so "Registration open" must empty the list —
  // including the seasonless tournament, which cannot satisfy the filter.
  await page.getByTestId("tg-status").selectOption("registration_open");
  await expect(page.getByTestId("tg-noresults")).toBeVisible();

  await page.getByTestId("tg-status").selectOption("draft");
  await expect(alphaGroup).toBeVisible();
  await expect(zuluGroup).toHaveCount(0);
  // Filtered down, the sub-line and the header figure must still agree.
  await expect(alphaGroup).toContainText("1 season");

  // --- the accordion opens and closes on its own --------------------------
  // A fresh load, so the open/closed state is the documented default rather
  // than whatever the filtering above left behind: a group that was briefly
  // the only match was briefly the first group, and kept that open state.
  await page.goto("/tournaments");
  const toggle = page.getByTestId(`tg-toggle-${alpha}`);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(alphaGroup.getByTestId("tg-season")).toBeVisible();

  // --- layout -------------------------------------------------------------
  await expect(page.getByTestId("tg-view-list")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("tg-view-grid").click();
  await expect(page.getByTestId("tg-view-grid")).toHaveAttribute("aria-pressed", "true");
  // The grid renders season CARDS, so the row treatment is gone entirely and
  // the same season reappears inside the card grid.
  await expect(alphaGroup.getByTestId("tg-season")).toHaveCount(0);
  const grid = alphaGroup.locator(".tg-grid");
  await expect(grid).toBeVisible();
  await expect(grid).toContainText(`Alpha One ${STAMP}`);

  await page.getByTestId("tg-view-list").click();
  await expect(alphaGroup.getByTestId("tg-season")).toBeVisible();

  await toggle.click();
  await expect(alphaGroup.getByTestId("tg-season")).toBeHidden();

  // --- the two views ------------------------------------------------------
  // /seasons used to be a second index over these same rows. It is a view now,
  // and the view is in the URL so the flat list can still be linked to.
  await page.getByTestId("tg-mode-seasons").click();
  await expect(page).toHaveURL(/\?view=seasons$/);
  await expect(page.getByTestId("tg-mode-seasons")).toHaveAttribute("aria-pressed", "true");
  // The band follows the view — a union of the two would describe neither.
  await expect(page.getByRole("list", { name: "Season summary" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Tournament summary" })).toHaveCount(0);
  // Flat: the accordion is gone, the seasons are cards, and the layout pair
  // goes with it (this view IS the grid, so it has only one state to offer).
  await expect(page.getByTestId(`tg-${alpha}`)).toHaveCount(0);
  await expect(page.getByTestId("tg-view-grid")).toHaveCount(0);
  await expect(page.getByTestId("competitions-list")).toContainText(`Alpha One ${STAMP}`);

  // The flat view inherits the toolbar the old /seasons index never had.
  await page.getByTestId("tg-search").fill("nothing-matches-this");
  await expect(page.getByTestId("tg-noresults")).toBeVisible();
  await page.getByTestId("tg-search").fill("");

  await page.getByTestId("tg-mode-grouped").click();
  await expect(page).toHaveURL(/\/tournaments$/);
  await expect(page.getByTestId(`tg-${alpha}`)).toBeVisible();

  // Every inbound /seasons link and bookmark lands on that flat view.
  await page.goto("/seasons");
  await expect(page).toHaveURL(/\/tournaments\?view=seasons$/);
  await expect(page.getByTestId("tg-mode-seasons")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("competitions-list")).toContainText(`Alpha One ${STAMP}`);

  // The season WORKSPACE did not move.
  //
  // Seasons live inside their tournament's group, and a group starts CLOSED —
  // so the row is in the DOM (which is why the containsText above passes) while
  // being unreachable to role queries, exactly as it is unreachable to a person
  // until they open it. Open it the way they would.
  const alphaToggle = page.getByTestId(`tg-toggle-${alpha}`);
  if ((await alphaToggle.getAttribute("aria-expanded")) === "false") {
    await alphaToggle.click();
  }
  await page
    .getByTestId("tg-season")
    .filter({ hasText: `Alpha One ${STAMP}` })
    .click();
  await expect(page).toHaveURL(/\/seasons\/[^/?#]+$/, COLD);
});

test("tournaments index: axe zero violations", async ({ page }) => {
  await otpLogin(page, `74${STAMP}`);
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await dialog(page)
    .getByLabel("Organization name")
    .filter({ visible: true })
    .fill(`Axe Org ${STAMP}`);
  await dialog(page).getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toHaveText(`Axe Org ${STAMP}`, COLD);

  // Scan the populated surface: the empty state exercises none of the new
  // chrome (band, toolbar, header figures, overflow menu).
  await page.goto("/tournaments");
  await page.getByTestId("firstrun-tournament").click();
  await dialog(page)
    .getByLabel("Tournament name")
    .filter({ visible: true })
    .fill(`Axe Cup ${STAMP}`);
  await dialog(page).getByRole("button", { name: "Create tournament" }).click();
  await expect(page).toHaveURL(/\/tournaments\/.+/, COLD);

  await page.goto("/tournaments");
  await expect(page.getByTestId("tg-search")).toBeVisible();
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual([]);
});
