import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { newId } from "@desiauction/db";
import {
  seedScoringFixture,
  scoringSession,
  confirmationNoticeFor,
  readScoringFixture,
} from "./scoring-fixtures";

test("only the opposing manager can open a real confirmation notice and dispute its recorded result", async ({
  page,
  browser,
}) => {
  const fixture = await seedScoringFixture({ teamManaged: true });
  await scoringSession(page.context(), fixture.actorToken);
  const deviceId = "c38-confirmation-browser";
  const started = await page.request.post(`/api/score/${fixture.fixtureId}/start`, {
    data: {
      deviceId,
      formatKey: "t10",
      conditions: {},
      lineups: [
        {
          teamId: fixture.homeId,
          battingOrder: fixture.homePlayers,
          captainId: fixture.homePlayers[0],
          keeperId: fixture.homePlayers[1],
          substitutes: [],
        },
        {
          teamId: fixture.awayId,
          battingOrder: fixture.awayPlayers,
          captainId: fixture.awayPlayers[0],
          keeperId: fixture.awayPlayers[1],
          substitutes: [],
        },
      ],
    },
  });
  expect(started.status(), await started.text()).toBe(200);
  const finished = await page.request.post(`/api/score/${fixture.fixtureId}/events`, {
    data: {
      deviceId,
      attempt: 1,
      events: [
        { type: "toss", payload: { winnerTeamId: fixture.homeId, decision: "bat" } },
        {
          type: "innings_started",
          payload: {
            inningsNo: 1,
            battingTeamId: fixture.homeId,
            strikerId: fixture.homePlayers[0],
            nonStrikerId: fixture.homePlayers[1],
            bowlerId: fixture.awayPlayers[0],
          },
        },
        {
          type: "ball",
          payload: {
            strikerId: fixture.homePlayers[0],
            nonStrikerId: fixture.homePlayers[1],
            bowlerId: fixture.awayPlayers[0],
            runsBat: 0,
            extras: {},
          },
        },
        { type: "innings_closed", payload: { reason: "forfeit" } },
        {
          type: "innings_started",
          payload: {
            inningsNo: 2,
            battingTeamId: fixture.awayId,
            strikerId: fixture.awayPlayers[0],
            nonStrikerId: fixture.awayPlayers[1],
            bowlerId: fixture.homePlayers[1],
          },
        },
        {
          type: "ball",
          payload: {
            strikerId: fixture.awayPlayers[0],
            nonStrikerId: fixture.awayPlayers[1],
            bowlerId: fixture.homePlayers[1],
            runsBat: 1,
            extras: {},
          },
        },
        { type: "finish", payload: {} },
      ].map((event, index) => ({
        ...event,
        eventId: newId(),
        attempt: 1,
        v: 1,
        targetEventId: null,
        clientSeq: index + 1,
        clientRecordedAt: new Date().toISOString(),
      })),
    },
  });
  expect(finished.status(), await finished.text()).toBe(200);
  expect((await readScoringFixture(fixture.fixtureId)).match?.trustLevel).toBe("self_scored");
  const noticeId = await confirmationNoticeFor(fixture.fixtureId, fixture.nextActorId);
  expect(noticeId).not.toBeNull();
  await page.goto(`/inbox?confirmation=${noticeId ?? ""}`);
  await expect(page.getByText("Confirmation unavailable", { exact: true })).toBeVisible();
  const other = await browser.newContext({ baseURL: "http://localhost:3050" });
  const manager = await other.newPage();
  try {
    await manager.goto(`/inbox?confirmation=${noticeId ?? ""}`);
    await expect(manager).toHaveURL(/\/login\?next=/);
    await scoringSession(other, fixture.nextActorToken);
    await manager.goto(`/inbox?confirmation=${noticeId ?? ""}`);
    await expect(manager).toHaveURL(/\/match\/confirm\//);
    await expect(
      manager.getByRole("heading", { name: "Is this result right?", exact: true }),
    ).toBeVisible();
    await expect(manager.getByText("Signed in as LS1 next scorer")).toBeVisible();
    await expect(manager.getByRole("link", { name: "Check the full scorecard" })).toHaveAttribute(
      "href",
      /\?tab=scorecard$/,
    );
    for (const theme of ["daylight", "floodlight"]) {
      await manager.evaluate(
        (value) => document.documentElement.setAttribute("data-theme", value),
        theme,
      );
      for (const width of [390, 1440]) {
        await manager.setViewportSize({ width, height: 900 });
        expect((await new AxeBuilder({ page: manager }).analyze()).violations).toEqual([]);
        expect(
          await manager.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await manager.screenshot({
          path: test.info().outputPath(`confirmation-${theme}-${String(width)}.png`),
          fullPage: true,
        });
      }
    }
    await manager.getByRole("button", { name: "Yes, that’s right", exact: true }).click();
    await expect(manager.locator("form").getByRole("status")).toContainText(
      "Your response is recorded.",
    );
    expect((await readScoringFixture(fixture.fixtureId)).match?.trustLevel).toBe("confirmed");
    await manager
      .getByRole("textbox", { name: "Reason or note" })
      .fill("The recorded result differs from the captain’s notes");
    await manager.getByRole("button", { name: "Something’s wrong", exact: true }).click();
    await expect(manager.locator("form").getByRole("status")).toContainText(
      "This match remains flagged for review.",
    );
    expect((await readScoringFixture(fixture.fixtureId)).match?.trustLevel).toBe("flagged");
  } finally {
    await other.close();
  }
});
