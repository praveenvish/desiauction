import { expect, test } from "@playwright/test";

test("foundation page boots, reads config and renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "DesiAuction NEXT" })).toBeVisible();
  await expect(page.getByTestId("app-version")).toHaveText("dev");
});

test("healthz serves the contract shape", async ({ request }) => {
  const response = await request.get("/healthz");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { status: string; checks: Record<string, string> };
  expect(body.status).toBe("ok");
});
