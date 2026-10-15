import { competitions, createDb, fixtures } from "@desiauction/db";
import { eq } from "drizzle-orm";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  readSeasonAwards,
  followupScoringFixture,
  startAwayScoring,
  firstScoringOver,
  seedScoringFixture,
  startScoring,
  runBall,
  nextBowler,
  sent,
  readScoringFixture,
  scoringSession,
  type ScoringObservation,
  type ScoringFixture,
} from "./scoring-fixtures";

async function capturePublicMatch(viewer: Page, state: string) {
  await expect(viewer.getByRole("main")).toHaveCount(1);
  await expect(viewer.getByRole("heading", { level: 1 })).toHaveCount(1);
  for (const theme of ["daylight", "floodlight"]) {
    await viewer.evaluate((value) => {
      document.documentElement.setAttribute("data-theme", value);
    }, theme);
    for (const width of [390, 1440]) {
      await viewer.setViewportSize({ width, height: 900 });
      await viewer.waitForFunction(() =>
        document.getAnimations().every((animation) => {
          const iterations = animation.effect?.getComputedTiming().iterations;
          return iterations === Infinity || animation.playState !== "running";
        }),
      );
      expect((await new AxeBuilder({ page: viewer }).analyze()).violations).toEqual([]);
      const fits = await viewer.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      if (!fits) {
        console.log(
          "Horizontal overflow diagnostic",
          state,
          theme,
          width,
          await viewer.evaluate(() =>
            Array.from(document.querySelectorAll("*"))
              .map((element) => ({
                tag: element.tagName,
                className: element.className,
                left: element.getBoundingClientRect().left,
                right: element.getBoundingClientRect().right,
                width: element.getBoundingClientRect().width,
              }))
              .filter((rect) => rect.width > 0 && (rect.right > window.innerWidth || rect.left < 0))
              .slice(-30),
          ),
        );
        await viewer.screenshot({
          path: test.info().outputPath(`overflow-${state}-${theme}-${String(width)}.png`),
          fullPage: true,
        });
      }
      expect(fits).toBe(true);
      await viewer.screenshot({
        path: test.info().outputPath(`live-${state}-${theme}-${String(width)}.png`),
        fullPage: true,
      });
      if (state.startsWith("brief"))
        await viewer.screenshot({
          path: test.info().outputPath(`viewport-${state}-${theme}-${String(width)}.png`),
        });
    }
  }
}

type RenderSample = { at: number; seq: number; text: string };
type ObservationWindow = Window & { __ls1C34Samples?: RenderSample[]; __ls1C34Commit?: number };
async function observeRenderedScores(viewer: Page) {
  await viewer.evaluate(() => {
    const scope = window as ObservationWindow;
    scope.__ls1C34Samples = [];
    let scheduled = false;
    const record = () => {
      scheduled = false;
      const score = document.querySelector('[data-testid="live-score"]');
      const seq = Number(score?.getAttribute("data-seq") ?? "-1");
      if (seq < 0) return;
      const text = score?.textContent?.replace(/\s/g, "") ?? "";
      const previous = scope.__ls1C34Samples?.at(-1);
      if (previous?.seq === seq && previous.text === text) return;
      scope.__ls1C34Samples?.push({ at: performance.timeOrigin + performance.now(), seq, text });
    };
    new MutationObserver(() => {
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(record);
      }
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    requestAnimationFrame(record);
  });
}
function scoringObservation(page: Page, viewer: Page, fixtureId: string) {
  const observations: {
    kind: "ball" | "correction";
    eventId: string;
    seq: number;
    renderedSeq: number;
    latencyMs: number;
    figures: string;
  }[] = [];
  const observe: ScoringObservation = async (kind, commit) => {
    await viewer.bringToFront();
    await expect.poll(() => viewer.evaluate(() => document.visibilityState)).toBe("visible");
    if (kind === "ball") await expect(viewer.locator(".live-status")).toContainText("Live");
    await page.evaluate(() => {
      const scope = window as ObservationWindow;
      delete scope.__ls1C34Commit;
      document.addEventListener(
        "click",
        () => {
          scope.__ls1C34Commit = performance.timeOrigin + performance.now();
        },
        { capture: true, once: true },
      );
    });
    const responsePromise = page.waitForResponse(
      (response) => {
        if (
          new URL(response.url()).pathname !== `/api/score/${fixtureId}/events` ||
          response.request().method() !== "POST"
        )
          return false;
        const request = response.request().postDataJSON() as { events?: { type: string }[] };
        return (
          request.events?.some((event) =>
            kind === "ball" ? event.type === "ball" : ["amend", "void"].includes(event.type),
          ) ?? false
        );
      },
      { timeout: 10000 },
    );
    void responsePromise.catch(() => {});
    await commit();
    const clickedAt = await page.evaluate(() => (window as ObservationWindow).__ls1C34Commit);
    if (clickedAt === undefined) throw new Error("No passive commit-click timestamp");
    const score = await page.getByTestId("pad-score").textContent();
    const overs = await page.getByTestId("pad-overs").textContent();
    const expected = `${score ?? ""}${overs ?? ""}`.replace(/\s/g, "").replace(/\.0\)/, ")");
    await viewer.bringToFront();
    await expect.poll(() => viewer.evaluate(() => document.visibilityState)).toBe("visible");
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const submitted = response.request().postDataJSON() as {
      events: { eventId: string; type: string }[];
    };
    const event = submitted.events.find((event) =>
      kind === "ball" ? event.type === "ball" : ["amend", "void"].includes(event.type),
    );
    if (!event) throw new Error("No correlated submitted event");
    const accepted = (await response.json()) as {
      ok: boolean;
      lastSeq: number;
      acks: { eventId: string; seq: number | null; status: string }[];
    };
    expect(accepted.ok).toBe(true);
    const ack = accepted.acks.find((ack) => ack.eventId === event.eventId);
    if (!ack || ack.seq === null || !["stored", "duplicate"].includes(ack.status))
      throw new Error("Delivery was not accepted");
    const rendered = () =>
      viewer.evaluate(
        ({ seq, text }) =>
          (window as ObservationWindow).__ls1C34Samples?.find(
            (sample) => sample.seq >= seq && sample.text === text,
          ) ?? null,
        { seq: accepted.lastSeq, text: expected },
      );
    await expect
      .poll(rendered, { timeout: kind === "ball" ? 4000 : 20000, intervals: [25, 50, 100] })
      .not.toBeNull();
    const sample = await rendered();
    if (!sample) throw new Error("Accepted score was not rendered");
    const latencyMs = sample.at - clickedAt;
    expect(latencyMs).toBeGreaterThanOrEqual(0);
    if (kind === "ball")
      expect(latencyMs, `Delivery ${event.eventId} seq ${String(ack.seq)}`).toBeLessThanOrEqual(
        3000,
      );
    observations.push({
      kind,
      eventId: event.eventId,
      seq: ack.seq,
      renderedSeq: sample.seq,
      latencyMs,
      figures: sample.text,
    });
    console.log("C34 commit-to-render", JSON.stringify(observations.at(-1)));
  };
  return { observe, observations };
}

async function completeAwaySample(page: Page, fixture: ScoringFixture) {
  await startAwayScoring(page, fixture);
  await sent(page);
  expect(
    (await readScoringFixture(fixture.fixtureId)).events.filter(
      (event) => event.type === "style_set",
    ),
  ).toHaveLength(22);
  for (let over = 0; over < 10; over++) {
    if (over > 0) await nextBowler(page, fixture.homeNames[over % 5]!);
    for (let ball = 0; ball < 6; ball++) await runBall(page, ball === 5 ? 1 : 0);
    await sent(page);
  }
  const nextInnings = page.getByRole("dialog", { name: "Start next innings", exact: true });
  await expect(nextInnings).toBeVisible();
  await nextInnings.getByTestId("innings-start-confirm").click();
  await expect(page.getByTestId("pad-run-0")).toBeEnabled();
  await runBall(page, 6);
  await runBall(page, 6);
  await expect(page.getByTestId("finish-sheet")).toBeVisible();
  await page.getByTestId("finish-confirm").click();
  await sent(page);
  const accepted = await readScoringFixture(fixture.fixtureId);
  expect(accepted.match?.trustLevel).toBe("verified");
  expect(accepted.result?.source).toBe("scored");
}
async function c42ScreensAndHint(page: Page, fixture: ScoringFixture) {
  await page.goto(`/seasons/${fixture.slug}/awards`);
  await expect(page.getByRole("heading", { name: "Season awards", exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Season award picks" }).locator("article"),
  ).toHaveCount(7);
  const computation = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/seasons/${fixture.slug}/awards`,
  );
  await page.getByRole("button", { name: "Update computed awards", exact: true }).click();
  await computation;
  const awards = await readSeasonAwards(fixture.fixtureId);
  expect(awards).toHaveLength(7);
  expect(awards.every((row) => row.source === "auto")).toBe(true);
  expect(awards.find((row) => row.kind === "scorer_of_season")?.winnerPersonId).toBe(
    fixture.actorId,
  );
  await page.goto(`/seasons/${fixture.slug}/awards`);
  await expect(page.getByRole("navigation", { name: "Leaderboard" })).toBeVisible();
  await page.getByRole("link", { name: "SR", exact: true }).click();
  await expect(page).toHaveURL(/tab=SR/);
  await expect(page.getByRole("table", { name: "SR leaderboard", exact: true })).toBeVisible();
  await page.getByLabel("Ball type", { exact: true }).selectOption("leather");
  await page.getByRole("button", { name: "Apply conditions", exact: true }).click();
  await expect(page).toHaveURL(/tab=SR.*ball=leather/);
  await expect(page.getByText("Whole-season award picks", { exact: true })).toBeVisible();
  await capturePublicMatch(page, "season-awards");
  await page.getByText("How MVP points work", { exact: true }).click();
  await expect(page.getByRole("table", { name: "Cricket MVP points" })).toBeVisible();
  await capturePublicMatch(page, "season-awards-points");
  await page.goto("/me/insights");
  await capturePublicMatch(page, "insights-self");
  // The original full T10 gives each away opener 30 balls. Build the larger
  // sample through a second accepted, completed match, without injecting facts.
  const second = await followupScoringFixture(fixture, 2);
  await completeAwaySample(page, second);
  const third = await followupScoringFixture(fixture, 3);
  await startAwayScoring(page, third);
  for (let ball = 0; ball < 6; ball++) await runBall(page, ball === 5 ? 1 : 0);
  await sent(page);
  const hint = page.getByRole("dialog", { name: "Who bowls the next over?", exact: true });
  await expect(hint.locator(".scoring-matchup-hint")).toContainText(
    "Away player 1 scores slowest against",
  );
  await expect(hint.locator(".scoring-matchup-hint")).toContainText("2 matches");
  await capturePublicMatch(page, "qualified-matchup-hint");
}

test("C42 awards, self insights and a qualified private matchup use real completed matches", async ({
  page,
}) => {
  test.setTimeout(180000);
  const fixture = await seedScoringFixture({ publicDelaySeconds: 0, minorPlayer: true });
  await completeAwaySample(page, fixture);
  await page.goto(`/c/${fixture.slug}/p/LS1-Away-1/insights`);
  await expect(
    page.locator(".insight-heading").getByText("60 balls in 1 matches", { exact: true }),
  ).toBeVisible();
  await capturePublicMatch(page, "qualified-batting-insights");
  const minor = await page.goto(`/c/${fixture.slug}/p/LS1-Away-11/insights`);
  expect(minor?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Player insights", exact: true })).toHaveCount(0);
  await c42ScreensAndHint(page, fixture);
});

test("a full T10 match: twenty legal overs, corrections, public viewer and result/table", async ({
  page,
  browser,
}) => {
  test.setTimeout(600000);
  const fixture = await seedScoringFixture({ publicDelaySeconds: 0, kickoffTime: "23:59" });
  const viewerContext = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    reducedMotion: "reduce",
  });
  const viewer = await viewerContext.newPage();
  const viewerSignals = {
    pageErrors: 0,
    failedRequests: 0,
    failedLiveRequests: 0,
    responses: [] as { at: number; status: number; seq: number | null; phase: string | null }[],
  };
  viewer.on("pageerror", () => {
    viewerSignals.pageErrors += 1;
  });
  viewer.on("requestfailed", (request) => {
    viewerSignals.failedRequests += 1;
    if (new URL(request.url()).pathname.startsWith("/api/live/"))
      viewerSignals.failedLiveRequests += 1;
  });
  viewer.on("response", async (response) => {
    if (!new URL(response.url()).pathname.startsWith("/api/live/")) return;
    let seq: number | null = null;
    let phase: string | null = null;
    if (response.status() === 200) {
      const body = (await response.json()) as {
        seq?: number;
        phase?: string;
        live?: { seq: number; phase: string };
      };
      seq = body.seq ?? body.live?.seq ?? null;
      phase = body.phase ?? body.live?.phase ?? null;
    }
    viewerSignals.responses.push({ at: Date.now(), status: response.status(), seq, phase });
  });
  const liveUrl = `/c/${fixture.slug}/m/Match%201`;
  await viewer.goto(`/c/${fixture.slug}`);
  await expect(viewer.getByRole("link", { name: "Open match", exact: true })).toHaveAttribute(
    "href",
    liveUrl,
  );
  await viewer.getByRole("link", { name: "Open match", exact: true }).click();
  await expect(viewer.getByTestId("live-score")).toContainText("HOURS");
  await expect(viewer.getByRole("link", { name: "Charts", exact: true })).toBeVisible();
  await capturePublicMatch(viewer, "waiting");
  await scoringSession(page.context(), fixture.actorToken);
  const board = await page.context().newPage();
  await board.goto(`/seasons/${fixture.slug}/fixtures/today`);
  const problemCard = board.locator(".today-problem");
  await expect(problemCard).toHaveCount(1);
  await expect(problemCard).toContainText("No scorer assigned");
  await expect(problemCard.getByRole("link")).toHaveCount(1);
  await expect(problemCard.getByRole("link")).toHaveAttribute(
    "href",
    `/score/${fixture.fixtureId}/setup`,
  );
  await capturePublicMatch(board, "match-day-before-start");
  await observeRenderedScores(viewer);
  const deliveryTiming = scoringObservation(page, viewer, fixture.fixtureId);
  await startScoring(page, fixture);
  await viewer.bringToFront();
  await expect.poll(() => viewer.evaluate(() => document.visibilityState)).toBe("visible");
  await expect(viewer.getByTestId("live-score")).toHaveText("0/0(0)", { timeout: 20000 });
  await expect(viewer.locator(".live-status")).toContainText("Live");
  await firstScoringOver(page, fixture, undefined, deliveryTiming.observe);
  await expect(page.locator(".scoring-matchup-hint")).toHaveCount(0);
  await board.goto(`/seasons/${fixture.slug}/fixtures/today`);
  await expect(board.getByRole("heading", { name: "Needs you", exact: true })).toBeVisible();
  const boardTable = board.getByRole("table");
  await expect(boardTable).toContainText("15/2 (1)");
  await expect(boardTable.getByRole("link", { name: /^Open match · Match 1$/ })).toHaveAttribute(
    "href",
    `/seasons/${fixture.slug}/fixtures?match=${fixture.fixtureId}`,
  );
  await expect(
    boardTable.getByRole("link", { name: "Captain’s brief", exact: true }),
  ).toHaveAttribute("href", `/seasons/${fixture.slug}/brief/${fixture.fixtureId}`);
  await expect(boardTable.getByRole("progressbar")).toHaveAttribute("max", "60");
  await expect(boardTable.getByRole("progressbar")).toHaveAttribute("value", "6");
  await expect(board.getByText("Match viewer peaks", { exact: true })).toBeVisible();
  await capturePublicMatch(board, "match-day-live");
  await board.setViewportSize({ width: 390, height: 900 });
  const boardScroll = board.getByRole("region", {
    name: "Today’s matches, scroll horizontally for all columns",
  });
  expect(await boardScroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
    true,
  );
  await boardScroll.focus();
  await board.keyboard.press("ArrowRight");
  await expect.poll(() => boardScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await board.close();
  await viewer.bringToFront();
  await expect(viewer.getByTestId("live-score")).toHaveText("15/2(1)");
  await capturePublicMatch(viewer, "first-over");
  const ssrContext = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    javaScriptEnabled: false,
  });
  const ssr = await ssrContext.newPage();
  await ssr.goto(liveUrl);
  await expect(ssr.getByTestId("live-score")).toHaveText("15/2(1)");
  await ssrContext.close();
  const firstOver = await readScoringFixture(fixture.fixtureId);
  expect(firstOver.projection?.state.innings[0]).toMatchObject({
    runs: 15,
    wickets: 2,
    overs: "1",
  });
  expect(firstOver.projection?.seq).toBe(firstOver.match?.lastSeq);
  expect(firstOver.events.some((event) => event.type === "void")).toBe(true);
  expect(firstOver.events.some((event) => event.type === "amend")).toBe(true);
  const deliveries = firstOver.events.filter((event) => event.type === "ball");
  expect(deliveries.some((event) => JSON.stringify(event.payload).includes('"where"'))).toBe(true);
  expect(firstOver.events.some((event) => JSON.stringify(event.payload).includes('"shot"'))).toBe(
    true,
  );
  for (let over = 1; over < 10; over++) {
    await nextBowler(page, fixture.awayNames[over % 5]!);
    if (over === 2) {
      await page.getByTestId("pad-menu").click();
      await page.getByTestId("menu-interrupt").click();
      await page
        .getByRole("dialog", { name: "Pause play", exact: true })
        .getByRole("button", { name: "Save change", exact: true })
        .click();
      await sent(page);
      await viewer.bringToFront();
      await expect(viewer.getByText("Play stopped", { exact: true })).toBeVisible();
      await capturePublicMatch(viewer, "interrupted");
      await page.getByTestId("pad-menu").click();
      await page.getByTestId("menu-resume").click();
      await sent(page);
      await viewer.bringToFront();
      await expect(viewer.locator(".live-status").getByText("Live", { exact: true })).toBeVisible({
        timeout: 20000,
      });
    }
    for (let ball = 0; ball < 6; ball++)
      await runBall(page, 0, false, undefined, deliveryTiming.observe);
    await sent(page);
    if (over === 1) {
      await viewer.bringToFront();
      await expect.poll(() => viewer.evaluate(() => document.visibilityState)).toBe("visible");
      console.log("Public viewer before second-over assertion", {
        visibility: await viewer.evaluate(() => document.visibilityState),
        ...viewerSignals,
      });
      try {
        await expect(viewer.getByTestId("live-score")).toHaveText("15/2(2)");
      } finally {
        console.log("Public viewer after second-over assertion", viewerSignals);
      }
    }
  }
  const innings = page.getByRole("dialog", { name: "Start next innings", exact: true });
  await expect(innings).toBeVisible();
  await viewer.bringToFront();
  await expect.poll(() => viewer.evaluate(() => document.visibilityState)).toBe("visible");
  await expect(viewer.getByText("Innings break", { exact: true })).toBeVisible({ timeout: 20000 });
  await capturePublicMatch(viewer, "innings-break");
  await expect(page.getByTestId("pad-run-0")).toBeDisabled();
  await innings
    .getByRole("combobox", { name: "Non-striker", exact: true })
    .selectOption(fixture.awayPlayers[0]!);
  await expect(innings.getByTestId("innings-start-confirm")).toBeDisabled();
  await innings
    .getByRole("combobox", { name: "Non-striker", exact: true })
    .selectOption(fixture.awayPlayers[1]!);
  await innings.getByTestId("innings-start-confirm").evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByTestId("pad-run-0")).toBeEnabled();
  await sent(page);
  await viewer.bringToFront();
  await expect.poll(() => viewer.evaluate(() => document.visibilityState)).toBe("visible");
  try {
    await expect(viewer.getByTestId("live-score")).toHaveText("0/0(0)", { timeout: 20000 });
    await expect(viewer.locator(".live-status")).toContainText("Live");
  } finally {
    console.log("Public viewer break-to-live checkpoint", viewerSignals);
  }
  for (let over = 0; over < 10; over++) {
    if (over > 0) await nextBowler(page, fixture.homeNames[over % 5]!);
    for (let ball = 0; ball < 6; ball++) {
      const legal = over * 6 + ball;
      await runBall(
        page,
        legal < 57 ? 0 : legal < 59 ? 6 : 4,
        legal >= 57,
        undefined,
        deliveryTiming.observe,
      );
    }
    await sent(page);
  }
  await expect(page.getByTestId("finish-sheet")).toBeVisible();
  await page.getByTestId("finish-confirm").click();
  await sent(page);
  await expect(page.getByRole("dialog", { name: "Result saved", exact: true })).toBeVisible();
  const finished = await readScoringFixture(fixture.fixtureId);
  expect(finished.events.filter((event) => event.type === "innings_started")).toHaveLength(2);
  expect(finished.result).toMatchObject({
    source: "scored",
    outcome: "away_win",
    winnerTeamId: fixture.awayId,
    score: { home: { runs: 15, wickets: 2, balls: 60 }, away: { runs: 16, wickets: 0, balls: 60 } },
  });
  expect(finished.projection?.state).toMatchObject({
    phase: "finished",
    innings: [
      { runs: 15, overs: "10" },
      { runs: 16, overs: "10" },
    ],
  });
  expect(finished.projection?.seq).toBe(finished.match?.lastSeq);
  await viewer.bringToFront();
  await expect.poll(() => viewer.evaluate(() => document.visibilityState)).toBe("visible");
  try {
    await expect(viewer.getByTestId("live-score")).toHaveText("16/0(10)");
    await expect(viewer.getByTestId("live-result")).toContainText("won by 10 wickets");
  } finally {
    console.log("Public viewer terminal checkpoint", viewerSignals);
  }
  const ballTimings = deliveryTiming.observations.filter((item) => item.kind === "ball");
  const correctionTimings = deliveryTiming.observations.filter(
    (item) => item.kind === "correction",
  );
  expect(ballTimings).toHaveLength(finished.events.filter((event) => event.type === "ball").length);
  expect(correctionTimings).toHaveLength(
    finished.events.filter((event) => ["amend", "void"].includes(event.type)).length,
  );
  console.log("C34 delivery timing summary", {
    deliveries: ballTimings.length,
    corrections: correctionTimings.length,
    maxMs: Math.max(...ballTimings.map((item) => item.latencyMs)),
  });
  const ogUrl = await viewer.locator('meta[property="og:image"]').getAttribute("content");
  if (!ogUrl) throw new Error("Missing canonical OG image");
  const og = await viewer.request.get(new URL(ogUrl, viewer.url()).href);
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"]).toContain("image/png");
  const awardsPanel = viewer.getByTestId("result-panel");
  await expect(awardsPanel).toBeVisible();
  await expect(awardsPanel.getByText("Player of the Match", { exact: true })).toBeVisible();
  await expect(awardsPanel.locator(".result-points")).toContainText("points");
  await expect(awardsPanel.locator(".result-breakdown dl").first()).toBeVisible();
  await expect(awardsPanel.locator(".result-trust")).not.toBeEmpty();
  await expect(awardsPanel.getByRole("link", { name: /Share poster/ })).toHaveAttribute(
    "href",
    /^\/login\?next=/,
  );
  await expect(
    awardsPanel.getByRole("link", { name: "WhatsApp · Link with score" }),
  ).toHaveAttribute("href", /^https:\/\/wa\.me\//);
  const poster = await page.request.get(
    `/seasons/${fixture.slug}/posters/result/${fixture.fixtureId}?theme=stadium&size=portrait`,
  );
  expect(poster.status()).toBe(200);
  expect(poster.headers()["content-type"]).toContain("image/png");
  const refusedPoster = await viewer.request.get(
    `/seasons/${fixture.slug}/posters/result/${fixture.fixtureId}`,
  );
  expect([401, 404]).toContain(refusedPoster.status());
  await capturePublicMatch(viewer, "result");
  await viewer.getByRole("link", { name: "Scorecard", exact: true }).click();
  await expect(viewer.locator("table")).toHaveCount(4);
  await expect(viewer.getByRole("table")).toHaveCount(2);
  await viewer.getByRole("tab", { name: /LS1 Strikers/ }).click();
  await expect(viewer.getByRole("tabpanel")).toContainText("15/2");
  await expect(viewer.getByRole("tabpanel")).toContainText("Run out");
  await expect(viewer.getByRole("tabpanel")).toContainText(/c .* b /);
  await capturePublicMatch(viewer, "scorecard-first-innings");
  await viewer.getByRole("tab", { name: /LS1 Royals/ }).click();
  await expect(viewer.getByRole("tabpanel")).toContainText("16/0");
  expect(await viewer.locator("body").innerText()).not.toMatch(/@|\+91/);
  await capturePublicMatch(viewer, "scorecard");
  await viewer.getByRole("tab", { name: /LS1 Royals/ }).focus();
  await viewer.keyboard.press("ArrowLeft");
  await expect(viewer.getByRole("tab", { name: /LS1 Strikers/ })).toBeFocused();
  await expect(viewer.getByRole("tabpanel")).toContainText("15/2");
  await viewer.getByRole("link", { name: "Charts", exact: true }).click();
  await expect(viewer.getByTestId("live-wagon")).toBeVisible();
  await expect(viewer.getByTestId("live-wagon")).toContainText("recorded scoring shots");
  await viewer.getByRole("button", { name: "All", exact: true }).click();
  const shot = viewer.getByTestId("live-wagon").locator('line[tabindex="0"]').first();
  await shot.focus();
  await expect(viewer.getByTestId("live-wagon").getByRole("status")).toContainText("degrees");
  await viewer.getByRole("link", { name: "See it as a table" }).click();
  await expect(viewer.getByRole("table", { name: "Recorded scoring shots" })).toBeVisible();
  await capturePublicMatch(viewer, "charts-wagon");
  await viewer.getByRole("tab", { name: "Worm", exact: true }).click();
  const worm = viewer.getByRole("region", { name: "Worm chart", exact: true });
  await worm.locator('circle[tabindex="0"]').last().focus();
  await expect(worm.getByRole("status")).toContainText("16/0");
  await viewer.getByRole("link", { name: "See it as a table" }).click();
  await expect(viewer.getByRole("table", { name: "Score progression" })).toBeVisible();
  await capturePublicMatch(viewer, "charts-worm");
  await viewer.getByRole("tab", { name: "Manhattan", exact: true }).click();
  const manhattan = viewer.getByRole("region", { name: "Manhattan chart", exact: true });
  await manhattan.locator('rect[tabindex="0"]').first().focus();
  await expect(manhattan.getByRole("status")).toContainText("Over");
  await viewer.getByRole("link", { name: "See it as a table" }).click();
  await expect(manhattan.getByRole("table")).toBeVisible();
  await capturePublicMatch(viewer, "charts-manhattan");
  await viewer.getByRole("tab", { name: "Manhattan", exact: true }).focus();
  await viewer.keyboard.press("ArrowLeft");
  await expect(viewer.getByRole("tab", { name: "Worm", exact: true })).toBeFocused();
  if (!finished.match?.shareToken) throw new Error("Missing synthetic share token");
  const shareResponse = await viewer.goto(`/m/${finished.match.shareToken}`);
  await expect(viewer.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(shareResponse?.headers()["x-robots-tag"]).toContain("noindex");
  await viewer.goto(`/c/${fixture.slug}`);
  await expect(viewer.getByRole("link", { name: "Scorecard", exact: true })).toHaveAttribute(
    "href",
    liveUrl,
  );
  await viewer.goto(`/c/${fixture.slug}/p/LS1-Home-1`);
  const career = viewer.getByTestId("cricket-career");
  await expect(career).toBeVisible();
  await expect(career.getByRole("heading", { name: "Batting · 1 match" })).toBeVisible();
  await career.getByRole("button", { name: "T10", exact: true }).click();
  await expect(career.getByRole("heading", { name: "Last five innings" })).toBeVisible();
  await expect(career.locator(".career-recent")).toContainText(/Self-scored|Confirmed|Verified/);
  await expect(viewer.getByRole("heading", { name: /Before DesiAuction/ })).toHaveCount(0);
  await capturePublicMatch(viewer, "career");
  await viewer.getByRole("link", { name: "Explore cricket insights", exact: true }).click();
  await expect(viewer.getByRole("heading", { name: "Player insights", exact: true })).toBeVisible();
  await expect(viewer.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await capturePublicMatch(viewer, "insights-batting");
  await viewer.getByRole("link", { name: "Bowling", exact: true }).click();
  await capturePublicMatch(viewer, "insights-bowling");
  await viewerContext.close();
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "Cricket stats", exact: true })).toBeVisible();
  await page.getByText("Add your previous history", { exact: true }).click();
  await page.getByLabel("Runs", { exact: true }).fill("2140");
  await page.getByLabel("Wickets", { exact: true }).fill("96");
  await page.getByLabel("From year", { exact: true }).fill("2019");
  await page.getByLabel("To year", { exact: true }).fill("2025");
  await page.getByRole("button", { name: "Save history", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "History saved." })).toBeVisible();
  await expect(page.getByText("2140 runs · 96 wickets · 2019–2025", { exact: true })).toBeVisible();
  await capturePublicMatch(page, "career-self");
  await page.getByRole("button", { name: "Remove history", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove history", exact: true })).toHaveCount(0);
  await page.goto(liveUrl);
  await expect(page.getByTestId("live-score")).toHaveText("16/0(10)");
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await page.goto(`/seasons/${fixture.slug}/standings`);
  const winner = page.getByTestId(`standings-${fixture.awayId}`);
  await expect(winner.locator('[data-label="Played"]')).toHaveText("1");
  await expect(winner.locator('[data-label="Won"]')).toHaveText("1");
  await expect(winner.locator('[data-label="Lost"]')).toHaveText("0");
  await c42ScreensAndHint(page, fixture);
});

test("the first over and sheets in floodlight remain accessible with touch targets", async ({
  page,
}) => {
  const fixture = await seedScoringFixture();
  await startScoring(page, fixture);
  await page.getByTestId("pad-menu").click();
  await page.getByTestId("menu-theme").click();
  await page.getByTestId("menu-theme-floodlight").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "floodlight");
  await page.waitForTimeout(400);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Close Theme", exact: true }).click();
  const review = async () => {
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const undersized = await page
      .locator("dialog[open] button,dialog[open] select")
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.width > 0 && (bounds.width < 44 || bounds.height < 44);
          })
          .map((element) => element.outerHTML),
      );
    expect(undersized).toEqual([]);
  };
  await firstScoringOver(page, fixture, review);
  await nextBowler(page, fixture.awayNames[1]!);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect((await readScoringFixture(fixture.fixtureId)).projection?.state.innings[0]?.overs).toBe(
    "1",
  );
});

test("C43 captain brief, sponsor, transparent stings, qualified STAT and big-screen board", async ({
  page,
  browser,
  browserName,
}) => {
  test.setTimeout(240000);
  const fixture = await seedScoringFixture({ publicDelaySeconds: 0 });
  await scoringSession(page.context(), fixture.actorToken);
  await page.goto(`/seasons/${fixture.slug}`);
  await page.getByTestId("open-season-settings").click();
  await page.getByLabel("Sponsor name", { exact: true }).fill("LS1 Match Sponsor");
  await page.getByRole("button", { name: "Save sponsor", exact: true }).click();
  await expect(page.getByText("Sponsor saved.", { exact: true })).toBeVisible();
  await page.goto(`/seasons/${fixture.slug}/brief/${fixture.fixtureId}`);
  await expect(page.getByText("Available on Pro seasons", { exact: true })).toBeVisible();
  await expect(page.locator(".brief-player")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to this match", exact: true })).toHaveAttribute(
    "href",
    `/seasons/${fixture.slug}/fixtures?match=${fixture.fixtureId}`,
  );
  await capturePublicMatch(page, "brief-locked");
  await completeAwaySample(page, fixture);
  const next = await followupScoringFixture(fixture, 2);
  const handle = createDb(process.env["DATABASE_URL"] ?? "", { max: 1 });
  try {
    const [row] = await handle.db.select().from(fixtures).where(eq(fixtures.id, fixture.fixtureId));
    if (!row) throw new Error("Missing browser fixture");
    const [season] = await handle.db
      .select()
      .from(competitions)
      .where(eq(competitions.id, row.competitionId));
    expect(season?.scoringRules).toMatchObject({
      formatKey: "t10",
      publicDelaySeconds: 0,
      sponsor: { name: "LS1 Match Sponsor" },
    });
    await handle.db
      .update(competitions)
      .set({ tier: "pro" })
      .where(eq(competitions.id, row.competitionId));
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
  await page.goto(`/seasons/${fixture.slug}/brief/${next.fixtureId}`);
  await expect(page.getByRole("heading", { name: "Know LS1 Royals", exact: true })).toBeVisible();
  await expect(page.locator(".brief-player")).toHaveCount(6);
  await expect(
    page.locator(".brief-player").filter({ hasText: "Away player 1" }).first(),
  ).toContainText("Slowest against Right Arm Medium");
  await expect(page.getByRole("link", { name: "Back to this match", exact: true })).toHaveAttribute(
    "href",
    `/seasons/${fixture.slug}/fixtures?match=${next.fixtureId}`,
  );
  await capturePublicMatch(page, "brief-entitled");
  const viewerContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    reducedMotion: "reduce",
  });
  try {
    const viewer = await viewerContext.newPage();
    const refused = await viewer.goto(`/seasons/${fixture.slug}/brief/${next.fixtureId}`);
    expect(refused?.status()).toBe(404);
    await startAwayScoring(page, next);
    const route = `/c/${fixture.slug}/m/${encodeURIComponent("Match 2")}`;
    await viewer.goto(`${route}/overlay`);
    await expect(viewer.locator(".overlay-sting")).toHaveCount(0);
    await expect(viewer.locator(".overlay-sponsor")).toContainText("LS1 Match Sponsor");
    expect(
      await viewer.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe("rgba(0, 0, 0, 0)");
    await runBall(page, 4);
    await sent(page);
    await expect(viewer.locator(".overlay-sting")).toHaveText("FOUR");
    expect(
      await viewer
        .locator(".overlay-sting")
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe("none");
    const stingStarted = Date.now();
    await viewer.screenshot({
      path: test.info().outputPath("overlay-four-1920.png"),
      // Firefox does not implement alpha screenshots; CSS transparency is asserted above.
      omitBackground: browserName !== "firefox",
    });
    await expect(viewer.locator(".overlay-sting")).toHaveCount(0);
    expect(Date.now() - stingStarted).toBeGreaterThanOrEqual(3000);
    await runBall(page, 6);
    await sent(page);
    await expect(viewer.locator(".overlay-sting")).toHaveText("SIX");
    await viewer.reload();
    await expect(viewer.locator(".overlay-sting")).toHaveCount(0);
    for (let n = 0; n < 4; n += 1) await runBall(page, n === 3 ? 1 : 0);
    await sent(page);
    await expect(viewer.getByRole("complementary", { name: "Matchup statistic" })).toContainText(
      "Right Arm Medium",
    );
    await expect(viewer.getByRole("complementary", { name: "Matchup statistic" })).toContainText(
      "60 balls in 1 matches",
    );
    for (const theme of ["daylight", "floodlight"]) {
      await viewer.evaluate(
        (value) => document.documentElement.setAttribute("data-theme", value),
        theme,
      );
      await viewer.waitForFunction(() =>
        document.getAnimations().every((animation) => animation.playState !== "running"),
      );
      expect((await new AxeBuilder({ page: viewer }).analyze()).violations).toEqual([]);
      expect(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await viewer.screenshot({
        path: test.info().outputPath(`overlay-stat-${theme}-1920.png`),
        // Firefox does not implement alpha screenshots; CSS transparency is asserted above.
        omitBackground: browserName !== "firefox",
      });
    }
    await viewer.clock.install();
    await viewer.clock.fastForward(60000);
    await expect(viewer.getByRole("complementary", { name: "Matchup statistic" })).toHaveCount(0);
    await viewer.clock.resume();
    await viewer.goto(`${route}/board`);
    await expect(viewer.getByRole("main", { name: "Big-screen match board" })).toBeVisible();
    await expect(viewer.locator(".overlay-score-team")).toContainText("11/0");
    for (const theme of ["daylight", "floodlight"]) {
      await viewer.evaluate(
        (value) => document.documentElement.setAttribute("data-theme", value),
        theme,
      );
      await viewer.waitForFunction(() =>
        document.getAnimations().every((animation) => animation.playState !== "running"),
      );
      expect((await new AxeBuilder({ page: viewer }).analyze()).violations).toEqual([]);
      await viewer.screenshot({ path: test.info().outputPath(`board-${theme}-1920.png`) });
    }
    await nextBowler(page, fixture.homeNames[1]!);
    await sent(page);
    await page.getByTestId("pad-wicket").click();
    const wicket = page.getByRole("dialog", { name: "Wicket", exact: true });
    await wicket.getByRole("button", { name: "Bowled", exact: true }).click();
    await wicket.getByRole("button", { name: "Confirm wicket", exact: true }).click();
    await sent(page);
    await expect(viewer.locator(".overlay-sting")).toHaveText("WICKET");
    await viewer.screenshot({ path: test.info().outputPath("board-wicket-1920.png") });
    const saved = await readScoringFixture(next.fixtureId);
    const token = saved.match?.shareToken;
    if (!token) throw new Error("Missing match bearer");
    const privateHandle = createDb(process.env["DATABASE_URL"] ?? "", { max: 1 });
    try {
      const [row] = await privateHandle.db
        .select()
        .from(fixtures)
        .where(eq(fixtures.id, next.fixtureId));
      if (!row) throw new Error("Missing private test fixture");
      await privateHandle.db
        .update(competitions)
        .set({ visibility: "private" })
        .where(eq(competitions.id, row.competitionId));
    } finally {
      await privateHandle.sql.end({ timeout: 5 });
    }
    expect((await viewer.goto(`${route}/overlay`))?.status()).toBe(404);
    expect((await viewer.goto(`${route}/overlay?t=${token}`))?.status()).toBe(200);
    await expect(viewer.locator(".overlay-score-team")).toContainText("11/1");
    await expect(viewer.locator(".overlay-sting")).toHaveCount(0);
  } finally {
    await viewerContext.close();
  }
});
