import AxeBuilder from "@axe-core/playwright";
import { newId } from "@desiauction/db";
import { expect, test, type Page } from "@playwright/test";
import {
  committedQueue,
  persistedQueue,
  readScoringFixture,
  scoringSession,
  seedScoringFixture,
} from "./scoring-fixtures";

if (!process.env["DATABASE_URL"]?.includes("127.0.0.1:15437/ls1_c29_clean"))
  throw new Error("Isolated database required");

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

for (const family of ["rally", "raid"] as const) {
  test(`${family} finish waits offline, cold-restores the same identity and remains complete offline after acknowledgement`, async ({
    page,
    context,
  }) => {
    test.setTimeout(180000);
    const fixture = await seedScoringFixture({
      sport: family === "rally" ? "badminton" : "kabaddi",
      formatKey: family === "rally" ? "badminton_bo3" : "pkl_40",
      longNames: true,
    });
    await scoringSession(context, fixture.actorToken);
    await page.goto(`/score/${fixture.fixtureId}/setup`);
    if (family === "rally") {
      for (const id of [fixture.homePlayers[0], fixture.awayPlayers[0]])
        await page.getByTestId(`rally-player-1-${id}`).click();
      await page.getByTestId("rally-start").click();
      await expect(page.getByTestId("rally-point-home")).toBeEnabled();
    } else {
      for (const side of ["home", "away"] as const) {
        const group = page.getByRole("group", {
          name: `${side === "home" ? "LS1 Strikers" : "LS1 Royals"} · Starting mat (7 players)`,
          exact: true,
        });
        for (const checkbox of await group.getByRole("checkbox").all()) await checkbox.uncheck();
        for (const name of (side === "home" ? fixture.homeNames : fixture.awayNames).slice(0, 7))
          await group.getByRole("checkbox", { name, exact: true }).check();
      }
      await page.getByRole("button", { name: "Start kabaddi match", exact: true }).click();
      await expect(page.getByTestId("raid-start-half")).toBeEnabled();
      await page.getByTestId("raid-start-half").click();
      await expect(page.getByRole("status")).toHaveText("Saved");
    }
    await views(page, `${family}-ready`);
    await page.getByRole("link", { name: "Matches", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Watch live", exact: true })).toBeFocused();
    if (family === "raid") {
      const clock = page.getByTestId("raid-clock-toggle");
      await clock.focus();
      await page.keyboard.press("Space");
      await expect(clock).toHaveText("Pause clock");
      await page.keyboard.press("Space");
      await expect(clock).toHaveText("Start clock");
      await expect(page.getByRole("status")).toHaveText("Saved");
    }
    await page.goto("/score");
    await page.getByRole("button", { name: "Get ready for match day", exact: true }).click();
    await expect(page.getByText("✓ Works offline", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await page.goto(`/score/${fixture.fixtureId}`);
    if (family === "rally") {
      for (let game = 0; game < 2; game++) {
        for (let point = 0; point < 21; point++) await page.getByTestId("rally-point-home").click();
        if (game === 0) {
          await page.getByTestId("rally-next-game").click();
          await page.getByTestId("rally-start-game").click();
          await expect(page.getByTestId("rally-point-home")).toBeEnabled();
        }
      }
    } else {
      await page.getByTestId("raid-end-half").click();
      await page.getByTestId("raid-start-half").click();
      await page.getByTestId("raid-end-half").click();
    }
    await expect(page.getByRole("status")).toHaveText("Saved");
    // Exercise an actual canonical refusal; no mocked acknowledgement/result.
    let refused = false;
    await page.route(`**/api/score/${fixture.fixtureId}/events`, async (route) => {
      if (!refused && route.request().method() === "POST") {
        refused = true;
        const body = route.request().postDataJSON() as Record<string, unknown>;
        await route.continue({ postData: JSON.stringify({ ...body, attempt: 999 }) });
      } else await route.continue();
    });
    await page.getByTestId(`${family}-finish`).click();
    await expect(page.locator("main").getByRole("alert")).toBeVisible();
    await expect(page.getByTestId(`${family}-finished`)).toHaveCount(0);
    await expect(page.getByRole("status")).not.toHaveText(/^Saved/);
    const rejected = await readScoringFixture(fixture.fixtureId);
    expect(rejected.events.filter((event) => event.type === "finish")).toHaveLength(0);
    await expect.poll(async () => (await persistedQueue(page, fixture.fixtureId)).length).toBe(0);
    await page.unroute(`**/api/score/${fixture.fixtureId}/events`);
    await page.reload();
    await expect(page.getByRole("status")).toHaveText("Saved");
    await context.setOffline(true);
    await page.getByTestId(`${family}-finish`).click();
    await expect(page.getByTestId(`${family}-finish-pending`)).toBeVisible();
    await expect(page.getByTestId(`${family}-finished`)).toHaveCount(0);
    const ids = await committedQueue(page, fixture.fixtureId, ["finish"]);
    expect(ids).toHaveLength(1);
    await page.goto(`/score/shell#${fixture.fixtureId}`);
    await expect(page.getByTestId(`${family}-finish-pending`)).toBeVisible();
    expect(
      (await persistedQueue(page, fixture.fixtureId)).map((item) => item.event.eventId),
    ).toContain(ids[0]);
    await expect(page.getByTestId(`${family}-finished`)).toHaveCount(0);
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
      await expect(page.getByTestId(`${family}-finish-pending`)).toBeVisible();
      await expect(page.getByTestId(`${family}-finished`)).toHaveCount(0);
    } finally {
      release?.();
    }
    await expect(page.getByTestId(`${family}-finished`)).toBeVisible();
    await page.unroute(`**/api/score/${fixture.fixtureId}/events`);

    await expect
      .poll(async () => {
        const state = await readScoringFixture(fixture.fixtureId);
        return state.events
          .filter((event) => event.type === "finish")
          .map((event) => event.eventId);
      })
      .toEqual(ids);
    await context.setOffline(true);
    await expect(page.getByTestId(`${family}-finished`)).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("Saved · offline");
    await page.goto(`/score/shell#${fixture.fixtureId}`);
    await expect(page.getByTestId(`${family}-finished`)).toBeVisible();
    await context.setOffline(false);
    // A real storage failure prevents restoration, even with accepted history.
    await page.addInitScript(() => {
      indexedDB.open = () => {
        throw new Error("Validation: storage unavailable");
      };
    });
    const response = await page.goto(`/score/${fixture.fixtureId}`);
    const html = (await response!.text()).replace(/<[^>]*>/g, "");
    expect(html).toContain("Restoring match");
    await expect(page.locator("main").getByRole("alert")).toBeVisible();
    await expect(page.getByRole("status")).not.toHaveText(/^Saved/);
    await expect(page.getByTestId(`${family}-finished`)).toHaveCount(0);
  });
}

for (const sport of ["pickleball", "volleyball"] as const) {
  test(`${sport} canonical serving, game progression and final result retain actual participants`, async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(180000);
    const volleyball = sport === "volleyball";
    const fixture = await seedScoringFixture({
      sport,
      formatKey: volleyball ? "volleyball_bo5" : "pickleball_bo3",
      publicDelaySeconds: 0,
    });
    await scoringSession(context, fixture.actorToken);
    await page.goto(`/score/${fixture.fixtureId}/setup`);
    for (const ids of [fixture.homePlayers, fixture.awayPlayers]) {
      for (const id of ids.slice(0, volleyball ? 6 : 2))
        await page.getByTestId(`rally-player-1-${id}`).click();
    }
    await page.getByTestId("rally-start").click();
    await expect(page.getByTestId("rally-point-home")).toBeEnabled();
    if (!volleyball) {
      await page.getByTestId("rally-point-away").click();
      await expect(page.getByTestId("rally-away-points")).toHaveText("0");
      await expect(page.getByTestId("rally-server")).toContainText("LS1 Royals");
      await page.getByTestId("rally-point-home").click();
      await expect(page.getByTestId("rally-home-points")).toHaveText("0");
      await expect(page.getByTestId("rally-server")).toContainText("LS1 Strikers");
    }
    const watcher = await browser.newContext();
    try {
      const viewer = await watcher.newPage();
      await viewer.goto(`/c/${fixture.slug}/m/Match%201`);
      for (let game = 0; game < (volleyball ? 3 : 2); game++) {
        for (let point = 0; point < (volleyball ? 25 : 11); point++)
          await page.getByTestId("rally-point-home").click();
        await expect(page.getByTestId("rally-point-home")).toBeDisabled();
        if (game === 0 && volleyball) {
          await expect(page.getByRole("status")).toHaveText("Saved");
          const state = await readScoringFixture(fixture.fixtureId);
          if (!state.match?.scorerDeviceId) throw new Error("Missing current scorer device");
          const reply = await page.request.post(`/api/score/${fixture.fixtureId}/events`, {
            data: {
              deviceId: state.match.scorerDeviceId,
              attempt: state.match.attempt,
              events: [
                {
                  eventId: newId(),
                  attempt: state.match.attempt,
                  type: "substitute",
                  v: 1,
                  payload: {
                    side: "home",
                    inId: fixture.homePlayers[6],
                    outId: fixture.homePlayers[0],
                  },
                  targetEventId: null,
                  clientSeq: Math.max(...state.events.map((event) => event.clientSeq)) + 1,
                  clientRecordedAt: new Date().toISOString(),
                },
              ],
            },
          });
          expect(reply.ok(), await reply.text()).toBe(true);
          const body = (await reply.json()) as { acks: { status: string }[] };
          expect(body.acks.every((ack) => ack.status === "stored")).toBe(true);
          await page.reload();
          await expect(page.getByRole("status")).toHaveText("Saved");
        }
        if (game < (volleyball ? 2 : 1)) {
          await page.getByTestId("rally-next-game").click();
          if (volleyball && game === 0) {
            await expect(
              page.getByTestId(`rally-player-1-${fixture.homePlayers[6]}`),
            ).toHaveAttribute("aria-pressed", "true");
            await expect(
              page.getByTestId(`rally-player-1-${fixture.homePlayers[0]}`),
            ).toHaveAttribute("aria-pressed", "false");
          }
          await page.getByTestId("rally-start-game").click();
          await expect(page.getByTestId("rally-point-home")).toBeEnabled();
        }
      }
      await views(page, `${sport}-terminal-preview`);
      await expect(page.getByTestId("rally-finish")).toBeEnabled();
      await page.getByTestId("rally-finish").click();
      await expect(page.getByTestId("rally-finished")).toBeVisible();
      await expect(viewer.getByTestId("live-result")).toContainText(
        volleyball ? "3–0 sets" : "1–0 rubbers",
      );
      const state = await readScoringFixture(fixture.fixtureId);
      expect(state.events.filter((event) => event.type === "finish")).toHaveLength(1);
      expect(state.events.filter((event) => event.type === "substitute")).toHaveLength(
        volleyball ? 1 : 0,
      );
    } finally {
      await watcher.close();
    }
  });
}

for (const variant of [
  { sport: "badminton", formatKey: "badminton_tie_5", rubbers: 3, games: 2, points: 21 },
  { sport: "table_tennis", formatKey: "tt_bo5", rubbers: 1, games: 3, points: 11 },
  { sport: "pickleball", formatKey: "pickleball_rally_bo3", rubbers: 1, games: 2, points: 11 },
] as const) {
  test(`${variant.formatKey} doubles complete the canonical format`, async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(180000);
    const fixture = await seedScoringFixture({ ...variant, publicDelaySeconds: 0 });
    await scoringSession(context, fixture.actorToken);
    await page.goto(`/score/${fixture.fixtureId}/setup`);
    const proposals = variant.rubbers > 1 ? 5 : 1;
    for (let rubber = 1; rubber <= proposals; rubber++)
      for (const ids of [fixture.homePlayers, fixture.awayPlayers])
        for (const id of ids.slice(0, 2))
          await page.getByTestId(`rally-player-${String(rubber)}-${id}`).click();
    await page.getByTestId("rally-start").click();
    await expect(page.getByTestId("rally-point-home")).toBeEnabled();
    const watcher = await browser.newContext();
    try {
      const viewer = await watcher.newPage();
      await viewer.goto(`/c/${fixture.slug}/m/Match%201`);
      if (variant.formatKey === "pickleball_rally_bo3") {
        await page.getByTestId("rally-point-away").click();
        await expect(page.getByTestId("rally-away-points")).toHaveText("1");
        await expect(page.getByTestId("rally-server")).toContainText("LS1 Royals");
      }
      for (let rubber = 0; rubber < variant.rubbers; rubber++) {
        for (let game = 0; game < variant.games; game++) {
          for (let point = 0; point < variant.points; point++)
            await page.getByTestId("rally-point-home").click();
          await expect(page.getByTestId("rally-point-home")).toBeDisabled();
          if (game < variant.games - 1 || rubber < variant.rubbers - 1) {
            await page.getByTestId("rally-next-game").click();
            await page.getByTestId("rally-start-game").click();
            await expect(page.getByTestId("rally-point-home")).toBeEnabled();
          }
        }
      }
      await views(page, variant.formatKey);
      await expect(page.getByTestId("rally-finish")).toBeEnabled();
      await page.getByTestId("rally-finish").click();
      await expect(page.getByTestId("rally-finished")).toBeVisible();
      await expect(viewer.getByTestId("live-result")).toContainText(
        `${String(variant.rubbers)}–0 rubbers`,
      );
      const accepted = await readScoringFixture(fixture.fixtureId);
      expect(accepted.events.filter((event) => event.type === "finish")).toHaveLength(1);
      expect(accepted.events.filter((event) => event.type === "rally")).toHaveLength(
        variant.rubbers * variant.games * variant.points +
          (variant.formatKey === "pickleball_rally_bo3" ? 1 : 0),
      );
    } finally {
      await watcher.close();
    }
  });
}
