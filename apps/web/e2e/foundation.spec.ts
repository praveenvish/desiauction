import { expect, test } from "@playwright/test";

test("home page boots and renders the marketing landing", async ({ page }) => {
  await page.goto("/");
  // The root `/` is the marketing landing since the mk- redesign (28a11d8); the
  // old IP-0 scaffold ("DesiAuction NEXT" + app-version) no longer exists. Assert
  // the real landing boots: title + the hero heading render.
  await expect(page).toHaveTitle(/DesiAuction/);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
});

test("healthz serves the contract shape", async ({ request }) => {
  const response = await request.get("/healthz");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { status: string; checks: Record<string, string> };
  expect(body.status).toBe("ok");
});
