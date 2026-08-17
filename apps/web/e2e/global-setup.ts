// Warm the dev server's on-demand compiler before parallel workers start —
// first-hit route compiles otherwise inject 10s+ of jitter into early tests.
// Production servers (CI option) are pre-compiled; warming is then a no-op.
//
// WARMING IS BOUNDED, AND THAT IS THE POINT. This used to be one
// `Promise.all` over the whole list, so every route below started compiling at
// the same instant. Next compiles each in its own pass with the full module
// graph in memory, and forty at once blew the dev server's heap before a single
// test ran — the server restarted mid-warm and every early spec failed
// ECONNREFUSED. Those failures looked exactly like application bugs, which is
// how the suite came to be described as "11 of 20 failing".
//
// The heap ceiling was raised twice chasing this (4096 → 8192). It was never a
// heap problem; it was a concurrency problem wearing a heap costume.
const WARM_CONCURRENCY = 4;

const ROUTES = [
  "/login",
  "/c",
  "/c/warmup",
  "/home",
  "/help",
  "/inbox",
  "/money",
  "/account",
  "/orgs",
  "/org/warmup",
  "/join/warmup",
  // /seasons is a redirect now, so warming it compiles nothing: the index it
  // forwards to is the route that has to be warm.
  "/tournaments",
  "/tournaments/warmup",
  "/seasons/warmup",
  "/seasons/warmup/register",
  "/seasons/warmup/registrations",
  "/seasons/warmup/teams",
  "/seasons/warmup/fixtures",
  "/seasons/warmup/standings",
  "/seasons/warmup/auction",
  "/seasons/warmup/auction/live",
  "/seasons/warmup/auction/cockpit",
  "/seasons/warmup/auction/spectate",
  "/seasons/warmup/readiness",
  "/seasons/warmup/money",
  "/org/warmup/settlement",
  "/org/warmup/money",
  "/org/warmup/money/deliveries",
  "/org/warmup/money/reconciliation",
  "/admin",
  "/admin/orgs",
  "/admin/orgs/warmup",
  "/admin/users",
  "/admin/users/warmup",
  "/admin/audit",
  "/admin/health",
  "/admin/messaging",
  "/gallery",
  "/",
];

async function warmRoutes(base: string): Promise<void> {
  const queue = [...ROUTES];
  const worker = async (): Promise<void> => {
    for (;;) {
      const route = queue.shift();
      if (route === undefined) {
        return;
      }
      // Failures are ignored on purpose: a warm is an optimisation, and a route
      // that 404s or redirects has still been compiled, which is the point.
      await fetch(`${base}${route}`, { redirect: "manual" }).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: WARM_CONCURRENCY }, () => worker()));
}

/**
 * Walk one real sign-in through a real browser, start to finish.
 *
 * A GET fetch, however many routes it hits, never reaches a SERVER ACTION —
 * `requestOtpAction`, `verifyOtpAction`, `updateProfileAction` — because those
 * compile only when a browser posts to them the way React's own client runtime
 * does. Every spec's first login was therefore the first time any of those
 * three ever ran in the process, on top of whichever route redirect landed on
 * next, and that stack of cold compiles routinely blew past the default 5s
 * `expect` timeout on "did we leave /login". It read as an app bug — the
 * button even rendered `disabled`, mid-request — and it was purely that
 * nothing had warmed the action path route warming cannot reach.
 *
 * Best effort, like the routes above: if sign-in is genuinely broken this does
 * not fail setup and say so cryptically — it fails on the first real test,
 * with a real assertion and a real stack trace, which is a better bug report.
 */
async function warmSignIn(base: string): Promise<void> {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: base });
    const phone = `80${String(Date.now()).slice(-8)}`;
    await page.goto("/login");
    await page.getByLabel("Mobile number").fill(phone);
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByTestId("login-form").waitFor({ state: "attached" });
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="login-form"]')?.getAttribute("data-step") === "code",
      { timeout: 20_000 },
    );
    const { latestOtp } = await import("./otp");
    const code = await latestOtp(phone, 10_000);
    await page.getByLabel("6-digit code").fill(code);
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 20_000 });
    await page.getByLabel("What should we call you?").fill("Warmup");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/home/, { timeout: 20_000 });
  } catch {
    // See above: a failure here surfaces on the first real test instead.
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(): Promise<void> {
  const base = "http://localhost:3050";
  await warmRoutes(base);
  await warmSignIn(base);
}
