import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { createDb, newId, competitions, registrations, sessions } from "@desiauction/db";
import { eq } from "drizzle-orm";
import { auctionValidationEnv } from "./env";
import {
  seedScoringFixture,
  scoringSession,
  confirmationNoticeFor,
  readScoringFixture,
} from "./scoring-fixtures";

test("confirmed match feeds private/public insights, native filters, awards, and current privacy boundaries", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const fixture = await seedScoringFixture({
    teamManaged: true,
    longNames: true,
    publicDelaySeconds: 0,
  });
  await scoringSession(page.context(), fixture.actorToken);
  const deviceId = "c38-confirmation-browser";
  const started = await page.request.post(`/api/score/${fixture.fixtureId}/start`, {
    data: {
      deviceId,
      formatKey: "t10",
      conditions: {
        ball: { type: "leather" },
        pitch: "matting",
        ground: "full",
        timeOfDay: "night",
      },
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
            runsBat: 4,
            boundary: 4,
            shot: { zone: "cover", angle: 67 },
            extras: {},
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
            wicket: {
              kind: "bowled",
              playerOutId: fixture.homePlayers[0],
              fielderIds: [],
              where: { x: 0.2, y: 0.4 },
            },
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
            runsBat: 6,
            boundary: 6,
            shot: { zone: "cover", angle: 90 },
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
    await manager.getByRole("button", { name: "Yes, that’s right", exact: true }).click();
    await expect(manager.locator("form").getByRole("status")).toContainText(
      "Your response is recorded.",
    );
    expect((await readScoringFixture(fixture.fixtureId)).match?.trustLevel).toBe("confirmed");
    const handle = createDb(auctionValidationEnv.databaseUrl, { max: 1 });
    try {
      const registrationId = fixture.homePlayers[0];
      if (!registrationId) throw new Error("Missing real batter registration");
      const [registration] = await handle.db
        .select()
        .from(registrations)
        .where(eq(registrations.id, registrationId));
      const [season] = await handle.db
        .select()
        .from(competitions)
        .where(eq(competitions.slug, fixture.slug));
      if (!registration || !season) throw new Error("Missing seeded identities");
      const playerPath = `/c/${fixture.slug}/p/${encodeURIComponent(registration.registrationNumber)}`;
      await page.goto(playerPath);
      await page.getByRole("link", { name: "Explore cricket insights" }).click();
      await expect(page.getByTestId("insights-sample")).toContainText("2 balls in 1 matches");
      await expect(page.locator(".insight-scope")).toHaveText("Public player insights");
      await expect(page.getByTestId("insights-wagon")).toContainText("1 recorded scoring shots");
      await expect(page.locator(".insight-shot title")).toHaveText(
        "1 recorded shots · 4 runs · 67 degrees",
      );
      await expect(page.locator(".insight-dismissal title")).toHaveText(
        "1 dismissals at this recorded position",
      );
      expect(pageErrors).toEqual([]);
      await page.getByRole("combobox", { name: "Ball", exact: true }).selectOption("leather");
      await page.getByRole("combobox", { name: "Format", exact: true }).selectOption("t10");
      await page.getByRole("button", { name: "Apply filters" }).click();
      await page.getByRole("link", { name: "Bowling", exact: true }).click();
      await expect(page).toHaveURL(/view=bowling/);
      await expect(page.getByRole("combobox", { name: "Ball", exact: true })).toHaveValue(
        "leather",
      );
      await expect(page.getByRole("combobox", { name: "Format", exact: true })).toHaveValue("t10");
      await page.getByRole("link", { name: "Clear conditions" }).click();
      await expect(page).toHaveURL(/view=bowling$/);
      await page.getByRole("link", { name: "Back to player", exact: true }).click();
      await expect(page).toHaveURL(playerPath);
      const token = randomBytes(32).toString("base64url");
      await handle.db.insert(sessions).values({
        id: newId(),
        personId: registration.personId,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + 3600000),
      });
      await writeFile(
        test.info().outputPath("matched-route-fixture.json"),
        JSON.stringify({
          playerPath,
          ownToken: token,
          memberToken: fixture.actorToken,
          slug: fixture.slug,
        }),
        { mode: 0o600 },
      );
      await scoringSession(page.context(), token);
      await page.goto("/me/insights?view=batting&ballType=leather&formatKey=t10");
      await expect(
        page.getByRole("heading", { name: "My cricket insights", exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId("insights-sample")).toContainText("2 balls in 1 matches");
      await page.getByRole("link", { name: "Back to my profile" }).click();
      await expect(page).toHaveURL("/me");
      await page.getByRole("link", { name: "My cricket insights", exact: true }).click();
      const deniedAwards = await page.request.get(`/seasons/${fixture.slug}/awards`);
      expect(deniedAwards.status()).toBe(404);
      expect(await deniedAwards.text()).not.toContain("Whole-season award picks");
      for (const route of [
        "/me/insights",
        `${playerPath}/insights`,
        `/seasons/${fixture.slug}/awards`,
      ]) {
        await scoringSession(page.context(), route.includes("awards") ? fixture.actorToken : token);
        await page.goto(route);
        for (const theme of ["daylight", "floodlight"]) {
          await page.evaluate((value) => {
            document.documentElement.setAttribute("data-theme", value);
          }, theme);
          for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
            ).toBe(true);
            if (!route.includes("awards")) {
              const readable = await page.locator(".insight-heading h2").evaluate((heading) => {
                const range = document.createRange();
                range.selectNodeContents(heading);
                const fontSize = Number.parseFloat(getComputedStyle(heading).fontSize);
                const lines: { top: number; bottom: number }[] = [];
                for (const rect of Array.from(range.getClientRects()).sort(
                  (a, b) => a.top - b.top,
                )) {
                  const previous = lines.at(-1);
                  if (
                    previous &&
                    Math.abs((rect.top + rect.bottom) / 2 - (previous.top + previous.bottom) / 2) <
                      fontSize / 2
                  ) {
                    previous.top = Math.min(previous.top, rect.top);
                    previous.bottom = Math.max(previous.bottom, rect.bottom);
                  } else lines.push({ top: rect.top, bottom: rect.bottom });
                }
                return lines.every(
                  (line, index) => index === 0 || line.top >= (lines[index - 1]?.bottom ?? 0) - 1,
                );
              });
              expect(readable, "Actual wrapped player-name glyph lines must not overlap").toBe(
                true,
              );
            }
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
            await page.screenshot({
              path: test
                .info()
                .outputPath(
                  `${route.includes("awards") ? "awards" : route.startsWith("/me") ? "self" : "public"}-${theme}-${String(width)}.png`,
                ),
              fullPage: true,
            });
          }
        }
      }
      await expect(page.getByText("Whole-season award picks", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Update computed awards" })).toHaveCount(0);
      await page.getByRole("link", { name: "Back to season", exact: true }).click();
      await expect(page).toHaveURL(`/c/${fixture.slug}?view=squads`);
      await scoringSession(page.context(), token);
      await handle.db
        .update(competitions)
        .set({
          scoringRules: {
            ...(typeof season.scoringRules === "object" &&
            season.scoringRules !== null &&
            !Array.isArray(season.scoringRules)
              ? season.scoringRules
              : {}),
            publicDelaySeconds: 300,
          },
        })
        .where(eq(competitions.id, season.id));
      await page.goto(`${playerPath}/insights`);
      await expect(page.getByTestId("insights-sample")).toContainText("0 balls in 0 matches");
      await page.goto("/me/insights");
      await expect(page.getByTestId("insights-sample")).toContainText("2 balls in 1 matches");
      await handle.db
        .update(competitions)
        .set({ scoringRules: season.scoringRules })
        .where(eq(competitions.id, season.id));
      await handle.db
        .update(registrations)
        .set({ dateOfBirth: "2012-01-01" })
        .where(eq(registrations.id, registration.id));
      const minor = await page.request.get(`${playerPath}/insights`);
      expect(minor.status()).toBe(404);
      expect(await minor.text()).not.toContain("Recorded scoring-shot directions");
      await handle.db
        .update(registrations)
        .set({ dateOfBirth: registration.dateOfBirth })
        .where(eq(registrations.id, registration.id));
      await handle.db
        .update(competitions)
        .set({ visibility: "private" })
        .where(eq(competitions.id, season.id));
      const denied = await page.request.get(`${playerPath}/insights`);
      expect(denied.status()).toBe(404);
      expect(await denied.text()).not.toContain("Recorded scoring-shot directions");
      await page.goto("/me/insights");
      await expect(page.getByTestId("insights-sample")).toContainText("2 balls in 1 matches");
      await handle.db
        .update(competitions)
        .set({ visibility: season.visibility })
        .where(eq(competitions.id, season.id));
      expect(pageErrors).toEqual([]);
    } finally {
      await handle.sql.end({ timeout: 5 });
    }
  } finally {
    await other.close();
  }
});
