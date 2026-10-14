import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { scoringSession, seedScoringFixture, readScoringFixture } from "./scoring-fixtures";
async function capture(page: Page, name: string) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}
for (const theme of ["daylight", "floodlight"] as const) {
  test(`Kabaddi all-out, super tackle and completed match · ${theme}`, async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(180000);
    const fixture = await seedScoringFixture({
      sport: "kabaddi",
      formatKey: "pkl_40",
      publicDelaySeconds: 0,
    });
    await scoringSession(context, fixture.actorToken);
    await page.addInitScript((value) => localStorage.setItem("ls1:theme", value), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/score/${fixture.fixtureId}/setup`);
    for (const side of ["Home", "Away"]) {
      const group = page.getByRole("group", {
        name:
          side === "Home"
            ? "LS1 Strikers · Starting mat (7 players)"
            : "LS1 Royals · Starting mat (7 players)",
      });
      for (const checkbox of await group.getByRole("checkbox").all()) await checkbox.uncheck();
      for (let i = 1; i <= 7; i++)
        await group
          .getByRole("checkbox", { name: `${side} player ${String(i)}`, exact: true })
          .check();
    }
    await capture(page, `raid-setup-${theme}`);
    await page.getByRole("button", { name: "Start kabaddi match", exact: true }).click();
    await expect(page.getByTestId("raid-pad")).toBeVisible();
    await page.getByTestId("raid-start-half").click();
    await page.getByTestId("raid-clock-toggle").click();
    const watcher = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const viewer = await watcher.newPage();
      const response = await viewer.goto(`/c/${fixture.slug}/m/Match%201`);
      expect(await response!.text()).toContain('aria-label="Current points"');
      await viewer.evaluate(
        (value) => document.documentElement.setAttribute("data-theme", value),
        theme,
      );
      await expect(
        viewer.getByRole("heading", { name: "Announced lineups", exact: true }),
      ).toHaveCount(0);
      await expect(
        viewer.getByText("Sign in to remind me at the toss", { exact: true }),
      ).toHaveCount(0);
      // All seven defenders out: seven player raid points plus two team all-out points.
      const touched = page.getByRole("group", { name: "Defenders touched", exact: true });
      for (let i = 1; i <= 7; i++)
        await touched
          .getByRole("checkbox", { name: `Away player ${String(i)}`, exact: true })
          .check();
      await page.getByTestId("raid-record").click();
      await expect(page.getByTestId("raid-home-points")).toHaveText("9");
      await expect(viewer.getByTestId("live-score")).toContainText("9–0", { timeout: 3000 });
      await expect(page.getByRole("heading", { name: "LS1 Royals · 7 on mat" })).toBeVisible();
      await page.getByTestId("raid-empty").click();
      // Remove four defenders, then let the remaining three defend a super tackle.
      for (let i = 1; i <= 4; i++)
        await touched
          .getByRole("checkbox", { name: `Away player ${String(i)}`, exact: true })
          .check();
      await page.getByTestId("raid-record").click();
      await page.getByTestId("raid-empty").click();
      await expect(page.getByRole("checkbox", { name: "Bonus", exact: true })).toBeDisabled();
      await expect(
        page.getByText("Bonus needs at least 6 defenders on the mat.", { exact: true }),
      ).toBeVisible();
      await page.getByRole("checkbox", { name: "Tackled", exact: true }).check();
      await page.getByRole("radio", { name: "Away player 5", exact: true }).check();
      await page.getByTestId("raid-record").click();
      await expect(page.getByTestId("raid-away-points")).toHaveText("2");
      await expect(viewer.getByTestId("live-score")).toContainText("13–2", { timeout: 3000 });
      await page.getByTestId("raid-clock-toggle").click();
      const paused = await page.getByTestId("raid-half-clock").textContent();
      await page.waitForTimeout(1100);
      await expect(page.getByTestId("raid-half-clock")).toHaveText(paused!);
      await capture(page, `raid-pad-${theme}`);
      await capture(viewer, `raid-live-${theme}`);
      await page.setViewportSize({ width: 1280, height: 900 });
      await capture(page, `raid-pad-laptop-${theme}`);
      await viewer.setViewportSize({ width: 1280, height: 900 });
      await capture(viewer, `raid-live-laptop-${theme}`);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByTestId("raid-end-half").click();
      await page.getByTestId("raid-start-half").click();
      await page.getByTestId("raid-end-half").click();
      await page.getByTestId("raid-finish").click();
      await expect(page.getByTestId("raid-finished")).toBeVisible();
      await expect(viewer.getByTestId("live-result")).toContainText("11 points");
      const stored = await readScoringFixture(fixture.fixtureId);
      expect(stored.match?.finishedAt).toBeTruthy();
      expect(stored.events.filter((event) => event.type === "raid")).toHaveLength(5);
      await page.goto(`/seasons/${fixture.slug}/awards`);
      await expect(page.getByRole("heading", { name: "Kabaddi season awards" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Best raider", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Best defender", exact: true })).toBeVisible();
      await capture(page, `raid-awards-${theme}`);
      await page.setViewportSize({ width: 1280, height: 900 });
      await capture(page, `raid-awards-laptop-${theme}`);
    } finally {
      await watcher.close();
    }
  });
}
