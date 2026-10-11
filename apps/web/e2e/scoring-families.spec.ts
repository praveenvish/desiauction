import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  scoringSession,
  seedScoringFixture,
  startScoring,
  nextBowler,
  runBall,
  sent,
  readScoringFixture,
} from "./scoring-fixtures";
const cases = [
  { family: "delivery", sport: "cricket", formatKey: "six_over", event: "ball" },
  { family: "rally", sport: "badminton", formatKey: "badminton_bo3", event: "rally" },
  { family: "raid", sport: "kabaddi", formatKey: "pkl_40", event: "raid" },
  { family: "timed", sport: "football", formatKey: "football_90", event: "score" },
  { family: "placement", sport: "battle_royale", formatKey: "lobby_1", event: "lobby_round" },
] as const;
async function accessiblePad(page: Page, family: string, theme: string) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: test.info().outputPath(`${family}-pad-${theme}.png`),
    fullPage: true,
  });
}
for (const theme of ["daylight", "floodlight"] as const) {
  for (const entry of cases) {
    test(`${entry.family} accepted scoring and public result · ${theme}`, async ({
      page,
      context,
      browser,
    }) => {
      test.setTimeout(180000);
      page.setDefaultTimeout(15000);
      const fixture = await seedScoringFixture({
        sport: entry.sport,
        formatKey: entry.formatKey,
        publicDelaySeconds: 0,
      });
      await scoringSession(context, fixture.actorToken);
      await page.addInitScript((value) => localStorage.setItem("ls1:theme", value), theme);
      await page.setViewportSize({ width: 390, height: 844 });
      if (entry.family === "delivery") {
        await startScoring(page, fixture);
        await accessiblePad(page, entry.family, theme);
        for (let over = 0; over < 6; over++) {
          if (over) await nextBowler(page, `Away player ${String(over + 1)}`);
          for (let ball = 0; ball < 6; ball++) await runBall(page);
        }
        const innings = page.getByRole("dialog", { name: "Start next innings", exact: true });
        await expect(innings).toBeVisible();
        await innings.getByTestId("innings-start-confirm").click();
        await runBall(page, 1);
        await expect(page.getByTestId("finish-sheet")).toBeVisible();
        await page.getByTestId("finish-confirm").click();
        await sent(page);
      } else {
        await page.goto(`/score/${fixture.fixtureId}/setup`);
        if (entry.family === "rally") {
          for (const id of [fixture.homePlayers[0], fixture.awayPlayers[0]]) {
            if (!id) throw new Error("Missing rally player");
            await page.getByTestId(`rally-player-1-${id}`).click();
          }
          await page.getByTestId("rally-start").click();
          await expect(page.getByTestId("rally-point-home")).toBeEnabled();
          await accessiblePad(page, entry.family, theme);
          for (let game = 0; game < 2; game++) {
            for (let point = 0; point < 21; point++)
              await page.getByTestId("rally-point-home").click();
            if (!game) {
              await page.getByTestId("rally-next-game").click();
              await page.getByTestId("rally-start-game").click();
            }
          }
          await page.getByTestId("rally-finish").click();
        } else if (entry.family === "raid") {
          for (const side of ["Home", "Away"]) {
            const group = page.getByRole("group", {
              name: `${side === "Home" ? "LS1 Strikers" : "LS1 Royals"} · Starting mat (7 players)`,
              exact: true,
            });
            for (const checkbox of await group.getByRole("checkbox").all())
              await checkbox.uncheck();
            for (let player = 1; player <= 7; player++)
              await group
                .getByRole("checkbox", { name: `${side} player ${String(player)}`, exact: true })
                .check();
          }
          await page.getByRole("button", { name: "Start kabaddi match", exact: true }).click();
          await page.getByTestId("raid-start-half").click();
          await page.getByTestId("raid-clock-toggle").click();
          await accessiblePad(page, entry.family, theme);
          await page
            .getByRole("group", { name: "Defenders touched", exact: true })
            .getByRole("checkbox", { name: "Away player 1", exact: true })
            .check();
          await page.getByTestId("raid-record").click();
          await expect(page.getByTestId("raid-home-points")).toHaveText("1");
          await page.getByTestId("raid-end-half").click();
          await page.getByTestId("raid-start-half").click();
          await page.getByTestId("raid-end-half").click();
          await page.getByTestId("raid-finish").click();
        } else if (entry.family === "timed") {
          await page.getByRole("button", { name: "Start match", exact: true }).click();
          await page.getByRole("button", { name: "Start period 1", exact: true }).click();
          await accessiblePad(page, entry.family, theme);
          await page
            .getByRole("combobox", { name: "Scorer (optional)", exact: true })
            .selectOption({ label: "Home player 1" });
          await page.getByRole("button", { name: "+ Goal", exact: true }).click();
          await page.getByRole("button", { name: "End period 1", exact: true }).click();
          await page.getByRole("button", { name: "Start period 2", exact: true }).click();
          await page.getByRole("button", { name: "End period 2", exact: true }).click();
          await page.getByRole("button", { name: "Finish match", exact: true }).click();
        } else {
          await page.getByRole("button", { name: "Start match", exact: true }).click();
          await expect(page.getByTestId("placement-pad")).toBeVisible();
          await accessiblePad(page, entry.family, theme);
          await page
            .getByRole("spinbutton", { name: "Home player 1 kills", exact: true })
            .fill("3");
          await page.getByRole("button", { name: "Save round", exact: true }).click();
          await page.getByRole("button", { name: "Finish match", exact: true }).click();
        }
        if (entry.family === "raid") await expect(page.getByTestId("raid-finished")).toBeVisible();
        else await expect(page.getByText("Match finished", { exact: true })).toBeVisible();
        await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toHaveText("Saved");
      }
      const committed = await readScoringFixture(fixture.fixtureId);
      expect(committed.match?.finishedAt).toBeTruthy();
      expect(committed.events.some((event) => event.type === entry.event)).toBe(true);
      expect(committed.events.some((event) => event.type === "finish")).toBe(true);
      expect(committed.projection?.state.family).toBe(entry.family);
      expect(committed.projection?.state.phase).toBe("finished");
      const watcher = await browser.newContext({ viewport: { width: 390, height: 844 } });
      try {
        const viewer = await watcher.newPage();
        const response = await viewer.goto(`/c/${fixture.slug}/m/Match%201`);
        if (!response) throw new Error("Missing public result response");
        expect(response.status()).toBe(200);
        await expect(viewer.getByTestId("live-result")).toContainText("won");
        await viewer.evaluate(
          (value) => document.documentElement.setAttribute("data-theme", value),
          theme,
        );
        expect((await new AxeBuilder({ page: viewer }).analyze()).violations).toEqual([]);
        await viewer.screenshot({
          path: test.info().outputPath(`${entry.family}-result-${theme}.png`),
          fullPage: true,
        });
      } finally {
        await watcher.close();
      }
    });
  }
}
