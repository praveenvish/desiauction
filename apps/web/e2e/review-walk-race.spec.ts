import { expect, test, type Page, type Request } from "@playwright/test";

import { latestOtp } from "./otp";

// This spec fakes network responses with `page.route`, so the service worker
// is blocked for it: on WebKit, once a worker controls the page, page-level
// routing never sees the page's requests (even ones the worker passes
// through), and the fakes would go silently unused (playwright.config.ts).
test.use({ serviceWorkers: "block" });

/*
 * THE REVIEW WALK, WITH PAGES THAT ARRIVE LATE (PRR 2026-09-29).
 *
 * Every approval asks for fresh pages: a refresh, and the page for the next
 * player's address when the sheet moves on. On a slow connection one of those
 * arrives AFTER the next approval has landed — and it was asked for before,
 * so it still says that player is waiting. The roster believed it: the player
 * flipped back to "waiting", and when the last one was approved the walk
 * found somebody "still to review" and jumped back to a player already
 * approved instead of finishing. The database was never wrong.
 *
 * It showed up as player-desk.spec.ts failing about one run in four. Here
 * every page is delivered late on purpose. Measured on this test: 6 failures
 * in 20 runs before the roster learned to doubt a page that disagrees with a
 * confirmed write, none after.
 */

const STAMP = String(Date.now()).slice(-8);
const COLD = { timeout: 30_000 } as const;
/** How late each refreshed page is delivered. */
const LATE_MS = 400;

async function otpLogin(page: Page, phone: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", COLD);
  await page.getByLabel("6-digit code").clear();
  await page.getByLabel("6-digit code").pressSequentially(await latestOtp(phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/, COLD);
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill("Walk Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
}

function playersCsv(): string {
  const rows = Array.from({ length: 4 }, (_, i) => {
    const phone = `6${STAMP}${String(i)}`.slice(0, 9) + String(i);
    return `Walk Player ${String(i)},${phone},batter,A`;
  });
  return ["name,phone,role,base_price_band", ...rows].join("\n");
}

test("the review walk finishes even when a page asked for earlier arrives late", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await otpLogin(page, `68${STAMP}`);

  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Club name").filter({ visible: true }).fill(`Walk Org ${STAMP}`);
  await page.getByRole("button", { name: "Create club" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();

  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Walk Cup ${STAMP}`);
  await page.getByLabel("Location").fill("Andheri");
  await page.getByLabel("Starts on").fill("2026-10-01");
  await page.getByLabel("Ends on").fill("2026-10-15");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-status")).toHaveText("draft");
  await page.getByTestId("advance-status").click();
  await expect(page.getByTestId("competition-status")).toHaveText("setup");
  await page.getByTestId("advance-status").click();
  await expect(page.getByTestId("competition-status")).toHaveText("registration open");
  const seasonUrl = page.url();

  await page.goto(`${seasonUrl}/registrations`);
  await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true", COLD);
  await page.getByTestId("open-import").click();
  await page.getByTestId("import-textarea").evaluate((el, csv) => {
    (el as HTMLTextAreaElement).value = csv;
  }, playersCsv());
  await page.getByTestId("import-preview-btn").click();
  await expect(page.getByTestId("import-preview")).toContainText("4 valid", COLD);
  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("stat-submitted")).toContainText("4");

  await page.getByTestId("start-review").click();
  const sheet = page.getByTestId("player-sheet");
  const subject = page.getByTestId("details-subject");
  await expect(sheet).toBeVisible();

  /*
   * From here on, every page the desk asks for is FETCHED at once — so it
   * holds what the server knew at that moment — and delivered a little late.
   * Server actions (POST) are untouched. Each approval below is pressed while
   * such a page is on its way, which is exactly when the race is lost.
   */
  const isRefresh = (request: Request): boolean =>
    request.method() === "GET" &&
    request.url().includes("/registrations") &&
    request.headers()["rsc"] !== undefined &&
    request.headers()["next-router-prefetch"] === undefined;
  await page.route("**/registrations**", async (route) => {
    if (!isRefresh(route.request())) {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, LATE_MS));
    await route.fulfill({ response });
  });

  const seen = new Set<string>();
  for (let i = 0; i < 4; i += 1) {
    const name = (await subject.textContent()) ?? "";
    // The walk never shows the same player twice.
    expect(seen.has(name), `${name} came round again`).toBe(false);
    seen.add(name);
    const pageOnItsWay = i < 3 ? page.waitForRequest(isRefresh, COLD) : null;
    await page.getByTestId("sheet-approve").click();
    if (i < 3) {
      await expect(subject).not.toHaveText(name, COLD);
      // The page asked for after THIS approval is now in flight; the next
      // approval is pressed before it lands.
      await pageOnItsWay;
    }
  }
  // The walk FINISHES — it does not jump back to a player already approved
  // because a page older than their approval said they were still waiting.
  await expect(sheet).toHaveCount(0, COLD);
  await expect(page.getByText("All caught up")).toBeVisible();

  // Let everything else through; the desk and the database agree.
  await page.unroute("**/registrations**", { behavior: "wait" });
  await expect(page.getByTestId("stat-approved").locator(".stat-value")).toHaveText("4", COLD);
});
