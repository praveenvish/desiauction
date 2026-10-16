import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { scoringSession, seedScoringFixture } from "./scoring-fixtures";
async function capture(page: Page, name: string) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}
for (const theme of ["daylight", "floodlight"] as const) {
  test(`Scored lobby two rounds, offline kills, second viewer, exact standings and top fragger · ${theme}`, async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(120000);
    const fixture = await seedScoringFixture({
      sport: "battle_royale",
      formatKey: "lobby_1",
      publicDelaySeconds: 0,
    });
    await scoringSession(context, fixture.actorToken);
    await page.addInitScript((value) => localStorage.setItem("ls1:theme", value), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/score/${fixture.fixtureId}/setup`);
    await expect(page.getByTestId("placement-setup")).toBeVisible();
    await page.getByLabel("Rounds", { exact: true }).fill("2");
    await capture(page, `lobby-setup-${theme}`);
    await page.getByRole("button", { name: "Start match", exact: true }).click();
    await expect(page.getByTestId("placement-pad")).toBeVisible();
    const watcher = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const viewer = await watcher.newPage();
      const response = await viewer.goto(`/c/${fixture.slug}/m/Match%201`);
      if (!response) throw new Error("SSR response missing");
      expect(response.status()).toBe(200);
      expect(await response.text()).toContain("Lobby table");
      await viewer.evaluate(
        (value) => document.documentElement.setAttribute("data-theme", value),
        theme,
      );
      await page.getByRole("spinbutton", { name: "Home player 1 kills", exact: true }).fill("7");
      await page.getByRole("spinbutton", { name: "Away player 1 kills", exact: true }).fill("2");
      await context.setOffline(true);
      await page.getByRole("button", { name: "Save round", exact: true }).click();
      await expect(page.getByTestId("live-score")).toContainText("Round 1 of 2");
      await expect(page.getByRole("status").filter({ hasText: "Offline" })).toContainText(
        "Offline",
      );
      await context.setOffline(false);
      await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toHaveText("Saved");
      await expect(viewer.getByTestId("live-score")).toContainText("Round 1 of 2", {
        timeout: 3000,
      });
      await capture(page, `lobby-pad-${theme}`);
      const acceptedSsr = await viewer.reload();
      if (!acceptedSsr) throw new Error("Accepted lobby SSR response missing");
      expect(await acceptedSsr.text()).toContain("Lobby table");
      await viewer.evaluate(
        (value) => document.documentElement.setAttribute("data-theme", value),
        theme,
      );
      await capture(viewer, `lobby-live-${theme}`);
      await page.setViewportSize({ width: 1280, height: 900 });
      await viewer.setViewportSize({ width: 1280, height: 900 });
      await capture(page, `lobby-pad-laptop-${theme}`);
      await capture(viewer, `lobby-live-laptop-${theme}`);
      await page.getByRole("button", { name: "Save round", exact: true }).click();
      await expect(viewer.getByTestId("live-score")).toContainText("Round 2 of 2", {
        timeout: 3000,
      });
      await page.getByRole("button", { name: "Finish match", exact: true }).click();
      await expect(page.getByText("Match finished", { exact: true })).toBeVisible();
      await expect(viewer.getByTestId("result-panel")).toContainText("Top fragger");
      await expect(viewer.getByTestId("result-panel")).toContainText("Home player 1");
      await expect(viewer.getByTestId("result-panel")).toContainText("14 kills");
      await expect(
        viewer.getByTestId("live-score").getByRole("row").filter({ hasText: "LS1 Strikers" }),
      ).toContainText("34");
      await capture(viewer, `lobby-result-${theme}`);
      await page.goto(`/seasons/${fixture.slug}/standings`);
      await expect(page.getByRole("row").filter({ hasText: "LS1 Strikers" })).toContainText("34");
    } finally {
      await watcher.close();
    }
  });
}
