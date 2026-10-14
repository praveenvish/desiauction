import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  seedScoringFixture,
  startScoring,
  runBall,
  sent,
  nextBowler,
  followupScoringFixture,
  readyOffline,
  committedQueue,
  persistedQueue,
  readScoringFixture,
} from "./scoring-fixtures";

test("delivery routine controls remain reachable with a populated over in both themes", async ({
  page,
}, info) => {
  const fixture = await seedScoringFixture();
  await startScoring(page, fixture);
  await runBall(page);
  await sent(page);
  for (const theme of ["daylight", "floodlight"]) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    for (const width of [320, 360, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      if (width === 390) {
        // Exercise reachability while the live acknowledgement is actually present.
        await runBall(page);
        await sent(page);
        await expect(page.getByTestId("pad-toast")).toBeVisible();
        for (const control of ["pad-wicket", "pad-undo", "pad-menu"]) {
          const rect = await page.getByTestId(control).boundingBox();
          expect(rect).not.toBeNull();
          expect(rect!.width).toBeGreaterThanOrEqual(44);
          expect(rect!.height).toBeGreaterThanOrEqual(44);
          expect(rect!.y + rect!.height).toBeLessThanOrEqual(844);
          expect(
            await page.getByTestId(control).evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return element.contains(
                document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
              );
            }),
          ).toBe(true);
        }
      }
      await page.screenshot({
        path: info.outputPath(`delivery-populated-${theme}-${String(width)}.png`),
        fullPage: true,
      });
    }
  }
});

test("Hindi delivery labels and long player names retain keyboard controls and narrow reflow", async ({
  page,
  context,
}, info) => {
  const fixture = await seedScoringFixture({ language: "hi", longNames: true });
  await startScoring(page, fixture);
  await expect(page.getByTestId("pad")).toHaveAttribute("lang", "hi");
  await page.getByTestId("pad-run-0").focus();
  await page.keyboard.press("Enter");
  await sent(page);
  await expect(page.getByTestId("pad-toast")).toContainText("स्वीकार किया गया");
  await expect(page.getByTestId("pad-recent")).toContainText("हाल में स्वीकार की गई गेंदें");
  await readyOffline(page, fixture.fixtureId);
  await context.setOffline(true);
  await runBall(page);
  await expect(page.getByTestId("pad-toast")).toContainText("स्वीकृति की प्रतीक्षा");
  for (const theme of ["daylight", "floodlight"]) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    for (const width of [320, 360, 390, 720, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.getByTestId("pad-menu").focus();
      await expect(page.getByTestId("pad-menu")).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByTestId("pad-menu")).toBeFocused();
      await page.screenshot({
        path: info.outputPath(`delivery-hindi-long-${theme}-${String(width)}.png`),
        fullPage: true,
      });
    }
  }
  await context.setOffline(false);
  await sent(page);
});

test("delivery finish separates unfinished, queued and accepted progression without losing an offline finish", async ({
  page,
  context,
}, info) => {
  test.setTimeout(180000);
  const fixture = await seedScoringFixture();
  const next = await followupScoringFixture(fixture, 2, { sameDay: true });
  await startScoring(page, fixture);
  for (let over = 0; over < 10; over++) {
    if (over > 0) await nextBowler(page, fixture.awayNames[over % 5]!);
    for (let ball = 0; ball < 6; ball++) await runBall(page);
    await sent(page);
  }
  await page.getByTestId("innings-start-confirm").click();
  await sent(page);
  await readyOffline(page, fixture.fixtureId);
  await runBall(page, 1);
  await sent(page);
  const finish = page.getByRole("dialog", { name: "Target reached", exact: true });
  await expect(finish).toBeVisible();
  await expect(finish.getByRole("link", { name: "Next match", exact: true })).toHaveCount(0);
  await expect(finish.getByTestId("finish-next-match")).toHaveAttribute(
    "href",
    `/score/${next.fixtureId}`,
  );
  await expect(finish).toContainText("This match has not been finished");
  const before = await readScoringFixture(fixture.fixtureId);
  await context.setOffline(true);
  await page.getByTestId("finish-confirm").click();
  const ids = await committedQueue(page, fixture.fixtureId, ["finish"]);
  const queued = page.getByRole("dialog", { name: "Finish waiting to sync", exact: true });
  await expect(queued).toBeVisible();
  await expect(queued.getByRole("button", { name: "Share result", exact: true })).toBeDisabled();
  await expect(queued.getByRole("link", { name: "Next match", exact: true })).toHaveCount(0);
  for (const theme of ["daylight", "floodlight"]) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(
        queued.getByRole("button", { name: "Back to match", exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        path: info.outputPath(`finish-pending-${theme}-${String(width)}.png`),
        fullPage: true,
      });
    }
  }
  await queued.getByRole("button", { name: "Back to match", exact: true }).click();
  await expect(queued).toHaveCount(0);
  await page.goto(`/score/${fixture.fixtureId}`);
  await expect(page).toHaveURL(`/score/shell#${fixture.fixtureId}`);
  await expect(
    page.getByRole("dialog", { name: "Finish waiting to sync", exact: true }),
  ).toBeVisible();
  expect((await persistedQueue(page, fixture.fixtureId)).map((item) => item.event.eventId)).toEqual(
    ids,
  );
  await context.setOffline(false);
  await sent(page);
  await expect(page.getByRole("dialog", { name: "Result saved", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share result", exact: true })).toBeEnabled();
  const after = await readScoringFixture(fixture.fixtureId);
  expect(after.match?.lastSeq).toBe(before.match!.lastSeq + 1);
  expect(after.match?.scorerPersonId).toBe(before.match?.scorerPersonId);
  expect(after.match?.scorerDeviceId).toBe(before.match?.scorerDeviceId);
  expect(
    after.events.filter((event) => event.type === "finish").map((event) => event.eventId),
  ).toEqual(ids);
  expect(after.result?.source).toBe("scored");
  await page.goto(`/score/${fixture.fixtureId}`);
  await expect(page.getByRole("link", { name: "Next match", exact: true })).toHaveAttribute(
    "href",
    `/score/${next.fixtureId}`,
  );
});
