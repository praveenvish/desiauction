import { createHash, randomBytes } from "node:crypto";

import { createDb, grants, newId, people, sessions } from "@desiauction/db";
import { expect, test } from "@playwright/test";

import { auctionValidationEnv } from "./env";

const handle = createDb(auctionValidationEnv.databaseUrl, { max: 1 });
const actor = newId();
const token = randomBytes(32).toString("base64url");

test.beforeAll(async () => {
  await handle.db.insert(people).values({
    id: actor,
    name: "Synthetic email preview operator",
    email: `email-preview-${actor.toLowerCase()}@example.test`,
  });
  await handle.db.insert(grants).values({
    id: newId(),
    personId: actor,
    scopeType: "platform",
    scopeId: "00000000000000000000000000",
    capabilitySet: "platform:admin",
    grantedBy: actor,
  });
  await handle.db.insert(sessions).values({
    id: newId(),
    personId: actor,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
});

test.afterAll(async () => {
  // Fixture ownership is captured by the managed runner; never delete by kind.
  await handle.sql.end();
});

test("the actual sandboxed sign-in email fits a narrow preview without losing its date", async ({
  page,
  context,
}, testInfo) => {
  await context.addCookies([
    { name: "da_session", value: token, url: "http://localhost:3050", httpOnly: true },
  ]);
  await page.setViewportSize({ width: 320, height: 900 });
  const response = await page.goto("/admin/notifications/auth.email_code/email");
  expect(response?.status()).toBe(200);
  const preview = page.getByTestId("template-preview-frame");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("sandbox", "");
  await page.getByTestId("template-preview-mobile").click();
  for (const colour of ["light", "dark"] as const) {
    await page.getByTestId(`template-preview-${colour}`).click();
    await preview.scrollIntoViewIfNeeded();
    const frame = await preview.contentFrame().locator("body").innerText();
    expect(frame).toContain("Requested");
    expect(frame).toContain("IST");
    const geometry = await preview
      .contentFrame()
      .locator("html")
      .evaluate((element) => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
        scripts: element.ownerDocument.scripts.length,
      }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
    expect(geometry.scripts).toBe(0);
    const code = preview.contentFrame().locator(".da-code-value");
    await expect(code).toHaveText(/^\d{6}$/);
    const codeGeometry = await code.evaluate((element) => ({
      fontSize: parseFloat(getComputedStyle(element).fontSize),
      right: element.getBoundingClientRect().right,
      viewport: element.ownerDocument.documentElement.clientWidth,
    }));
    expect(codeGeometry.fontSize).toBeGreaterThanOrEqual(32);
    expect(codeGeometry.right).toBeLessThanOrEqual(codeGeometry.viewport);
    await preview.screenshot({ path: testInfo.outputPath(`email-${colour}-320.png`) });
  }
});
