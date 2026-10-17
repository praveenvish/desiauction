import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  scoringSession,
  seedScoringFixture,
  readScoringFixture,
  committedQueue,
  persistedQueue,
} from "./scoring-fixtures";
async function capture(page: Page, name: string) {
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}
for (const theme of ["daylight", "floodlight"] as const) {
  for (const sport of ["badminton", "table_tennis"] as const) {
    test(`${sport} full rally journey · ${theme}`, async ({ page, context, browser }) => {
      test.setTimeout(240_000);
      const tie = sport === "table_tennis",
        formatKey = tie ? "tt_tie_5" : "badminton_bo3";
      const fixture = await seedScoringFixture({ sport, formatKey, publicDelaySeconds: 0 });
      await scoringSession(context, fixture.actorToken);
      await page.addInitScript((value) => {
        localStorage.setItem("ls1:theme", value);
      }, theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/score/${fixture.fixtureId}/setup`);
      for (let no = 1; no <= (tie ? 5 : 1); no++) {
        await page
          .getByTestId(`rally-player-${String(no)}-${fixture.homePlayers[0] ?? ""}`)
          .click();
        await page
          .getByTestId(`rally-player-${String(no)}-${fixture.awayPlayers[0] ?? ""}`)
          .click();
      }
      await capture(page, `rally-setup-${sport}-${theme}`);
      await page.getByTestId("rally-start").click();
      await expect(page.getByTestId("rally-pad")).toBeVisible();
      await expect(page.getByTestId("rally-point-home")).toBeEnabled();
      const watcher = await browser.newContext({ viewport: { width: 390, height: 844 } });
      try {
        const viewer = await watcher.newPage();
        const firstPaint = await viewer.goto(`/c/${fixture.slug}/m/Match%201`);
        const serverHtml = (await firstPaint!.text()).replace(/<[^>]*>/g, "");
        expect(await firstPaint!.text()).toContain('aria-label="Current points"');
        expect(serverHtml).toContain("0–0");
        await viewer.evaluate((value) => {
          document.documentElement.setAttribute("data-theme", value);
        }, theme);
        await expect(viewer.getByTestId("live-rally-server")).toContainText("LS1 Strikers");
        await expect(viewer.getByTestId("live-tab-charts")).toHaveCount(0);
        await page.getByTestId("rally-point-home").click();
        await expect(viewer.getByTestId("live-score")).toContainText("1–0", { timeout: 3000 });
        await page.getByTestId("rally-undo").click();
        await expect(page.getByTestId("rally-home-points")).toHaveText("0");
        await expect(viewer.getByTestId("live-score")).toContainText("0–0");
        if (sport === "badminton" && theme === "daylight") {
          await expect(page.getByRole("status")).toHaveText("Saved");
          await page.goto("/score");
          await page.getByRole("button", { name: "Get ready for match day", exact: true }).click();
          await expect(page.getByText("✓ Works offline", { exact: true })).toBeVisible({
            timeout: 30000,
          });
          await page.goto(`/score/${fixture.fixtureId}`);
          await expect(page.getByTestId("rally-point-home")).toBeEnabled();
          await context.setOffline(true);
          await page.getByTestId("rally-point-home").click();
          await expect(page.getByRole("status")).toContainText("1 entries waiting to send");
          const savedIds = await committedQueue(page, fixture.fixtureId, ["rally"]);
          await expect(page.getByTestId("rally-home-points")).toHaveText("1");
          await page.goto(`/score/shell#${fixture.fixtureId}`);
          await expect(page.getByTestId("rally-home-points")).toHaveText("1");
          expect(
            (await persistedQueue(page, fixture.fixtureId)).map((item) => item.event.eventId),
          ).toEqual(savedIds);
          await context.setOffline(false);
          await expect(page.getByRole("status")).toHaveText("Saved");
          const synchronized = await readScoringFixture(fixture.fixtureId);
          expect(
            synchronized.events
              .filter((event) => savedIds.includes(event.eventId))
              .map((event) => event.eventId),
          ).toEqual(savedIds);
          await page.getByTestId("rally-undo").click();
          await expect(page.getByTestId("rally-home-points")).toHaveText("0");
        }
        await capture(page, `rally-pad-${sport}-${theme}`);
        await capture(viewer, `rally-live-${sport}-${theme}`);
        for (let rubber = 1; rubber <= (tie ? 3 : 1); rubber++) {
          for (let game = 1; game <= (tie ? 3 : 2); game++) {
            for (let point = 0; point < (tie ? 11 : 21); point++)
              await page.getByTestId("rally-point-home").click();
            await expect(page.getByTestId("rally-point-home")).toBeDisabled();
            if (rubber !== (tie ? 3 : 1) || game !== (tie ? 3 : 2)) {
              await page.getByTestId("rally-next-game").click();
              await page.getByTestId("rally-start-game").click();
              await expect(page.getByTestId("rally-point-home")).toBeEnabled();
            }
          }
        }
        await expect(page.getByTestId("rally-result")).toContainText(
          tie ? "3–0 rubbers" : "1–0 rubbers",
        );
        await expect(page.getByTestId("rally-finish")).toBeEnabled();
        await page.getByTestId("rally-finish").click();
        await expect(page.getByText("Match finished", { exact: true })).toBeVisible();
        // The finish is queued like any entry; read the database once it is sent.
        await expect(page.getByRole("status")).toHaveText("Saved");
        await expect(viewer.getByTestId("live-result")).toContainText(
          tie ? "3–0 rubbers" : "1–0 rubbers",
        );
        const committed = await readScoringFixture(fixture.fixtureId);
        expect(committed.match?.finishedAt).toBeTruthy();
        expect(committed.events.filter((event) => event.type === "rubber_started")).toHaveLength(
          tie ? 9 : 2,
        );
        expect(committed.events.filter((event) => event.type === "rally")).toHaveLength(
          tie ? 100 : theme === "daylight" ? 44 : 43,
        );
        expect(committed.result?.score).toEqual({
          home: { rubbers: tie ? 3 : 1, games: tie ? 9 : 2 },
          away: { rubbers: 0, games: 0 },
        });
        await viewer.getByTestId("live-tab-scorecard").click();
        await expect(viewer.getByTestId("live-rally-games")).toBeVisible();
        for (const width of [390, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await viewer.setViewportSize({ width, height: 900 });
          await capture(page, `rally-finished-pad-${sport}-${theme}-${String(width)}`);
          await capture(viewer, `rally-games-${sport}-${theme}-${String(width)}`);
        }
      } finally {
        await watcher.close();
      }
    });
  }
}

test("Android Chrome volume opt-in requires delivered keys; discovery never scores", async ({
  browser,
  browserName,
}) => {
  // Hardware volume keys can only be sent through Chromium's DevTools protocol.
  test.skip(browserName !== "chromium", "volume keys are sent over CDP, Chromium only");
  const fixture = await seedScoringFixture({
    sport: "badminton",
    formatKey: "badminton_bo3",
    publicDelaySeconds: 0,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  });
  try {
    await scoringSession(context, fixture.actorToken);
    const page = await context.newPage();
    await page.goto(`/score/${fixture.fixtureId}/setup`);
    await page.getByTestId(`rally-player-1-${fixture.homePlayers[0] ?? ""}`).click();
    await page.getByTestId(`rally-player-1-${fixture.awayPlayers[0] ?? ""}`).click();
    await page.getByTestId("rally-start").click();
    await expect(page.getByTestId("rally-point-home")).toBeEnabled();
    await expect(page.getByRole("checkbox", { name: /Use volume buttons/ })).toHaveCount(0);
    const keyboard = await context.newCDPSession(page);
    await keyboard.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "AudioVolumeUp",
      windowsVirtualKeyCode: 175,
    });
    await keyboard.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "AudioVolumeUp",
      windowsVirtualKeyCode: 175,
    });
    await expect(page.getByRole("checkbox", { name: /Use volume buttons/ })).toBeVisible();
    await expect(page.getByTestId("rally-home-points")).toHaveText("0");
    await page.getByRole("checkbox", { name: /Use volume buttons/ }).check();
    await keyboard.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "AudioVolumeUp",
      windowsVirtualKeyCode: 175,
    });
    await keyboard.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "AudioVolumeUp",
      windowsVirtualKeyCode: 175,
    });
    await expect(page.getByTestId("rally-home-points")).toHaveText("1");
  } finally {
    await context.close();
  }
});
