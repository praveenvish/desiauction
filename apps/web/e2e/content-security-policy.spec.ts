import { expect, test, type Page } from "@playwright/test";

import { latestOtp, resetOtpBudget } from "./otp";

// THE SCRIPT POLICY, PROVEN AGAINST THE REAL PAGES.
//
// middleware.ts sends a nonce-based Content-Security-Policy on every page —
// Report-Only unless CSP_ENFORCE is set. Report-Only blocks nothing, so the only
// way to know the policy is safe to enforce is to load every kind of surface
// under it and require that the browser reported NOTHING. That is this spec:
// any violation, on any page it visits, fails it. It is also the reason the
// switch to enforcement is a one-line env change rather than a leap of faith.

const FOUNDER = "9999000001"; // platform admin + organizer in the demo seed

const PUBLIC = [
  "/",
  "/features",
  "/pricing",
  "/help",
  "/c",
  "/schedule-demo",
  "/legal/privacy",
  "/newsletter/unsubscribe",
  "/login",
];

const CONSOLE = [
  "/home",
  "/account",
  "/orgs",
  "/tournaments",
  "/inbox",
  "/admin",
  "/seasons/demo-cup-settled",
  "/seasons/demo-cup-settled/auction",
  // The live room's socket is the connect-src case the policy exists to allow.
  "/seasons/demo-cup-settled/auction/spectate",
];

/** Every CSP complaint the browser raises, report-only or not. */
function watchViolations(page: Page): string[] {
  const seen: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Content Security Policy|Content-Security-Policy/i.test(text)) {
      seen.push(`${page.url()} :: ${text}`);
    }
  });
  page.on("request", (request) => {
    if (request.url().endsWith("/api/csp-report")) {
      seen.push(`${page.url()} :: report sent: ${request.postData() ?? ""}`);
    }
  });
  return seen;
}

async function otpLogin(page: Page, phone: string): Promise<void> {
  await resetOtpBudget(phone);
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
    timeout: 30_000,
  });
  await page.getByLabel("6-digit code").fill(await latestOtp(phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("every page carries a nonce policy, and every script it runs carries the nonce", async ({
  page,
}) => {
  const response = await page.goto("/");
  const headers = response?.headers() ?? {};
  const policy =
    headers["content-security-policy-report-only"] ?? headers["content-security-policy"] ?? "";
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  expect(nonce, "no nonce in the page's script policy").toBeDefined();
  expect(policy).toContain("'strict-dynamic'");
  // A request id rides back on the response for correlation.
  expect(headers["x-request-id"]).toBeTruthy();
  // Every script element in the document was issued the request's nonce.
  const unnonced = await page.evaluate(
    () => [...document.querySelectorAll("script")].filter((script) => script.nonce === "").length,
  );
  expect(unnonced, "a script rendered without the nonce").toBe(0);
  // And the nonce is per request, never reused.
  const again = (await page.goto("/"))?.headers() ?? {};
  expect(again["content-security-policy-report-only"] ?? again["content-security-policy"]).not.toBe(
    policy,
  );
});

test("public surfaces raise no policy violations", async ({ page }) => {
  const violations = watchViolations(page);
  for (const path of PUBLIC) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  expect(violations).toEqual([]);
});

test("console, administration and the live room raise no policy violations", async ({ page }) => {
  test.setTimeout(120_000);
  await otpLogin(page, FOUNDER);
  const violations = watchViolations(page);
  for (const path of CONSOLE) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  expect(violations).toEqual([]);
});
