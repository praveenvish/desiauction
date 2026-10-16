import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { competitions, createDb, fixtures, newId, registrations } from "@desiauction/db";
import { eq } from "drizzle-orm";
import {
  confirmationNoticeFor,
  firstScoringOver,
  followupScoringFixture,
  nextBowler,
  readScoringFixture,
  readyOffline,
  runBall,
  scoringSession,
  seedScoringFixture,
  sent,
  startAwayScoring,
} from "./scoring-fixtures";

const THEMES = ["daylight", "floodlight"] as const;
type Theme = (typeof THEMES)[number];
const SIZES = [
  { width: 390, height: 844 },
  { width: 1440, height: 1000 },
];
const ROOT = path.resolve("e2e-artifacts/ls1");
type Capture = { screen: string; file: string; url: string; theme: Theme; representation: string };
let captures: Capture[] = [];

test.describe.configure({ mode: "serial" });
test.beforeEach(async () => {
  captures = [];
  await mkdir(ROOT, { recursive: true });
});
test.afterEach(async ({}, info) => {
  await writeFile(
    path.join(ROOT, `manifest-${info.title.replace(/[^a-z0-9]+/gi, "-")}.json`),
    JSON.stringify({ status: info.status, captures }, null, 2),
  );
});

async function capture(
  page: Page,
  screen: string,
  themes: readonly Theme[] = THEMES,
  transient = false,
  sizes: readonly { width: number; height: number }[] = SIZES,
) {
  const required: Record<string, string[]> = {
    "02-conditions": ["setup-conditions"],
    "09-first-bowler-style": ["style-ask"],
    "10-wicket-fielding-pin": [
      "wicket-sheet",
      "wicket-kind-caught",
      "wicket-pin",
      "wicket-next-batter",
      "wicket-confirm",
    ],
    "11-over-done-next-bowler": ["bowler-sheet", "bowler-confirm"],
    "08-left-handed-shot-map": ["shot-sheet", "shot-skip"],
    "06-handover-qr": ["handover-qr"],
    "17-result-player-of-match": ["result-pom", "result-share-poster"],
    "21-batter-insights": [
      "insights-wagon",
      "insights-vs-type",
      "insights-conditions",
      "insights-sample",
    ],
    "22-bowler-insights": [
      "insights-wagon",
      "insights-vs-type",
      "insights-conditions",
      "insights-sample",
    ],
    "24-match-day-board": ["today-row-Match 1", "today-action-Match 1"],
    "07-live-pad": ["claim-force", "pad", "pad-score", "pad-overs", "pad-need", "pad-sync"],
  };
  for (const marker of required[screen] ?? []) await expect(page.getByTestId(marker)).toBeVisible();
  if (screen === "02-conditions")
    await expect(
      page.getByRole("heading", { name: "Match conditions", exact: true }),
    ).toBeVisible();
  if (screen === "08-left-handed-shot-map")
    await expect(page.locator('[data-testid^="shot-zone-"]')).toHaveCount(8);
  if (screen === "09-first-bowler-style")
    expect(await page.locator('[data-testid^="style-"]').count()).toBeGreaterThan(3);
  if (screen === "10-wicket-fielding-pin")
    expect(await page.locator('[data-testid^="wicket-fielder-"]').count()).toBeGreaterThan(0);
  if (screen === "11-over-done-next-bowler") {
    const rows = page.locator('[data-testid^="bowler-"][aria-disabled]');
    expect(await rows.count()).toBeGreaterThan(0);
    for (const row of await rows.all()) {
      const disabled = await row.isDisabled();
      await expect(row).toHaveAttribute("aria-disabled", String(disabled));
      const reason = await row.getAttribute("data-reason");
      expect(
        disabled ? ["consecutive", "quota", "subbed_out"].includes(reason ?? "") : reason === "",
      ).toBe(true);
    }
  }
  for (const theme of themes) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.evaluate(async () => {
        await document.fonts.ready;
        // A theme flip runs colour transitions; axe sampling mid-transition
        // measures a blend of the two themes' golds, not either one.
        // Finite ones only (a looping pulse never finishes), and never long.
        const settling = document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined));
        await Promise.race([
          Promise.all(settling),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (!transient) expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      const file = `${screen}-${theme}-${String(size.width)}x${String(size.height)}.png`;
      await page.screenshot({
        path: path.join(ROOT, file),
        animations: "disabled",
        // A transparent capture is Chromium's alone; Firefox refuses the option
        // ("Not implemented"), so the overlay keeps its backdrop there.
        omitBackground:
          screen === "26-stream-overlay" &&
          page.context().browser()?.browserType().name() === "chromium",
      });
      captures.push({ screen, file, url: page.url(), theme, representation: "viewport" });
    }
  }
}

/** Image endpoints have their own fixed canvas, independent of the viewing UI theme. */
async function image(page: Page, screen: string, url: string) {
  const response = await page.request.get(url);
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/png");
  const bytes = await response.body();
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  for (const theme of THEMES) {
    const file = `${screen}-${theme}-intrinsic.png`;
    await writeFile(path.join(ROOT, file), bytes);
    captures.push({ screen, file, url, theme, representation: "canonical theme-independent PNG" });
  }
}

for (const theme of THEMES) {
  test(`scorer reference screens in ${theme}`, async ({ page, browser, context }) => {
    test.setTimeout(180000);
    const fixture = await seedScoringFixture({ publicDelaySeconds: 0 });
    const handle = createDb(process.env["DATABASE_URL"] ?? "", { max: 1 });
    try {
      await handle.db
        .update(registrations)
        .set({ battingStyle: "left_hand" })
        .where(eq(registrations.id, fixture.homePlayers[0]!));
      await handle.db
        .update(registrations)
        .set({ bowlingStyle: null })
        .where(eq(registrations.id, fixture.awayPlayers[0]!));
    } finally {
      await handle.sql.end({ timeout: 5 });
    }
    await scoringSession(context, fixture.actorToken);
    await page.goto("/score");
    await capture(page, "01-scorer-home", [theme]);
    const gateContext = await browser.newContext({
      userAgent: "Mozilla/5.0 Android WhatsApp/2.24",
      baseURL: "http://localhost:3050",
    });
    try {
      await scoringSession(gateContext, fixture.actorToken);
      const gate = await gateContext.newPage();
      await gate.goto(`/score/${fixture.fixtureId}/setup`);
      await expect(gate.getByTestId("in-app-gate")).toBeVisible();
      await capture(gate, "05-whatsapp-browser-gate", [theme]);
    } finally {
      await gateContext.close();
    }
    await page.goto(`/score/${fixture.fixtureId}/setup`);
    await capture(page, "02-conditions", [theme]);
    await page.getByRole("button", { name: "Looks right Confirm conditions", exact: true }).click();
    await capture(page, "03-playing-xi", [theme]);
    await page.getByRole("button", { name: "Both XIs ready Next: toss", exact: true }).click();
    await capture(page, "04-toss-openers", [theme]);
    await page.getByTestId("setup-start").click();
    await page.waitForURL(`**/score/${fixture.fixtureId}`);
    const style = page.getByRole("dialog", { name: /First over · bowling style/ });
    await expect(style).toBeVisible();
    await capture(page, "09-first-bowler-style", [theme]);
    await style.getByRole("button", { name: "Save style", exact: true }).click();
    await sent(page);
    await expect(page.getByRole("group", { name: "This over", exact: true })).toBeVisible();
    await expect(
      page.getByRole("group", { name: "This over", exact: true }).getByRole("button"),
    ).toHaveCount(0);
    await capture(page, "07-live-pad", [theme]);
    const seen = new Set<string>();
    await firstScoringOver(page, fixture, async () => {
      const title = await page.getByRole("dialog").getByRole("heading").textContent();
      const screen =
        title === "Where did it go?"
          ? "08-left-handed-shot-map"
          : title === "Wicket"
            ? "10-wicket-fielding-pin"
            : title === "Who bowls the next over?"
              ? "11-over-done-next-bowler"
              : "extra-delivery-correction";
      if (seen.has(screen)) return;
      seen.add(screen);
      if (screen === "08-left-handed-shot-map")
        await expect(page.getByRole("dialog")).toContainText(
          "bats left-handed, so the field is flipped for you",
        );
      await capture(page, screen, [theme], screen === "08-left-handed-shot-map");
    });
    expect(
      await page
        .getByRole("group", { name: "This over", exact: true })
        .getByRole("button", { name: /^Edit delivery / })
        .count(),
    ).toBeGreaterThan(0);
    await nextBowler(page, fixture.awayNames[1]!);
    await readyOffline(page, fixture.fixtureId);
    await context.setOffline(true);
    await runBall(page);
    await expect(page.getByTestId("pad-sync")).toHaveAttribute("data-pending", "1");
    await capture(page, "06-offline-queue", [theme]);
    await context.setOffline(false);
    await sent(page);
    await page.getByTestId("pad-menu").click();
    await capture(page, "12-match-options", [theme]);
    await page.getByTestId("handover-open").click();
    await page.getByRole("button", { name: "Create handover link", exact: true }).click();
    await expect(
      page.getByRole("img", { name: "Scan to take over scoring", exact: true }),
    ).toBeVisible();
    await capture(page, "06-handover-qr", [theme]);
    await page.getByRole("button", { name: "Close Hand over scoring", exact: true }).click();
    for (const [item, title] of [
      ["interrupt", "Pause play"],
      ["revise", "Shorten this innings"],
      ["no-result", "No result"],
      ["restart", "Restart match"],
    ]) {
      await page.getByTestId("pad-menu").click();
      await page.getByTestId(`menu-${item}`).click();
      await expect(page.getByRole("dialog", { name: title, exact: true })).toBeVisible();
      await capture(page, `12-${item}`, [theme]);
      await page.getByRole("button", { name: `Close ${title}`, exact: true }).click();
    }
  });
}

test("viewer, insights and organiser reference screens from accepted matches", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  const fixture = await seedScoringFixture({ publicDelaySeconds: 0, kickoffTime: "23:59" });
  await scoringSession(page.context(), fixture.actorToken);
  const handle = createDb(process.env["DATABASE_URL"] ?? "", { max: 1 });
  try {
    const [row] = await handle.db.select().from(fixtures).where(eq(fixtures.id, fixture.fixtureId));
    if (!row) throw new Error("Missing screen fixture");
    const [season] = await handle.db
      .select()
      .from(competitions)
      .where(eq(competitions.id, row.competitionId));
    if (!season) throw new Error("Missing screen season");
    await handle.db
      .update(competitions)
      .set({
        tier: "pro",
        scoringRules: { ...season.scoringRules, sponsor: { name: "LS1 Match Sponsor" } },
      })
      .where(eq(competitions.id, row.competitionId));
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
  const publicContext = await browser.newContext({
    baseURL: "http://localhost:3050",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const viewer = await publicContext.newPage();
  const route = `/c/${fixture.slug}/m/${encodeURIComponent("Match 1")}`;
  try {
    await viewer.goto(route);
    await expect(viewer.getByRole("region", { name: "Match score", exact: true })).toContainText(
      "Match day",
    );
    await expect(
      viewer.getByRole("link", { name: "Sign in to remind me at the toss", exact: true }),
    ).toBeVisible();
    await capture(viewer, "21-states-before-start");
    await startAwayScoring(page, fixture);
    await runBall(page);
    await sent(page);
    let release = () => {};
    const scripts = new Promise<void>((resolve) => {
      release = resolve;
    });
    await viewer.route("**/_next/static/chunks/**", async (request) => {
      await scripts;
      await request.continue();
    });
    try {
      await viewer.goto(route, { waitUntil: "commit" });
      await expect(viewer.getByTestId("live-score")).toHaveText("0/0(0.1)");
      await capture(viewer, "21-states-first-open-ssr", THEMES, true);
    } finally {
      release();
      await viewer.unrouteAll({ behavior: "wait" });
    }
    await viewer.waitForLoadState("load");
    await capture(viewer, "14-public-live");
    await capture(viewer, "19-laptop-live");
    const og = await viewer.locator('meta[property="og:image"]').getAttribute("content");
    if (!og) throw new Error("Missing live preview");
    await image(viewer, "20-live-link-preview", new URL(og, viewer.url()).href);
    await viewer.clock.install();
    await viewer.route("**/api/live/**", (request) => request.abort("internetdisconnected"));
    // A poll scheduled before clock.install still runs on real time, so one
    // fixed jump can land before it fails. Advance until two polls have failed.
    await expect
      .poll(
        async () => {
          await viewer.clock.runFor(2000);
          return viewer.getByTestId("live-reconnecting").isVisible();
        },
        { timeout: 30000 },
      )
      .toBe(true);
    await capture(viewer, "21-states-reconnecting");
    await viewer.clock.fastForward(65000);
    await expect(viewer.getByTestId("live-stale")).toBeVisible();
    await capture(viewer, "21-states-scorer-offline");
    await viewer.unroute("**/api/live/**");
    await viewer.clock.resume();
    for (let ball = 1; ball < 6; ball++) await runBall(page, ball === 5 ? 1 : 0);
    for (let over = 1; over < 10; over++) {
      await nextBowler(page, fixture.homeNames[over % 5]!);
      for (let ball = 0; ball < 6; ball++) await runBall(page, ball === 5 ? 1 : 0);
    }
    const innings = page.getByRole("dialog", { name: "Start next innings", exact: true });
    await expect(innings).toBeVisible();
    await capture(page, "extra-innings-break");
    await innings.getByTestId("innings-start-confirm").click();
    await runBall(page, 6, true);
    await runBall(page, 6, true);
    await expect(page.getByTestId("finish-sheet")).toBeVisible();
    await capture(page, "13-target-reached");
    await page.getByTestId("finish-confirm").click();
    await sent(page);
    expect((await readScoringFixture(fixture.fixtureId)).match?.trustLevel).toBe("verified");
    await viewer.goto(route);
    await expect(viewer.getByTestId("result-panel")).toBeVisible();
    await capture(viewer, "17-result-player-of-match");
    await viewer.getByRole("link", { name: "Scorecard", exact: true }).click();
    await expect(viewer.getByRole("table")).toHaveCount(2);
    await capture(viewer, "15-scorecard");
    await viewer.getByRole("link", { name: "Charts", exact: true }).click();
    await expect(viewer.getByTestId("live-wagon")).toBeVisible();
    await capture(viewer, "16-charts-wagon");
    for (const chart of ["Worm", "Manhattan"]) {
      await viewer.getByRole("tab", { name: chart, exact: true }).click();
      await capture(viewer, `16-charts-${chart.toLowerCase()}`);
    }
    await viewer.goto(`/c/${fixture.slug}/p/LS1-Away-1/insights`);
    await expect(
      viewer.getByRole("heading", { name: "Player insights", exact: true }),
    ).toBeVisible();
    await capture(viewer, "21-batter-insights");
    await viewer.goto(`/c/${fixture.slug}/p/LS1-Home-1/insights?view=bowling`);
    await capture(viewer, "22-bowler-insights");
    await page.goto(`/seasons/${fixture.slug}/fixtures/today`);
    await expect(
      page.getByRole("rowheader", { name: "Match 1 LS1 Strikers vs LS1 Royals", exact: true }),
    ).toBeVisible();
    await capture(page, "24-match-day-board");
    await page.goto(`/seasons/${fixture.slug}/awards`);
    await page.getByRole("button", { name: "Update computed awards", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Season award picks" }).locator("article"),
    ).toHaveCount(7);
    await capture(page, "25-season-awards-leaderboards");
    await image(
      page,
      "27-result-poster",
      `/seasons/${fixture.slug}/posters/result/${fixture.fixtureId}?theme=stadium&size=portrait`,
    );
    const next = await followupScoringFixture(fixture, 2);
    await page.goto(`/seasons/${fixture.slug}/brief/${next.fixtureId}`);
    await expect(page.getByRole("heading", { name: "Know LS1 Royals", exact: true })).toBeVisible();
    await capture(page, "23-pro-captain-brief");
    await startAwayScoring(page, next);
    await runBall(page, 1);
    await sent(page);
    await viewer.goto(`/c/${fixture.slug}/m/${encodeURIComponent("Match 2")}/overlay`);
    await expect(viewer.locator(".overlay-sponsor")).toContainText("LS1 Match Sponsor");
    await capture(viewer, "26-stream-overlay", THEMES, false, [{ width: 1920, height: 1080 }]);
  } finally {
    await publicContext.close();
  }
});

test("opposing captain confirmation reference from a real delivered notice", async ({
  page,
  browser,
}) => {
  const fixture = await seedScoringFixture({ teamManaged: true, publicDelaySeconds: 0 });
  await scoringSession(page.context(), fixture.actorToken);
  const deviceId = "c46-confirmation-screens";
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
  const noticeId = await confirmationNoticeFor(fixture.fixtureId, fixture.nextActorId);
  expect(noticeId).not.toBeNull();
  const recipient = await browser.newContext({ baseURL: "http://localhost:3050" });
  try {
    await scoringSession(recipient, fixture.nextActorToken);
    const manager = await recipient.newPage();
    await manager.goto(`/inbox?confirmation=${noticeId ?? ""}`);
    await expect(
      manager.getByRole("heading", { name: "Is this result right?", exact: true }),
    ).toBeVisible();
    await capture(manager, "18-opposing-captain-confirms");
    await manager.getByRole("button", { name: "Yes, that’s right", exact: true }).click();
    await expect(manager.locator("form").getByRole("status")).toContainText(
      "Your response is recorded.",
    );
    expect((await readScoringFixture(fixture.fixtureId)).match?.trustLevel).toBe("confirmed");
  } finally {
    await recipient.close();
  }
});
