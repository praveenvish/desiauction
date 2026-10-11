import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { scoringSession, seedScoringFixture, readScoringFixture } from "./scoring-fixtures";
async function capture(page: Page, name: string) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}
for (const theme of ["daylight", "floodlight"] as const) {
  test(`Football two halves, red removal, offline goal, draw and shootout · ${theme}`, async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(180000);
    const fixture = await seedScoringFixture({
      sport: "football",
      formatKey: "football_90_shootout",
      publicDelaySeconds: 0,
    });
    await scoringSession(context, fixture.actorToken);
    await page.addInitScript((value) => localStorage.setItem("ls1:theme", value), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/score/${fixture.fixtureId}/setup`);
    await expect(page.getByTestId("timed-setup")).toBeVisible();
    await capture(page, `football-setup-${theme}`);
    await page.getByRole("button", { name: "Start match", exact: true }).click();
    await expect(page.getByTestId("timed-pad")).toBeVisible();
    await page.getByRole("button", { name: "Start period 1", exact: true }).click();
    const watcher = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const viewer = await watcher.newPage();
      const response = await viewer.goto(`/c/${fixture.slug}/m/Match%201`);
      if (!response) throw new Error("SSR response missing");
      expect(await response.text()).toContain('aria-label="Current score"');
      await viewer.evaluate(
        (value) => document.documentElement.setAttribute("data-theme", value),
        theme,
      );
      await page
        .getByRole("combobox", { name: "Scorer (optional)", exact: true })
        .selectOption({ label: "Home player 1" });
      await page
        .getByRole("combobox", { name: "Assist (optional)", exact: true })
        .selectOption({ label: "Home player 2" });
      await context.setOffline(true);
      await page.getByRole("button", { name: "+ Goal", exact: true }).click();
      await expect(page.getByTestId("timed-home-points")).toHaveText("1");
      await expect(page.getByRole("status").filter({ hasText: "Offline" })).toContainText(
        "Offline",
      );
      await context.setOffline(false);
      await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toHaveText("Saved");
      await expect(viewer.getByTestId("live-score")).toContainText("1–0", { timeout: 3000 });
      await page
        .getByRole("combobox", { name: "Active player", exact: true })
        .selectOption({ label: "Home player 3" });
      await page.getByRole("button", { name: "Red card", exact: true }).click();
      await expect(
        page
          .getByRole("combobox", { name: "Active player", exact: true })
          .getByRole("option", { name: "Home player 3", exact: true }),
      ).toHaveCount(0);
      await expect(viewer.getByRole("list", { name: "Match timeline" })).toContainText("red card");
      await page.getByRole("button", { name: "Stop clock", exact: true }).click();
      await capture(page, `football-pad-${theme}`);
      await capture(viewer, `football-live-${theme}`);
      await page.setViewportSize({ width: 1280, height: 900 });
      await viewer.setViewportSize({ width: 1280, height: 900 });
      await capture(page, `football-pad-laptop-${theme}`);
      await capture(viewer, `football-live-laptop-${theme}`);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "End period 1", exact: true }).click();
      await page.getByRole("button", { name: "Start period 2", exact: true }).click();
      await page.getByRole("combobox", { name: "Team", exact: true }).selectOption("away");
      await page
        .getByRole("combobox", { name: "Scorer (optional)", exact: true })
        .selectOption({ label: "Away player 1" });
      await page.getByRole("button", { name: "+ Goal", exact: true }).click();
      await expect(viewer.getByTestId("live-score")).toContainText("1–1", { timeout: 3000 });
      await page.getByRole("button", { name: "End period 2", exact: true }).click();
      await expect(page.getByRole("group", { name: /Shootout/ })).toBeVisible();
      for (let i = 0; i < 3; i++) {
        await page.getByRole("button", { name: "Penalty scored", exact: true }).click();
        await page.getByRole("button", { name: "Penalty missed", exact: true }).click();
      }
      await expect(page.getByRole("button", { name: "Finish match", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Finish match", exact: true }).click();
      await expect(page.getByText("Match finished", { exact: true })).toBeVisible();
      await expect(viewer.getByTestId("live-result")).toContainText("3–0 on penalties");
      await expect(viewer.getByTestId("live-score")).toContainText("1–1");
      await capture(viewer, `football-result-${theme}`);
      const stored = await readScoringFixture(fixture.fixtureId);
      expect(stored.match?.finishedAt).toBeTruthy();
      expect(stored.events.filter((event) => event.type === "score")).toHaveLength(2);
      expect(stored.events.filter((event) => event.type === "shootout_attempt")).toHaveLength(6);
    } finally {
      await watcher.close();
    }
  });
  for (const sport of ["basketball", "hockey"] as const)
    test(`${sport} regulation result uses its own recorded statistics · ${theme}`, async ({
      page,
      context,
    }) => {
      const fixture = await seedScoringFixture({
        sport,
        formatKey: sport === "basketball" ? "basketball_40" : "hockey_60",
        publicDelaySeconds: 0,
      });
      await scoringSession(context, fixture.actorToken);
      await page.addInitScript((value) => localStorage.setItem("ls1:theme", value), theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/score/${fixture.fixtureId}/setup`);
      await page.getByRole("button", { name: "Start match", exact: true }).click();
      await expect(page.getByTestId("timed-pad")).toBeVisible();
      await page.getByRole("button", { name: "Start period 1", exact: true }).click();
      await page
        .getByRole("combobox", { name: "Scorer (optional)", exact: true })
        .selectOption({ label: "Home player 1" });
      await page
        .getByRole("button", {
          name: sport === "basketball" ? "+ 3 points" : "+ Goal",
          exact: true,
        })
        .click();
      if (sport === "basketball")
        await page.getByRole("button", { name: "Foul", exact: true }).click();
      await capture(page, `${sport}-pad-${theme}`);
      for (let period = 1; period <= 4; period++) {
        await page.getByRole("button", { name: `End period ${period}`, exact: true }).click();
        if (period < 4)
          await page
            .getByRole("button", { name: `Start period ${period + 1}`, exact: true })
            .click();
      }
      await page.getByRole("button", { name: "Finish match", exact: true }).click();
      await expect(page.getByText("Match finished", { exact: true })).toBeVisible();
      await page.goto(`/c/${fixture.slug}/m/Match%201`);
      await expect(page.getByTestId("live-result")).toContainText(
        sport === "basketball" ? "3 points" : "1 goals",
      );
      await capture(page, `${sport}-result-${theme}`);
    });
}
