import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  committedQueue,
  persistedQueue,
  readScoringFixture,
  scoringSession,
  seedScoringFixture,
} from "./scoring-fixtures";

for (const name of [
  "DATABASE_URL",
  "APP_DATABASE_URL",
  "SYSTEM_DATABASE_URL",
  "RUNNER_DATABASE_URL",
]) {
  const target = new URL(process.env[name] ?? "");
  if (
    target.hostname !== "127.0.0.1" ||
    target.port !== "15437" ||
    target.pathname !== "/ls1_c29_clean"
  )
    throw new Error(`Isolated database required: ${name}`);
}
const status = (page: Page) => page.locator('main > p[role="status"]').first();
async function views(page: Page, name: string) {
  for (const theme of ["daylight", "floodlight"]) {
    await page.evaluate(async (value) => {
      document.documentElement.setAttribute("data-theme", value);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a instanceof CSSTransition)
          .map((a) => a.finished.catch(() => undefined)),
      );
    }, theme);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: test.info().outputPath(`${name}-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
}
for (const family of ["timed", "placement"] as const) {
  test(`${family} refuses, restores offline finish identity and confirms only after acknowledgement`, async ({
    page,
    context,
  }) => {
    test.setTimeout(180000);
    const fixture = await seedScoringFixture({
      sport: family === "timed" ? "basketball" : "battle_royale",
      formatKey: family === "timed" ? "basketball_40" : "lobby_1",
      longNames: true,
    });
    await scoringSession(context, fixture.actorToken);
    await page.goto(`/score/${fixture.fixtureId}/setup`);
    await page.getByRole("button", { name: "Start match", exact: true }).click();
    await expect(page.getByTestId(`${family}-pad`)).toBeVisible();
    await expect(status(page)).toHaveText("Saved");
    if (family === "timed") {
      await page.getByRole("button", { name: "Start period 1", exact: true }).click();
      await page.getByRole("button", { name: "+ 3 points", exact: true }).click();
      await expect(page.getByTestId("timed-home-points")).toHaveText("3");
    }
    await views(page, `${family}-entry`);
    await page.getByRole("link", { name: "Matches", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Watch live", exact: true })).toBeFocused();
    if (family === "timed") {
      for (let period = 1; period <= 4; period++) {
        await page
          .getByRole("button", { name: `End period ${String(period)}`, exact: true })
          .click();
        if (period < 4)
          await page
            .getByRole("button", { name: `Start period ${String(period + 1)}`, exact: true })
            .click();
      }
    } else {
      // Disclosing a squad keeps its real draft inputs and their values.
      const squad = page.locator("details").first();
      const input = squad.getByRole("spinbutton").nth(1);
      await input.fill("7");
      await squad.locator("summary").click();
      await expect(input).toBeHidden();
      await squad.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(input).toHaveValue("7");
      await input.fill("-1");
      await page.getByRole("button", { name: "Save round", exact: true }).click();
      await expect(page.locator("main").getByRole("alert")).toBeVisible();
      await expect(input).toHaveValue("-1");
      expect(
        (await readScoringFixture(fixture.fixtureId)).events.filter(
          (event) => event.type === "lobby_round",
        ),
      ).toHaveLength(0);
      await input.fill("0");
      await page.getByRole("button", { name: "Save round", exact: true }).click();
    }
    await expect(status(page)).toHaveText("Saved");
    await page.goto("/score");
    await page.getByRole("button", { name: "Get ready for match day", exact: true }).click();
    await expect(page.getByText("✓ Works offline", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await page.goto(`/score/${fixture.fixtureId}`);
    let refused = false;
    await page.route(`**/api/score/${fixture.fixtureId}/events`, async (route) => {
      if (!refused && route.request().method() === "POST") {
        refused = true;
        const body = route.request().postDataJSON() as Record<string, unknown>;
        await route.continue({ postData: JSON.stringify({ ...body, attempt: 999 }) });
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Finish match", exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toBeVisible();
    await expect(page.getByText("Match finished", { exact: true })).toHaveCount(0);
    await expect(status(page)).not.toHaveText(/^Saved/);
    expect(
      (await readScoringFixture(fixture.fixtureId)).events.filter(
        (event) => event.type === "finish",
      ),
    ).toHaveLength(0);
    await expect.poll(async () => (await persistedQueue(page, fixture.fixtureId)).length).toBe(0);
    await page.unroute(`**/api/score/${fixture.fixtureId}/events`);
    await page.reload();
    await expect(status(page)).toHaveText("Saved");
    await context.setOffline(true);
    await page.getByRole("button", { name: "Finish match", exact: true }).click();
    await expect(page.getByText("Finish waiting for acceptance", { exact: true })).toBeVisible();
    const ids = await committedQueue(page, fixture.fixtureId, ["finish"]);
    expect(ids).toHaveLength(1);
    await page.goto(`/score/shell#${fixture.fixtureId}`);
    await expect(page.getByText("Finish waiting for acceptance", { exact: true })).toBeVisible();
    expect(
      (await persistedQueue(page, fixture.fixtureId)).map((item) => item.event.eventId),
    ).toContain(ids[0]);
    await expect(page.getByText("Match finished", { exact: true })).toHaveCount(0);
    let dispatches = 0;
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/score/${fixture.fixtureId}/events`, async (route) => {
      if (route.request().method() === "POST") {
        dispatches++;
        await held;
      }
      await route.continue();
    });
    try {
      await context.setOffline(false);
      await expect.poll(() => dispatches).toBe(1);
      await expect(page.getByText("Match finished", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Finish waiting for acceptance", { exact: true })).toBeVisible();
    } finally {
      release?.();
    }
    await expect(page.getByText("Match finished", { exact: true })).toBeVisible();
    await page.unroute(`**/api/score/${fixture.fixtureId}/events`);
    await expect
      .poll(async () =>
        (await readScoringFixture(fixture.fixtureId)).events
          .filter((event) => event.type === "finish")
          .map((event) => event.eventId),
      )
      .toEqual(ids);
    await context.setOffline(true);
    await page.goto(`/score/shell#${fixture.fixtureId}`);
    await expect(page.getByText("Match finished", { exact: true })).toBeVisible();
    await expect(status(page)).toHaveText("Saved · offline");
    await context.setOffline(false);
    await page.addInitScript(() => {
      indexedDB.open = () => {
        throw new Error("Validation: storage unavailable");
      };
    });
    const response = await page.goto(`/score/${fixture.fixtureId}`);
    expect((await response!.text()).replace(/<[^>]*>/g, "")).toContain("Restoring match");
    await expect(page.locator("main").getByRole("alert")).toBeVisible();
    await expect(page.getByText("Match finished", { exact: true })).toHaveCount(0);
    await expect(status(page)).not.toHaveText(/^Saved/);
  });
}
