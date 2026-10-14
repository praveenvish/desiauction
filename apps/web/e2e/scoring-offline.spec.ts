import { createDb, matches, matchEvents } from "@desiauction/db";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  seedScoringFixture,
  startScoring,
  runBall,
  nextBowler,
  sent,
  readyOffline,
  readScoringFixture,
  scoringSession,
  committedQueue,
  persistedQueue,
} from "./scoring-fixtures";

test.use({ serviceWorkers: "allow" });

test("five offline balls survive a cold open and sync to the exact server sequence", async ({
  page,
  context,
}) => {
  const fixture = await seedScoringFixture();
  await startScoring(page, fixture);
  await runBall(page, 1);
  await readyOffline(page, fixture.fixtureId);
  const before = await readScoringFixture(fixture.fixtureId);
  await context.setOffline(true);
  for (let ball = 0; ball < 5; ball++) await runBall(page);
  await expect(page.getByTestId("pad-sync")).toHaveAttribute("data-pending", "5");
  await expect(page.getByTestId("pad-recent")).toContainText("Waiting for acceptance");
  await expect(page.getByTestId("pad-recent").locator("li")).toHaveCount(0);
  const queuedIds = await committedQueue(page, fixture.fixtureId, Array<string>(5).fill("ball"));
  await page.goto(`/score/${fixture.fixtureId}`);
  await expect(page).toHaveURL(`/score/shell#${fixture.fixtureId}`);
  await expect(page.getByTestId("pad-score")).toHaveText("1/0");
  await expect(page.getByTestId("pad-sync")).toHaveAttribute("data-pending", "5");
  expect((await persistedQueue(page, fixture.fixtureId)).map((item) => item.event.eventId)).toEqual(
    queuedIds,
  );
  await context.setOffline(false);
  await sent(page);
  const after = await readScoringFixture(fixture.fixtureId);
  expect(after.match?.lastSeq).toBe(before.match!.lastSeq + 5);
  expect(after.events.slice(-5).map((event) => event.eventId)).toEqual(queuedIds);
  expect(after.events.filter((event) => event.type === "ball")).toHaveLength(6);
  expect(after.projection?.seq).toBe(after.match?.lastSeq);
  expect(after.projection?.state.innings[0]?.overs).toBe("1");
});

for (const theme of ["daylight", "floodlight"] as const) {
  test(`offline innings continuation in ${theme} remains reachable, persists and rejects duplicate confirmation`, async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(180000);
    const fixture = await seedScoringFixture();
    await startScoring(page, fixture);
    await page.getByTestId("pad-menu").click();
    await page.getByTestId("menu-theme").click();
    await page.getByTestId(`menu-theme-${theme}`).click();
    await page.getByRole("button", { name: "Close Theme", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.waitForTimeout(400);
    for (let over = 0; over < 9; over++) {
      if (over > 0) await nextBowler(page, fixture.awayNames[over % 5]!);
      for (let ball = 0; ball < 6; ball++) await runBall(page);
      await sent(page);
    }
    await nextBowler(page, fixture.awayNames[4]!);
    await readyOffline(page, fixture.fixtureId);
    const before = await readScoringFixture(fixture.fixtureId);
    await context.setOffline(true);
    for (let ball = 0; ball < 6; ball++) await runBall(page);
    const innings = page.getByRole("dialog", { name: "Start next innings", exact: true });
    await expect(innings).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const undersized = await innings.locator("button,select").evaluateAll((elements) =>
      elements
        .filter((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.width > 0 && (bounds.width < 44 || bounds.height < 44);
        })
        .map((element) => element.outerHTML),
    );
    expect(undersized).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`innings-${theme}.png`) });
    await expect(page.getByTestId("pad-run-0")).toBeDisabled();
    await innings.getByRole("button", { name: "Close Start next innings", exact: true }).click();
    await page.getByTestId("innings-start-open").click();
    await innings.getByTestId("innings-start-confirm").evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect(page.getByTestId("pad-sync")).toHaveAttribute("data-pending", "7");
    await runBall(page);
    await expect(page.getByTestId("pad-sync")).toHaveAttribute("data-pending", "8");
    const queuedIds = await committedQueue(page, fixture.fixtureId, [
      ...Array<string>(6).fill("ball"),
      "innings_started",
      "ball",
    ]);
    await page.reload();
    await expect(page.getByTestId("pad-run-0")).toBeEnabled();
    await expect(page.getByTestId("pad-sync")).toHaveAttribute("data-pending", "8");
    expect(
      (await persistedQueue(page, fixture.fixtureId)).map((item) => item.event.eventId),
    ).toEqual(queuedIds);
    await context.setOffline(false);
    await sent(page);
    const after = await readScoringFixture(fixture.fixtureId);
    expect(after.match?.lastSeq).toBe(before.match!.lastSeq + 8);
    expect(after.events.slice(-8).map((event) => event.eventId)).toEqual(queuedIds);
    expect(after.events.filter((event) => event.type === "innings_started")).toHaveLength(2);
    expect(after.projection?.state.innings).toMatchObject([{ overs: "10" }, { overs: "0.1" }]);
  });
}

test("handover transfers scoring to device B and refuses device A's next ball", async ({
  page,
  browser,
}) => {
  const fixture = await seedScoringFixture();
  await startScoring(page, fixture);
  await runBall(page, 1);
  await sent(page);
  await page.getByTestId("pad-menu").click();
  await page.getByTestId("handover-open").click();
  await page.getByRole("button", { name: "Create handover link", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Scan to take over scoring", exact: true }),
  ).toBeVisible();
  const link = await page
    .getByRole("link", { name: "Open handover link", exact: true })
    .getAttribute("href");
  if (!link) throw new Error("Missing handover link");
  const other = await browser.newContext();
  try {
    await scoringSession(other, fixture.nextActorToken);
    const next = await other.newPage();
    await next.goto(link);
    await next.getByTestId("handover-accept").click();
    await next.waitForURL(`**/score/${fixture.fixtureId}`);
    await runBall(next, 1);
    await sent(next);
    const transferred = await readScoringFixture(fixture.fixtureId);
    expect(transferred.match?.scorerPersonId).toBe(fixture.nextActorId);
    expect(transferred.events.filter((event) => event.type === "ball")).toHaveLength(2);
    await page.getByRole("button", { name: "Close Hand over scoring", exact: true }).click();
    await runBall(page, 1);
    const refusal = page.getByRole("dialog", { name: "Scoring entry refused", exact: true });
    await expect(refusal.getByRole("alert")).toContainText(
      "Take the scoring claim on this device first.",
    );
    const unchanged = await readScoringFixture(fixture.fixtureId);
    expect(unchanged.match?.lastSeq).toBe(transferred.match?.lastSeq);
  } finally {
    await other.close();
  }
});

for (const theme of ["daylight", "floodlight"] as const) {
  test(`human force takeover preserves canonical scoring · ${theme}`, async ({
    page,
    browser,
    context,
  }) => {
    const fixture = await seedScoringFixture();
    await startScoring(page, fixture);
    await runBall(page, 1);
    await sent(page);
    const before = await readScoringFixture(fixture.fixtureId);
    const other = await browser.newContext();
    try {
      await scoringSession(other, fixture.nextActorToken);
      const next = await other.newPage();
      await next.goto(`/score/${fixture.fixtureId}`);
      await next.evaluate(
        (value) => document.documentElement.setAttribute("data-theme", value),
        theme,
      );
      await expect(next.getByTestId("pad-run-0")).toBeEnabled();
      await next.getByTestId("claim-force").click();
      const dialog = next.getByRole("dialog", { name: "Take over scoring?", exact: true });
      expect((await new AxeBuilder({ page: next }).analyze()).violations).toEqual([]);
      await dialog.getByRole("button", { name: "Confirm takeover", exact: true }).click();
      await expect(dialog.getByRole("alert")).toHaveText(
        "The current scorer still holds this match.",
      );
      expect((await readScoringFixture(fixture.fixtureId)).match?.scorerPersonId).toBe(
        fixture.actorId,
      );
      const owner = createDb(process.env["DATABASE_URL"]!, { max: 1 });
      try {
        const quiet = new Date(Date.now() - 121_000);
        await owner.db
          .update(matches)
          .set({ scorerClaimedAt: quiet })
          .where(eq(matches.fixtureId, fixture.fixtureId));
        await owner.db
          .update(matchEvents)
          .set({ receivedAt: quiet })
          .where(eq(matchEvents.fixtureId, fixture.fixtureId));
      } finally {
        await owner.sql.end();
      }
      let release: () => void = () => undefined;
      let requested: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const canonicalRequested = new Promise<void>((resolve) => {
        requested = resolve;
      });
      await next.route(`**/api/score/${fixture.fixtureId}/events?*`, async (route) => {
        requested();
        await held;
        await route.continue();
      });
      await dialog.getByRole("button", { name: "Confirm takeover", exact: true }).click();
      await canonicalRequested;
      await expect(next.getByTestId("pad-run-0")).toBeDisabled();
      release();
      await next.unrouteAll({ behavior: "wait" });
      await expect(dialog).not.toBeVisible();
      await expect(next.getByTestId("pad-score")).toHaveText("1/0");
      await runBall(next, 1);
      await sent(next);
      const transferred = await readScoringFixture(fixture.fixtureId);
      expect(transferred.match?.scorerPersonId).toBe(fixture.nextActorId);
      expect(
        transferred.events.slice(0, before.events.length).map((event) => event.eventId),
      ).toEqual(before.events.map((event) => event.eventId));
      expect(transferred.events.filter((event) => event.type === "ball")).toHaveLength(2);
      // Existing organizer authority permits immediate takeover after a fresh accepted delivery.
      await page.getByTestId("claim-force").click();
      await page
        .getByRole("dialog", { name: "Take over scoring?", exact: true })
        .getByRole("button", { name: "Confirm takeover", exact: true })
        .click();
      await expect(page.getByTestId("pad-score")).toHaveText("2/0");
      await expect(
        page.getByRole("dialog", { name: "Take over scoring?", exact: true }),
      ).not.toBeVisible();
      await runBall(page);
      await sent(page);
      const reclaimed = await readScoringFixture(fixture.fixtureId);
      expect(reclaimed.match?.scorerPersonId).toBe(fixture.actorId);
      expect(reclaimed.events.filter((event) => event.type === "ball")).toHaveLength(3);
      await runBall(next);
      await expect(
        next.getByRole("dialog", { name: "Scoring entry refused", exact: true }).getByRole("alert"),
      ).toContainText("Take the scoring claim on this device first.");
      expect((await readScoringFixture(fixture.fixtureId)).match?.lastSeq).toBe(
        reclaimed.match?.lastSeq,
      );
      // A saved offline delivery blocks takeover without discarding or replaying it.
      await readyOffline(page, fixture.fixtureId);
      await context.setOffline(true);
      await runBall(page);
      const saved = await persistedQueue(page, fixture.fixtureId);
      await expect(page.getByTestId("claim-force")).toBeDisabled();
      expect(
        (await persistedQueue(page, fixture.fixtureId)).map((item) => item.event.eventId),
      ).toEqual(saved.map((item) => item.event.eventId));
      await context.setOffline(false);
      await sent(page);
    } finally {
      await other.close();
    }
  });
}

test("missing required family assets prevent offline readiness", async ({ page, context }) => {
  const fixture = await seedScoringFixture();
  await startScoring(page, fixture);
  await runBall(page);
  await sent(page);
  const manifest = JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        process.env.NEXT_DIST_DIR ?? ".next",
        "react-loadable-manifest.json",
      ),
      "utf8",
    ),
  ) as Record<string, { files: string[] }>;
  const entry = Object.entries(manifest).find(
    ([key]) => key.includes("pad-entries") && key.endsWith(" -> ./rally-pad"),
  );
  expect(entry).toBeDefined();
  const required = entry![1].files.filter((file) => file.endsWith(".js")).at(-1)!;
  let refused = false;
  await context.route(`**/_next/${required}`, async (route) => {
    refused = true;
    await route.fulfill({ status: 503, body: "Required file unavailable" });
  });
  await page.goto("/score");
  await page.getByRole("button", { name: "Get ready for match day", exact: true }).click();
  await expect(page.locator("article").getByRole("alert")).toContainText(
    "offline scoring file is unavailable",
  );
  expect(refused).toBe(true);
  await expect(page.getByText("✓ Works offline", { exact: true })).toHaveCount(0);
});
