import { expect, test, type Page, type Route } from "@playwright/test";

import { latestOtp } from "./otp";

// This spec fakes network responses with `page.route`, so the service worker
// is blocked for it: on WebKit, once a worker controls the page, page-level
// routing never sees the page's requests (even ones the worker passes
// through), and the fakes would go silently unused (playwright.config.ts).
test.use({ serviceWorkers: "block" });

/*
 * A REQUEST THAT NEVER COMES BACK (PRR 2026-09-29).
 *
 * A server action rejects when the network drops under it or when the page is
 * older than the release now serving. The console used to answer both the same
 * way: the button spun for the rest of the session and nothing was said. This
 * presses a real button with the request cut from under it, in a real browser,
 * and checks the three things a person needs — the screen lets go, it says
 * what happened, and the same button works the moment the network does.
 */

const STAMP = String(Date.now()).slice(-8);
const COLD = { timeout: 30_000 } as const;

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
    await page.getByLabel("What should we call you?").fill("Lost Request Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
}

/** Every server action is a POST carrying this header; nothing else is. */
const isAction = (route: Route): boolean =>
  route.request().method() === "POST" && route.request().headers()["next-action"] !== undefined;

test("a lost request lets go of the screen, says so, and the retry works", async ({ page }) => {
  test.setTimeout(120_000);
  await otpLogin(page, `69${STAMP}`);

  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Club name").filter({ visible: true }).fill(`Lost Org ${STAMP}`);
  await page.getByRole("button", { name: "Create club" }).click();
  await expect(page.getByTestId("org-name")).toBeVisible();

  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Lost Cup ${STAMP}`);
  await page.getByLabel("Location").fill("Thane");
  await page.getByLabel("Starts on").fill("2026-11-01");
  await page.getByLabel("Ends on").fill("2026-11-15");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-status")).toHaveText("draft");
  const seasonUrl = page.url();

  const notice = page.getByTestId("action-failure-notice");
  const advance = page.getByTestId("advance-status");
  await expect(notice).toHaveCount(0);

  // 1 · THE CONNECTION DROPS UNDER THE REQUEST.
  await page.route("**/*", (route) => (isAction(route) ? route.abort("failed") : route.fallback()));
  await advance.click();
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-kind", "network");
  await expect(notice).toHaveAttribute("role", "alert");
  // The screen let go: the same button can be pressed again.
  await expect(advance).toBeEnabled();
  // Nothing was changed by the request that never arrived.
  await expect(page.getByTestId("competition-status")).toHaveText("draft");
  // At the top, clear of the thumb-reach controls at the bottom of a phone.
  const box = await notice.boundingBox();
  expect(box?.y ?? 999).toBeLessThan(120);

  // 2 · THE NETWORK IS BACK: the retry goes through.
  await page.unroute("**/*");
  await advance.click();
  await expect(page.getByTestId("competition-status")).toHaveText("setup");

  // 3 · ANOTHER SCREEN: a request lost on the last one is not news here.
  await page.goto(`${seasonUrl}/teams`);
  await expect(page.getByTestId("open-add-team")).toBeVisible(COLD);
  await expect(notice).toHaveCount(0);

  // 4 · THE PAGE IS OLDER THAN THE RELEASE NOW SERVING. This is what the
  // server answers for an action it does not have.
  await page.goto(seasonUrl);
  await expect(advance).toBeVisible(COLD);
  await page.route("**/*", (route) =>
    isAction(route)
      ? route.fulfill({
          status: 404,
          headers: { "x-nextjs-action-not-found": "1", "content-type": "text/plain" },
          body: "Server action not found.",
        })
      : route.fallback(),
  );
  await advance.click();
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-kind", "stale-page");
  await expect(notice).toContainText("out of date");
  await expect(advance).toBeEnabled();
  await page.unroute("**/*");

  // Dismissing it is the person's to do, and it stays dismissed.
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
});
